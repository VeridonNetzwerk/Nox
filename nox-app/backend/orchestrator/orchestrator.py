"""Orchestrator – central coordination for chat processing.

Pipeline per incoming message:
1. Retrieve relevant context from nox_eye
2. Load conversation history from SQLite
3. Build structured prompt: system prompt + context + history + new message
4. Stream Ollama response token-by-token via WebSocket
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

from .conversation_store import ConversationStore
from .system_prompt import build_system_prompt
from .tool_handler import ToolHandler

logger = logging.getLogger("nox.orchestrator")


class SentenceBuffer:
    """Accumulates streamed tokens and emits complete sentences for TTS."""

    SENTENCE_END = re.compile(r'[.!?]\s')

    def __init__(self):
        self._buffer = ""

    def feed(self, token: str) -> list[str]:
        self._buffer += token
        sentences = []
        while True:
            match = self.SENTENCE_END.search(self._buffer)
            if match:
                end = match.end()
                sentence = self._buffer[:end].strip()
                if sentence:
                    sentences.append(sentence)
                self._buffer = self._buffer[end:]
            else:
                break
        return sentences

    def flush(self) -> str:
        remaining = self._buffer.strip()
        self._buffer = ""
        return remaining if remaining else ""


def _parse_timer_params(params: str) -> dict[str, Any]:
    """Parse timer_stellen fallback params: 'timer minuten=10 nachricht=Pizza' etc."""
    parts = params.split()
    if not parts:
        return {"aktion": ""}
    result: dict[str, Any] = {"aktion": parts[0]}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip().lower()
            value = value.strip()
            if key in ("minuten", "sekunden"):
                try:
                    result[key] = float(value)
                except ValueError:
                    pass
            elif key == "uhrzeit":
                result[key] = value
            elif key == "nachricht":
                result[key] = value
    # If no nachricht was found, collect remaining non-key=value parts as nachricht
    msg_parts = [p for p in parts[1:] if "=" not in p]
    if msg_parts and "nachricht" not in result:
        result["nachricht"] = " ".join(msg_parts)
    return result


def _parse_reminder_params(params: str) -> dict[str, Any]:
    """Parse erinnerung_speichern fallback params: 'speichern zeitpunkt=morgen 08:00 text=Müll rausbringen' etc."""
    parts = params.split()
    if not parts:
        return {"aktion": ""}
    result: dict[str, Any] = {"aktion": parts[0]}
    # Find key=value pairs — but zeitpunkt and text values may contain spaces
    # Strategy: find keys, then everything between keys is the value
    remaining = parts[1:]
    keys = ["zeitpunkt", "text", "id"]
    i = 0
    while i < len(remaining):
        part = remaining[i]
        if "=" in part:
            key, value = part.split("=", 1)
            key = key.strip().lower()
            value = value.strip()
            # Collect continuation parts until next key=value or end
            j = i + 1
            while j < len(remaining) and "=" not in remaining[j]:
                value += " " + remaining[j]
                j += 1
            if key in keys:
                if key == "id":
                    try:
                        result[key] = int(value)
                    except ValueError:
                        pass
                else:
                    result[key] = value
            i = j
        else:
            i += 1
    return result


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
        self.ollama_host = config.get("ollama_host", "http://localhost:11434")
        self.ollama_model = config.get("ollama_model", "qwen3:14b")
        self.max_context_tokens = config.get("max_context_tokens", 4096)
        self.max_history_turns = config.get("max_history_turns", 10)

        self.eye_manager = eye_manager
        self.voice_manager = voice_manager
        self.files_manager = files_manager
        self._broadcast = broadcast or (lambda msg: None)

        # Conversation store (shared nox.db)
        self.conversation_store = ConversationStore(
            db_path=config.get("memory_db_path", ""),
            ollama_host=self.ollama_host,
            ollama_model=self.ollama_model,
            max_context_tokens=self.max_context_tokens,
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

        logger.info("Orchestrator initialized (model=%s, conv=%s)", self.ollama_model, self._conversation_id)

        self._tools_supported: Optional[bool] = None

        # Persistent HTTP client for Ollama (reused across requests)
        self._http_client: Optional[httpx.AsyncClient] = None

        # Cache for Ollama tools schema
        self._tools_cache: Optional[list[dict[str, Any]]] = None

        # Abort flag — set by abort() to cancel the current process_message
        self._aborted = False

    @property
    def conversation_id(self) -> str:
        return self._conversation_id

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create a persistent HTTP client for Ollama."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=300.0)
        return self._http_client

    async def _check_tools_support(self) -> bool:
        """Check if the current Ollama model supports native tool calling."""
        if self._tools_supported is not None:
            return self._tools_supported
        try:
            client = await self._get_http_client()
            resp = await client.get(f"{self.ollama_host}/api/tags", timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    if m.get("name") == self.ollama_model or m.get("model") == self.ollama_model:
                        caps = m.get("capabilities", [])
                        self._tools_supported = "tools" in caps
                        logger.info("Model %s tools support: %s (capabilities: %s)",
                                    self.ollama_model, self._tools_supported, caps)
                        return self._tools_supported
        except Exception as exc:
            logger.warning("Failed to check model capabilities: %s", exc)
        self._tools_supported = False
        return False

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
    ) -> None:
        """Process an incoming message end-to-end.

        1. Build messages with system prompt + history
        2. Stream Ollama response
        3. Pipe to TTS in voice mode
        4. Handle tool calls (including bildschirm_lesen for screen context)
        5. Persist turns
        """
        # No auto-context injection — AI must use bildschirm_lesen tool explicitly
        context = context_override or ""

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

        # 3. Build messages (system + summary + history + new message)
        messages = self.conversation_store.build_messages(
            conversation_id=self._conversation_id,
            system_prompt=system_prompt,
            new_message=message,
            context=None,  # context already in system prompt
            max_turns=self.max_history_turns,
        )

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

        # 5. Stream response
        sentence_buffer = SentenceBuffer()
        full_response = ""
        tool_executed = False

        use_native_tools = await self._check_tools_support()

        try:
            async for item in self._stream_ollama(messages, use_tools=use_native_tools):
                if self._aborted:
                    logger.info("Orchestrator: aborted during streaming")
                    break
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
                            tool_result = await asyncio.get_event_loop().run_in_executor(
                                None, self.tool_handler.execute, tool_name, tool_args
                            )
                            tool_executed = True
                            await _send({"type": "tool_start", "tool": tool_name})
                            await _send({"type": "tool_result", "tool": tool_name, "result": tool_result})
                            messages.append({"role": "assistant", "content": "", "tool_calls": [tc]})
                            messages.append({"role": "user", "content": f"Werkzeug-Ergebnis: {tool_result}\n\nBitte antworte basierend auf diesem Ergebnis."})
                            full_response = ""
                            sentence_buffer = SentenceBuffer()
                            async for token2 in self._stream_ollama(messages, use_tools=False):
                                if self._aborted:
                                    break
                                full_response += token2
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
                        if tool_name == "datei_lesen":
                            tool_args = {"pfad": tool_params}
                        elif tool_name == "dateien_suchen":
                            tool_args = {"query": tool_params}
                        elif tool_name == "einstellung_aendern":
                            m = re.match(r'key=(\S+)\s+value=(.+)', tool_params)
                            if m:
                                tool_args = {"key": m.group(1), "value": m.group(2).strip()}
                            else:
                                tool_args = {"key": "", "value": ""}
                        elif tool_name == "einstellungen_lesen":
                            tool_args = {}
                        elif tool_name == "app_oeffnen":
                            tool_args = {"name": tool_params}
                        elif tool_name == "system_steuerung":
                            tool_args = {"aktion": tool_params}
                        elif tool_name == "lautstaerke":
                            m = re.match(r'(\w+)\s+wert=(\d+)', tool_params)
                            if m:
                                tool_args = {"aktion": m.group(1), "wert": int(m.group(2))}
                            else:
                                tool_args = {"aktion": tool_params}
                        elif tool_name == "search_web":
                            tool_args = {"query": tool_params}
                        elif tool_name == "website_oeffnen":
                            tool_args = {"url_oder_suche": tool_params}
                        elif tool_name == "fenster_fokus":
                            parts = tool_params.split(None, 1)
                            if len(parts) >= 2:
                                tool_args = {"aktion": parts[0], "name": parts[1]}
                            else:
                                tool_args = {"aktion": parts[0] if parts else "", "name": ""}
                        elif tool_name == "timer_stellen":
                            tool_args = _parse_timer_params(tool_params)
                        elif tool_name == "erinnerung_speichern":
                            tool_args = _parse_reminder_params(tool_params)
                        elif tool_name == "zwischenablage":
                            m = re.match(r'(\w+)\s+text=(.+)', tool_params, re.DOTALL)
                            if m:
                                tool_args = {"aktion": m.group(1), "text": m.group(2).strip()}
                            else:
                                tool_args = {"aktion": tool_params}
                        elif tool_name in ("bildschirm_lesen", "screenshot_historie", "musik_erkennen", "aktuelle_uhrzeit", "fenster_schliessen", "nox_beenden"):
                            tool_args = {}
                        else:
                            tool_args = {"query": tool_params, "text": tool_params}
                        tool_result = await asyncio.get_event_loop().run_in_executor(
                            None, self.tool_handler.execute, tool_name, tool_args
                        )
                        tool_executed = True
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
                        async for token2 in self._stream_ollama(messages):
                            if self._aborted:
                                break
                            full_response += token2
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
            self.conversation_store.add_turn(
                self._conversation_id, "assistant", clean_response,
                token_count=len(clean_response) // 4,
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
                await _send({"type": "done", "content": clean_response})
                logger.info("Response complete: len=%d", len(clean_response))

        except httpx.ConnectError:
            logger.error("Ollama not reachable")
            await _send({
                "type": "error",
                "content": f"Ollama ist nicht erreichbar unter {self.ollama_host}. Bitte Ollama starten.",
            })
            await _send({"type": "done"})
        except httpx.HTTPStatusError as exc:
            logger.error("Ollama HTTP error: %s", exc)
            user_msg = self._format_ollama_error(exc)
            await _send({"type": "error", "content": user_msg})
            await _send({"type": "done"})
        except Exception as exc:
            logger.error("Orchestrator error: %s", exc, exc_info=True)
            await _send({"type": "error", "content": f"Fehler: {exc}"})
            await _send({"type": "done"})

    def _format_ollama_error(self, exc: httpx.HTTPStatusError) -> str:
        """Format an Ollama HTTP error into a user-friendly German message."""
        status = exc.response.status_code if exc.response else 0
        ollama_err = ""
        if exc.response:
            try:
                body = exc.response.json()
                ollama_err = body.get("error", "")
            except Exception:
                try:
                    raw = exc.response.content
                    body = json.loads(raw)
                    ollama_err = body.get("error", "")
                except Exception:
                    ollama_err = exc.response.text if hasattr(exc.response, 'text') else ""

        if status == 500 and ollama_err:
            err_lower = ollama_err.lower()
            if "memory" in err_lower or "ram" in err_lower or "vram" in err_lower:
                return (
                    f"Das KI-Modell '{self.ollama_model}' ist zu groß für den verfügbaren Arbeitsspeicher. "
                    f"Ollama meldet: {ollama_err}\n"
                    "Bitte wähle in den Einstellungen ein kleineres Modell oder schließe speicherintensive Programme."
                )
            if "model" in err_lower and ("not found" in err_lower or "does not exist" in err_lower):
                return (
                    f"Das KI-Modell '{self.ollama_model}' ist nicht installiert. "
                    "Bitte lade es mit 'ollama pull' herunter oder wähle ein anderes Modell in den Einstellungen."
                )
            return f"Ollama-Fehler: {ollama_err}"

        if status == 404:
            return (
                f"Das KI-Modell '{self.ollama_model}' wurde nicht gefunden. "
                "Bitte installiere es mit 'ollama pull' oder wähle ein anderes Modell."
            )

        return f"Ollama-Fehler (HTTP {status}): {ollama_err or str(exc)}"

    async def _stream_ollama(
        self,
        messages: list[dict[str, str]],
        use_tools: bool = False,
    ) -> AsyncIterator[Any]:
        """Stream tokens from Ollama /api/chat endpoint.

        Uses the chat API (not generate) for proper multi-turn support.
        If use_tools is True, sends native tool definitions to Ollama.
        Yields str tokens, or a dict with 'tool_calls' key as a sentinel.
        """
        payload = {
            "model": self.ollama_model,
            "messages": messages,
            "stream": True,
            "think": self.config.get("ollama_think", False),
        }
        if use_tools:
            payload["tools"] = self.tool_handler.get_ollama_tools()

        client = await self._get_http_client()
        async with client.stream(
            "POST",
            f"{self.ollama_host}/api/chat",
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                try:
                    err_body = json.loads(body)
                except Exception:
                    err_body = {"error": body.decode(errors="replace")}
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}",
                    request=resp.request,
                    response=httpx.Response(
                        resp.status_code,
                        content=body,
                        headers=dict(resp.headers),
                        request=resp.request,
                    ),
                )
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON from Ollama stream: %s", line[:200])
                    continue
                msg = chunk.get("message", {})
                token = msg.get("content", "")
                thinking = msg.get("thinking", "")
                # Check for native tool calls
                tool_calls = msg.get("tool_calls", [])
                if tool_calls:
                    yield {"tool_calls": tool_calls}
                    continue
                if token:
                    yield token
                if chunk.get("done", False):
                    break

    async def get_available_models(self) -> list[str]:
        """Fetch available models from Ollama."""
        try:
            client = await self._get_http_client()
            resp = await client.get(f"{self.ollama_host}/api/tags", timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return [m.get("name", "") for m in data.get("models", [])]
        except Exception as exc:
            logger.error("Failed to fetch models: %s", exc)
            return []

    def set_model(self, model: str) -> None:
        """Change the active Ollama model at runtime."""
        self.ollama_model = model
        self.conversation_store.ollama_model = model
        self._tools_supported = None
        self._tools_cache = None  # Invalidate tools cache
        logger.info("Model changed to: %s", model)

    def new_conversation(self) -> str:
        """Start a new conversation session."""
        self._conversation_id = str(uuid.uuid4())
        logger.info("New conversation: %s", self._conversation_id)
        return self._conversation_id

    async def close(self) -> None:
        self.conversation_store.close()
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("Orchestrator closed")
