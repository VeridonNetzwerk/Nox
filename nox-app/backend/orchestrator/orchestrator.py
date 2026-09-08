"""Orchestrator – central coordination for chat processing.

Pipeline per incoming message:
1. Retrieve relevant context from nox_eye
2. Load conversation history from SQLite
3. Build structured prompt: system prompt + context + history + new message
4. Stream LLM response token-by-token via WebSocket
5. In voice mode: pipe sentences to TTS as they complete
6. Handle tool-calling (native or fallback parsing)
7. Persist conversation turns
8. Manage context window: summarize old turns when threshold exceeded
"""

import asyncio
import json
import logging
import re
import uuid
from typing import Any, AsyncIterator, Callable, Optional

import httpx

from llm_backend import LLMBackend, create_backend  # llm/ subdir on sys.path (added by main.py)
from .conversation_store import ConversationStore
from .system_prompt import build_system_prompt
from .tool_handler import ToolHandler

logger = logging.getLogger("nox.orchestrator")


class SentenceBuffer:
    """Accumulates streamed tokens and emits complete sentences for TTS."""

    _SENTENCE_ENDS = frozenset(".!?")

    def __init__(self):
        self._buffer = ""

    def feed(self, token: str) -> list[str]:
        self._buffer += token
        sentences = []
        buf = self._buffer
        while True:
            # Find next sentence-ending punctuation followed by whitespace
            idx = -1
            for i, ch in enumerate(buf):
                if ch in self._SENTENCE_ENDS and i + 1 < len(buf) and buf[i + 1].isspace():
                    idx = i + 2  # include the whitespace
                    break
            if idx == -1:
                break
            sentence = buf[:idx].strip()
            if sentence:
                sentences.append(sentence)
            buf = buf[idx:]
        self._buffer = buf
        return sentences

    def flush(self) -> str:
        remaining = self._buffer.strip()
        self._buffer = ""
        return remaining if remaining else ""


def _parse_fallback_params(
    params: str,
    first_key: Optional[str] = None,
    valid_keys: Optional[set[str]] = None,
    float_keys: frozenset[str] = frozenset(),
    int_keys: frozenset[str] = frozenset(),
    collect_bare_into: Optional[str] = None,
) -> dict[str, Any]:
    """Parse key=value params from a fallback tool string.

    All parsers share the same pattern: optional first bare token assigned to
    first_key, then key=value pairs where values span until the next key=value
    or end of string. Some keys get type conversions.

    Args:
        params: Space-separated params string.
        first_key: If set, first bare token (without '=') is assigned to this key.
        valid_keys: Only keys in this set are accepted (None = accept all).
        float_keys: Keys whose values should be converted to float.
        int_keys: Keys whose values should be converted to int.
        collect_bare_into: If set, remaining non-key=value tokens are collected
            into this key (if not already present).
    """
    result: dict[str, Any] = {}
    remaining = params.split()
    bare_parts: list[str] = []
    i = 0
    if first_key and remaining and "=" not in remaining[0]:
        result[first_key] = remaining[0]
        i = 1
    while i < len(remaining):
        part = remaining[i]
        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip().lower()
            value = value.strip()
            j = i + 1
            while j < len(remaining) and "=" not in remaining[j]:
                value += " " + remaining[j]
                j += 1
            if valid_keys is None or key in valid_keys:
                if key in float_keys:
                    try:
                        result[key] = float(value)
                    except ValueError:
                        result[key] = value
                elif key in int_keys:
                    try:
                        result[key] = int(value)
                    except ValueError:
                        result[key] = value
                else:
                    result[key] = value
            i = j
        else:
            if collect_bare_into:
                bare_parts.append(part)
            i += 1
    if collect_bare_into and bare_parts and collect_bare_into not in result:
        result[collect_bare_into] = " ".join(bare_parts)
    return result


# Pre-compiled regex patterns for fallback tool param parsing
_RE_SETTING = re.compile(r'key=(\S+)\s+value=(.+)')
_RE_VOLUME = re.compile(r'(\w+)\s+wert=(\d+)')
_RE_CLIPBOARD = re.compile(r'(\w+)\s+text=(.+)', re.DOTALL)
_RE_WEATHER = re.compile(r'(.+?)\s+tage=(\d+)')
_RE_IMAGE_GEN = re.compile(r'prompt=(.+?)(?:\s+stil=(\w+))?(?:\s+groesse=(\w+))?$', re.DOTALL)


def _parse_einstellung(params: str) -> dict[str, Any]:
    m = _RE_SETTING.match(params)
    if m:
        return {"key": m.group(1), "value": m.group(2).strip()}
    return {"key": "", "value": ""}


def _parse_lautstaerke(params: str) -> dict[str, Any]:
    m = _RE_VOLUME.match(params)
    if m:
        return {"aktion": m.group(1), "wert": int(m.group(2))}
    return {"aktion": params}


def _parse_zwischenablage(params: str) -> dict[str, Any]:
    m = _RE_CLIPBOARD.match(params)
    if m:
        return {"aktion": m.group(1), "text": m.group(2).strip()}
    return {"aktion": params}


def _parse_wetter(params: str) -> dict[str, Any]:
    m = _RE_WEATHER.match(params)
    if m:
        return {"ort": m.group(1).strip(), "tage": int(m.group(2))}
    if params.strip():
        return {"ort": params.strip()}
    return {}


def _parse_bild_generieren(params: str) -> dict[str, Any]:
    m = _RE_IMAGE_GEN.match(params)
    if m:
        args: dict[str, Any] = {"prompt": m.group(1).strip()}
        if m.group(2):
            args["stil"] = m.group(2)
        if m.group(3):
            args["groesse"] = m.group(3)
        return args
    return {"prompt": params}


def _parse_fenster_fokus(params: str) -> dict[str, Any]:
    parts = params.split(None, 1)
    if len(parts) >= 2:
        return {"aktion": parts[0], "name": parts[1]}
    return {"aktion": parts[0] if parts else "", "name": ""}


def _parse_passthrough(key: str):
    return lambda params: {key: params}


_NO_ARGS = lambda params: {}

_FALLBACK_PARSERS: dict[str, Any] = {
    "datei_lesen": _parse_passthrough("pfad"),
    "dateien_suchen": _parse_passthrough("query"),
    "einstellung_aendern": _parse_einstellung,
    "einstellungen_lesen": _NO_ARGS,
    "app_oeffnen": _parse_passthrough("name"),
    "system_steuerung": _parse_passthrough("aktion"),
    "lautstaerke": _parse_lautstaerke,
    "search_web": _parse_passthrough("query"),
    "website_oeffnen": _parse_passthrough("url_oder_suche"),
    "fenster_fokus": _parse_fenster_fokus,
    "timer_stellen": lambda p: _parse_fallback_params(
        p, first_key="aktion",
        valid_keys={"minuten", "sekunden", "uhrzeit", "nachricht"},
        float_keys=frozenset({"minuten", "sekunden"}),
        collect_bare_into="nachricht",
    ),
    "erinnerung_speichern": lambda p: _parse_fallback_params(
        p, first_key="aktion",
        valid_keys={"zeitpunkt", "text", "id"},
        int_keys=frozenset({"id"}),
    ),
    "zwischenablage": _parse_zwischenablage,
    "wetter_abfragen": _parse_wetter,
    "profil_speichern": lambda p: _parse_fallback_params(
        p, first_key="feld",
        valid_keys={"feld", "wert"},
        float_keys=frozenset({"wert"}),
    ),
    "uebersetzen": lambda p: _parse_fallback_params(
        p, valid_keys={"text", "zielsprache", "quellsprache"},
    ),
    "einheit_rechnen": lambda p: _parse_fallback_params(
        p, first_key="aktion",
        valid_keys={"aktion", "wert", "von", "nach"},
        float_keys=frozenset({"wert"}),
    ),
    "bild_generieren": _parse_bild_generieren,
    "bildschirm_ansehen": _NO_ARGS,
    "screenshot_historie": _NO_ARGS,
    "musik_erkennen": _NO_ARGS,
    "aktuelle_uhrzeit": _NO_ARGS,
    "fenster_schliessen": _NO_ARGS,
    "nox_beenden": _NO_ARGS,
}


class Orchestrator:
    """Central orchestrator for processing chat messages."""

    def __init__(
        self,
        config: dict[str, Any],
        eye_manager=None,
        voice_manager=None,
        files_manager=None,
        broadcast: Optional[Callable] = None,
        settings_manager=None,
        apply_settings_fn: Optional[Callable] = None,
    ):
        self.config = config
        self.llm_host = config.get("ollama_host", "http://localhost:11434")
        self.llm_model = config.get("ollama_model", "qwen3:14b")
        self.max_context_tokens = config.get("max_context_tokens", 8192)
        self.max_history_turns = config.get("max_history_turns", 10)

        self.eye_manager = eye_manager
        self.voice_manager = voice_manager
        self.files_manager = files_manager
        self._broadcast = broadcast or (lambda msg: None)

        # LLM backend (set later via set_backend)
        self.backend: Optional[LLMBackend] = None

        # Conversation store (shared nox.db)
        self.conversation_store = ConversationStore(
            db_path=config.get("memory_db_path", ""),
            max_context_tokens=self.max_context_tokens,
            summarize_fn=self._summarize_via_backend,
        )

        # Tool handler
        self.tool_handler = ToolHandler(
            eye_manager=eye_manager,
            files_manager=files_manager,
            settings_manager=settings_manager,
            apply_settings_fn=apply_settings_fn,
            config=config,
            broadcast=self._broadcast,
        )

        # Active conversation ID (could be session-based in future)
        self._conversation_id = str(uuid.uuid4())

        logger.info("Orchestrator initialized (model=%s, conv=%s)", self.llm_model, self._conversation_id)

        self._tools_supported: Optional[bool] = None

        # Cache for tools schema
        self._tools_cache: Optional[list[dict[str, Any]]] = None

        # Abort flag — set by abort() to cancel the current process_message
        self._aborted = False

        # Flag: True if screen content was proactively read for this message
        self._screen_context_active = False

        # Lock to ensure only one process_message runs at a time per orchestrator
        self._processing_lock = asyncio.Lock()

    @property
    def conversation_id(self) -> str:
        return self._conversation_id

    def set_backend(self, backend: LLMBackend) -> None:
        """Set the LLM backend to use for chat completions."""
        self.backend = backend
        self.llm_model = backend.model
        self._tools_supported = None
        self._tools_cache = None
        logger.info("LLM backend set: %s at %s (model=%s)",
                    backend.backend_type, backend.endpoint or 'in-process', backend.model)

    async def _summarize_via_backend(self, prompt: str) -> Optional[str]:
        """Generate a summary using the current LLM backend.

        Used as a callback by ConversationStore.summarize_old_turns().
        """
        if self.backend is None:
            return None
        try:
            tokens = []
            async for item in self.backend.stream_chat(
                messages=[{"role": "user", "content": prompt}],
                num_ctx=2048,
            ):
                if isinstance(item, str):
                    tokens.append(item)
                elif isinstance(item, dict) and "stats" in item:
                    break
            return "".join(tokens) if tokens else None
        except Exception as exc:
            logger.error("Summarization via backend failed: %s", exc)
            return None

    async def init_backend(self) -> bool:
        """Auto-detect and initialize the LLM backend. Returns True if a backend is available."""
        backend = await create_backend(self.config)
        if backend:
            self.set_backend(backend)
            return True
        return False

    async def _check_tools_support(self) -> bool:
        """Check if the current LLM backend supports native tool calling."""
        if self._tools_supported is not None:
            return self._tools_supported
        if self.backend is None:
            self._tools_supported = False
            return False
        try:
            if hasattr(self.backend, 'check_tools_support'):
                self._tools_supported = await self.backend.check_tools_support()
            else:
                self._tools_supported = self.backend.supports_tools()
            logger.info("Backend %s tools support: %s",
                        self.backend.backend_type, self._tools_supported)
        except Exception as exc:
            logger.warning("Failed to check tools support: %s", exc)
            self._tools_supported = False
        return self._tools_supported

    def set_broadcast(self, broadcast: Callable) -> None:
        self._broadcast = broadcast

    def abort(self) -> None:
        """Abort the current process_message if one is running."""
        self._aborted = True
        logger.info("Orchestrator: abort requested")

    async def process_message(
        self,
        message: str,
        voice_input: bool = False,
        context_override: Optional[str] = None,
        send: Optional[Callable] = None,
        think_override: Optional[bool] = None,
    ) -> None:
        """Process an incoming message end-to-end.

        1. Build messages with system prompt + history
        2. Stream LLM response
        3. Pipe to TTS in voice mode
        4. Handle tool calls (including bildschirm_ansehen for screen context)
        5. Persist turns
        """
        # Acquire lock — only one message at a time per conversation
        try:
            await asyncio.wait_for(self._processing_lock.acquire(), timeout=0)
        except asyncio.TimeoutError:
            logger.warning("process_message called while another is running — rejecting")
            if send:
                await send({"type": "error", "content": "Es läuft bereits eine Anfrage. Bitte warte, bis sie fertig ist, oder stoppe sie."})
                await send({"type": "done"})
            return

        try:
            # Proactive context: inject active window title + screen content
            context = context_override or ""
            screen_content_read = False  # Track if we proactively read screen content
            if not context and self.eye_manager and self.eye_manager.is_available:
                try:
                    msg_lower = message.lower()

                    # Keywords that indicate the user is referencing what they see
                    screen_ref_keywords = [
                        "anschaue", "ansehe", "sehe", "schau", "auf dem bildschirm",
                        "das hier", "die serie", "der film", "das video", "das bild",
                        "was ich gerade", "gerade eben", "auf dem monitor",
                        "dasteht", "da steht", "was da", "das da", "die seite",
                        "hier drauf", "auf dem tab",
                        # Follow-up references to things on screen
                        "offen habe", "offen ist", "offen hab", "welche ich", "welcher ich",
                        "die da", "der da", "das da", "die offen", "der offen",
                        "welche offen", "welcher offen", "davon", "davon die",
                        "und von der", "und von dem", "und von die",
                        "die ich offen", "der ich offen", "das ich offen",
                        "die ich auf", "der ich auf", "das ich auf",
                    ]
                    # App names to look for in the user's message
                    app_name_map = {
                        "emby": "emby",
                        "netflix": "netflix",
                        "youtube": "youtube",
                        "twitch": "twitch",
                        "disney": "disney",
                        "prime": "prime",
                        "amazon": "amazon",
                        "hulu": "hulu",
                        "crunchyroll": "crunchyroll",
                        "vlc": "vlc",
                        "mpv": "mpv",
                        "plex": "plex",
                        "jellyfin": "jellyfin",
                        "browser": None,  # just trigger screen read
                        "firefox": "firefox",
                        "chrome": "chrome",
                        "edge": "edge",
                    }

                    should_read_screen = any(kw in msg_lower for kw in screen_ref_keywords)
                    # Also check for "auf <app>" or "in <app>" patterns
                    mentioned_app = None
                    for app_key, app_search in app_name_map.items():
                        if f"auf {app_key}" in msg_lower or f"in {app_key}" in msg_lower:
                            should_read_screen = True
                            if app_search:
                                mentioned_app = app_search
                            break

                    # Get active window info for the context title
                    info = None
                    if self.eye_manager.window_monitor.is_available:
                        info = self.eye_manager.window_monitor.get_active_window()

                    if info and not self.eye_manager.window_monitor._is_excluded(info):
                        context = f"Aktives Fenster: {info.title} (App: {info.app_name})"
                    elif info and self.eye_manager.window_monitor._is_excluded(info):
                        # Active window is excluded (e.g. Nox itself) — don't set context from it
                        pass

                    logger.info("Proactive screen check: keywords_match=%s, mentioned_app=%s, active_window=%s",
                                should_read_screen, mentioned_app, info.title if info else "None")

                    if should_read_screen:
                        try:
                            if mentioned_app:
                                # Read the specific app window (e.g. Emby) even if it's not active
                                screen_text = await asyncio.get_running_loop().run_in_executor(
                                    None, self.eye_manager.read_window_by_app_name, mentioned_app
                                )
                            else:
                                # No specific app mentioned — search for known media windows first
                                screen_text = await asyncio.get_running_loop().run_in_executor(
                                    None, self.eye_manager.read_media_window
                                )
                            logger.info("Proactive screen read result: %d chars", len(screen_text or ""))
                            if screen_text and screen_text != "Bildschirm-Erfassung nicht verfügbar.":
                                # Get previous user message for follow-up context
                                prev_user_msg = ""
                                try:
                                    turns = self.conversation_store.get_recent_turns(self._conversation_id, n=5)
                                    prev_user_msgs = [t["content"] for t in turns if t["role"] == "user"]
                                    if prev_user_msgs:
                                        prev_user_msg = prev_user_msgs[-1]
                                except Exception:
                                    pass

                                # Build context hint — include previous question if this looks like a follow-up
                                hint = ("--- WICHTIG: Der obige Fensterinhalt zeigt was der Nutzer gerade sieht. "
                                        "Nutze den Inhalt um zu verstehen, worauf sich der Nutzer bezieht. "
                                        "Wenn der Nutzer nach einer Serie/Film fragt, steht der Titel im Fensterinhalt — "
                                        "verwende ihn (nicht den App-Namen wie Emby/Netflix) für search_web.")
                                if prev_user_msg and message.lower() != prev_user_msg.lower():
                                    hint += (f"\n\nDer Nutzer hat vorher gefragt: '{prev_user_msg}'. "
                                             "Die aktuelle Frage ist eine Folgefrage dazu — wende die GLEICHE Frage auf den JETZIGEN Fensterinhalt an. "
                                             "Suche nicht fragen — rufe search_web auf und antworte direkt.")
                                hint += " ---"
                                context = screen_text + "\n\n" + hint
                                screen_content_read = True
                        except Exception as exc:
                            logger.warning("Proactive screen read failed: %s", exc)
                except Exception as exc:
                    logger.warning("Proactive context failed: %s", exc)

            # If we proactively read screen content, exclude musik_erkennen from tools
            # (the user is watching something, not asking about music)
            self._screen_context_active = screen_content_read

            # 2. Build system prompt
            voice_personality = None
            if voice_input and self.voice_manager:
                try:
                    voice_personality = self.voice_manager.get_voice_personality()
                except Exception:
                    pass
            system_prompt = build_system_prompt(
                voice_mode=voice_input,
                tools_enabled=True,
                context=context or "",
                voice_personality=voice_personality,
            )
            if screen_content_read:
                logger.info("System prompt context (screen read): %s", context[:500])

            # 3. Build messages (system + summary + history + new message)
            messages = self.conversation_store.build_messages(
                conversation_id=self._conversation_id,
                system_prompt=system_prompt,
                new_message=message,
                context=None,  # context already in system prompt
                max_turns=self.max_history_turns,
            )

            # If we proactively read screen content, inject it as a separate
            # system message right before the user's message. Small models
            # pay more attention to messages near the end of the conversation.
            if screen_content_read and context:
                # Find the last user message (the new one) and insert before it
                for i in range(len(messages) - 1, -1, -1):
                    if messages[i].get("role") == "user":
                        messages.insert(i, {
                            "role": "system",
                            "content": f"Der Nutzer sieht gerade folgenden Bildschirminhalt:\n{context}\n\nNutze diesen Kontext um die Frage des Nutzers zu beantworten. Berücksichtige den Gesprächsverlauf für Folgefragen."
                        })
                        break

            # 4. Persist user turn
            self.conversation_store.add_turn(
                self._conversation_id, "user", message,
                token_count=len(message) // 4,
                voice_input=voice_input,
            )

            logger.info("Processing message: voice=%s, len=%d, msgs=%d", voice_input, len(message), len(messages))

            # Use send callback if provided (targets specific client), else broadcast
            _send = send or self._broadcast

            # Reset abort flag for this run
            self._aborted = False

            # Capture event loop for tool handler (runs in thread pool)
            self.tool_handler._loop = asyncio.get_running_loop()

            # 5. Stream response
            sentence_buffer = SentenceBuffer()
            full_response = ""
            tool_executed = False
            response_stats = None
            card_only_tool = False  # If set, suppress text message and send card_text in done

            use_native_tools = await self._check_tools_support()

            try:
                async for item in self._stream_llm(messages, use_tools=use_native_tools, think_override=think_override):
                    if self._aborted:
                        logger.info("Orchestrator: aborted during streaming")
                        break
                    # Stats sentinel
                    if isinstance(item, dict) and "stats" in item:
                        response_stats = item["stats"]
                        continue
                    # Thinking trace — send to UI but don't include in response text
                    if isinstance(item, dict) and "thinking" in item:
                        await _send({"type": "thinking", "content": item["thinking"]})
                        continue
                    # Native tool call sentinel
                    if isinstance(item, dict) and "tool_calls" in item and not tool_executed:
                        for tc in item["tool_calls"]:
                            func = tc.get("function", {})
                            tool_name = func.get("name", "")
                            tool_args_str = func.get("arguments", "{}")
                            try:
                                tool_args = json.loads(tool_args_str) if isinstance(tool_args_str, str) else tool_args_str
                            except json.JSONDecodeError:
                                tool_args = {}
                            if tool_name and self.tool_handler.has_tool(tool_name):
                                tool_result = await asyncio.get_running_loop().run_in_executor(
                                    None, self.tool_handler.execute, tool_name, tool_args
                                )
                                tool_executed = True
                                if tool_name == "wetter_abfragen" and not str(tool_result).startswith("Kein Ort"):
                                    card_only_tool = True
                                await _send({"type": "tool_start", "tool": tool_name})
                                await _send({"type": "tool_result", "tool": tool_name, "result": tool_result})
                                messages.append({"role": "assistant", "content": "", "tool_calls": [tc]})
                                messages.append({"role": "user", "content": f"Werkzeug-Ergebnis: {tool_result}\n\nBitte antworte basierend auf diesem Ergebnis."})
                                full_response = ""
                                sentence_buffer = SentenceBuffer()
                                async for token2 in self._stream_llm(messages, use_tools=False, think_override=think_override):
                                    if self._aborted:
                                        break
                                    if isinstance(token2, dict):
                                        if "stats" in token2:
                                            response_stats = token2["stats"]
                                        elif "thinking" in token2:
                                            await _send({"type": "thinking", "content": token2["thinking"]})
                                        continue
                                    full_response += token2
                                    if not card_only_tool:
                                        await _send({"type": "token", "content": token2})
                                    if voice_input:
                                        for sentence in sentence_buffer.feed(token2):
                                            self.voice_manager.speak_sentence(sentence)
                                break
                        continue

                    token = item
                    full_response += token

                    if self._aborted:
                        break

                    # Check for tool calls in fallback mode (text-based)
                    tool_match = self.tool_handler.parse_fallback(full_response)
                    if tool_match and not tool_executed:
                        tool_name, tool_params = tool_match
                        if self.tool_handler.has_tool(tool_name):
                            # Map params to the correct argument key per tool
                            tool_args = _FALLBACK_PARSERS.get(tool_name, lambda p: {"query": p, "text": p})(tool_params)
                            tool_result = await asyncio.get_running_loop().run_in_executor(
                                None, self.tool_handler.execute, tool_name, tool_args
                            )
                            tool_executed = True
                            if tool_name == "wetter_abfragen" and not str(tool_result).startswith("Kein Ort"):
                                card_only_tool = True
                            # Tell UI to clear the streamed tool-call text
                            await _send({"type": "tool_start", "tool": tool_name})
                            # Send tool result
                            await _send({
                                "type": "tool_result",
                                "tool": tool_name,
                                "result": tool_result,
                            })
                            # Inject tool result and continue generation
                            messages.append({"role": "assistant", "content": full_response})
                            messages.append({"role": "user", "content": f"Werkzeug-Ergebnis: {tool_result}\n\nBitte antworte basierend auf diesem Ergebnis."})
                            # Re-stream with tool result
                            full_response = ""
                            sentence_buffer = SentenceBuffer()
                            async for token2 in self._stream_llm(messages, think_override=think_override):
                                if self._aborted:
                                    break
                                if isinstance(token2, dict):
                                    if "stats" in token2:
                                        response_stats = token2["stats"]
                                    elif "thinking" in token2:
                                        await _send({"type": "thinking", "content": token2["thinking"]})
                                    continue
                                full_response += token2
                                if not card_only_tool:
                                    await _send({"type": "token", "content": token2})
                                if voice_input:
                                    for sentence in sentence_buffer.feed(token2):
                                        self.voice_manager.speak_sentence(sentence)
                            # Break outer loop — outer stream is done (model stops after tool call)
                            break

                    # Stream token to UI (only if no tool was executed)
                    if not tool_executed:
                        await _send({"type": "token", "content": token})

                    # Pipe to TTS in voice mode
                    if voice_input and self.voice_manager:
                        for sentence in sentence_buffer.feed(token):
                            self.voice_manager.speak_sentence(sentence)

                # Flush remaining TTS text
                if voice_input and self.voice_manager:
                    remaining = sentence_buffer.flush()
                    if remaining:
                        self.voice_manager.speak_sentence(remaining)

                # Strip tool markers from final response for storage
                clean_response = self.tool_handler.strip_tool_marker(full_response) if tool_executed else full_response

                # 6. Persist assistant turn
                stats_json = json.dumps(response_stats) if response_stats else ""
                self.conversation_store.add_turn(
                    self._conversation_id, "assistant", clean_response,
                    token_count=len(clean_response) // 4,
                    stats=stats_json,
                )

                # 7. Check if summarization is needed
                if self.conversation_store.needs_summarization(self._conversation_id):
                    asyncio.create_task(
                        self.conversation_store.summarize_old_turns(self._conversation_id)
                    )

                # 8. Send done (or aborted)
                if self._aborted:
                    await _send({"type": "aborted"})
                    logger.info("Response aborted")
                else:
                    done_payload = {"type": "done", "content": clean_response}
                    if card_only_tool:
                        done_payload["card_only"] = True
                        done_payload["card_text"] = clean_response
                    if response_stats:
                        done_payload["stats"] = response_stats
                        done_payload["model"] = self.llm_model
                    await _send(done_payload)
                    logger.info("Response complete: len=%d", len(clean_response))

            except httpx.ConnectError:
                logger.error("LLM backend not reachable")
                await _send({
                    "type": "error",
                    "content": f"Das KI-Backend ist nicht erreichbar. Bitte starte Ollama, LM Studio oder einen anderen OpenAI-kompatiblen Server.",
                })
                await _send({"type": "done"})
            except httpx.ReadTimeout:
                logger.error("LLM backend read timeout — model may be loading or stuck")
                await _send({
                    "type": "error",
                    "content": "Die KI hat zu lange gebraucht um zu antworten. Möglicherweise wird das Modell gerade geladen. Bitte erneut versuchen.",
                })
                await _send({"type": "done"})
            except httpx.HTTPStatusError as exc:
                logger.error("LLM backend HTTP error: %s", exc)
                user_msg = self._format_backend_error(exc)
                await _send({"type": "error", "content": user_msg})
                await _send({"type": "done"})
            except Exception as exc:
                logger.error("Orchestrator error: %s", exc, exc_info=True)
                await _send({"type": "error", "content": f"Fehler: {exc}"})
                await _send({"type": "done"})
        finally:
            self._processing_lock.release()

    def _format_backend_error(self, exc: httpx.HTTPStatusError) -> str:
        """Format an LLM backend HTTP error into a user-friendly German message."""
        status = exc.response.status_code if exc.response else 0
        err_msg = ""
        if exc.response:
            try:
                body = exc.response.json()
                err_msg = body.get("error", "")
            except Exception:
                try:
                    raw = exc.response.content
                    body = json.loads(raw)
                    err_msg = body.get("error", "")
                except Exception:
                    err_msg = exc.response.text if hasattr(exc.response, 'text') else ""

        if status == 500 and err_msg:
            err_lower = err_msg.lower()
            if "memory" in err_lower or "ram" in err_lower or "vram" in err_lower:
                return (
                    f"Das KI-Modell '{self.llm_model}' ist zu groß für den verfügbaren Arbeitsspeicher. "
                    f"Das Backend meldet: {err_msg}\n"
                    "Bitte wähle in den Einstellungen ein kleineres Modell oder schließe speicherintensive Programme."
                )
            if "model" in err_lower and ("not found" in err_lower or "does not exist" in err_lower):
                return (
                    f"Das KI-Modell '{self.llm_model}' ist nicht installiert. "
                    "Bitte lade es herunter oder wähle ein anderes Modell in den Einstellungen."
                )
            return f"KI-Backend-Fehler: {err_msg}"

        if status == 404:
            return (
                f"Das KI-Modell '{self.llm_model}' wurde nicht gefunden. "
                "Bitte installiere es oder wähle ein anderes Modell in den Einstellungen."
            )

        return f"KI-Backend-Fehler (HTTP {status}): {err_msg or str(exc)}"

    async def _stream_llm(
        self,
        messages: list[dict[str, str]],
        use_tools: bool = False,
        think_override: Optional[bool] = None,
        response_format: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[Any]:
        """Stream tokens from the LLM backend.

        Yields str tokens, or dicts with 'tool_calls', 'thinking', or 'stats' keys.
        """
        if self.backend is None:
            raise httpx.ConnectError("No LLM backend available")
        tools = self.tool_handler.get_tools() if use_tools else None
        # If we proactively read screen content, remove musik_erkennen and bildschirm_ansehen
        # from the tool list — the user is watching something, not asking about music,
        # and we already have the screen content
        if tools and self._screen_context_active:
            tools = [t for t in tools if t.get("function", {}).get("name") not in ("musik_erkennen", "bildschirm_ansehen")]
            logger.info("Screen context active — filtered tools: %d remaining", len(tools))
        think = self.config.get("ollama_think", False) if think_override is None else think_override
        # Keep model loaded in VRAM (auto mode manages unloading via VRAM monitor)
        keep_alive = -1 if self.config.get("ollama_vram_mode", "auto") == "auto" else None
        async for item in self.backend.stream_chat(
            messages=messages,
            tools=tools,
            think=think,
            num_ctx=self.max_context_tokens,
            keep_alive=keep_alive,
            response_format=response_format,
        ):
            yield item

    async def get_available_models(self) -> list[str]:
        """Fetch available models from the current backend."""
        if self.backend is None:
            return []
        try:
            return await self.backend.get_available_models()
        except Exception as exc:
            logger.error("Failed to fetch models: %s", exc)
            return []

    def set_model(self, model: str) -> None:
        """Change the active model at runtime."""
        self.llm_model = model
        self._tools_supported = None
        self._tools_cache = None  # Invalidate tools cache
        if self.backend is not None:
            self.backend.model = model
        logger.info("Model changed to: %s", model)

    def new_conversation(self) -> str:
        """Start a new conversation session."""
        self._conversation_id = str(uuid.uuid4())
        logger.info("New conversation: %s", self._conversation_id)
        return self._conversation_id

    async def close(self) -> None:
        self.conversation_store.close()
        if self.backend is not None:
            for attr in ('_client', '_http_client'):
                client = getattr(self.backend, attr, None)
                if client is not None and not client.is_closed:
                    await client.aclose()
        logger.info("Orchestrator closed")
