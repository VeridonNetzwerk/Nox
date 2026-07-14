"""Tool handler – interface for LLM tool-calling.

Supports two modes:
1. Native tool-calling via Ollama's /api/chat with tools parameter
2. Prompt-based fallback parsing ([TOOL: name] params) for models without native support

Registered tools:
- kontext_suche: search nox_eye context
- notiz_speichern: save a note
- aktuelle_uhrzeit: get current time
"""

import json
import logging
import re
from datetime import datetime
from typing import Any, Callable, Optional

logger = logging.getLogger("nox.orchestrator.tools")

# Tool call pattern for fallback parsing
TOOL_PATTERN = re.compile(r'\[TOOL:\s*(\w+)\s*\]\s*(.*)', re.IGNORECASE)


class Tool:
    """Definition of a callable tool."""

    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: Callable[[dict[str, Any]], str],
    ):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.handler = handler

    def to_ollama_schema(self) -> dict[str, Any]:
        """Convert to Ollama tool schema format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# Short descriptions of settings the AI can read/change on request
SETTINGS_DESCRIPTIONS = {
    "ollama_model": "KI-Modell (z.B. qwen3:14b, qwen3:8b, qwen3:32b)",
    "ollama_host": "Ollama-Server-Adresse",
    "ollama_preload": "Modell beim Start laden (true/false)",
    "ollama_think": "Thinking-Modus aktivieren – tiefere Antworten, aber langsamer (true/false)",
    "ui_theme": "Design: system, dark oder light",
    "ui_scale": "UI-Größe (0.7 bis 1.6, Standard 1.0)",
    "analytics_enabled": "Anonyme Nutzungs-Analyse aktiv (true/false)",
    "system_language": "UI-Sprache (leer = auto, z.B. de_DE, en_US)",
    "hotkey": "Tastenkürzel zum Öffnen (z.B. CommandOrControl+Shift+Space)",
    "wake_word_enabled": "Wake-Word-Erkennung aktiv (true/false)",
    "wake_word_threshold": "Wake-Word-Empfindlichkeit 0.0-1.0",
    "tts_model": "Stimme für Sprachausgabe",
    "tts_engine": "TTS-Engine: kokoro, edge oder piper",
    "audio_input_device": "Mikrofon-Gerät (default oder Name)",
    "audio_output_device": "Lautsprecher-Gerät (default oder Name)",
    "vad_silence_duration": "Stille bis Aufnahme endet (Sekunden)",
    "end_turn_enabled": "End-of-Turn-Erkennung aktiv (true/false)",
    "end_turn_silence_threshold": "Grund-Stille für Turn-Ende (Sekunden)",
    "end_turn_max_silence": "Max Stille bevor Abbruch (Sekunden)",
    "nox_eye_enabled": "Kontext-Erfassung aktiv (true/false)",
    "nox_eye_ttl_days": "Kontext-Aufbewahrung in Tagen",
    "nox_eye_excluded_apps": "Apps die nicht erfasst werden (Liste)",
    "nox_eye_screenshot_interval": "Screenshot-Historie Intervall in Sekunden (Standard: 60)",
    "nox_files_enabled": "Dateisuche aktiv (true/false)",
    "nox_files_full_drive": "Ganze Festplatte indexieren (true/false)",
    "max_history_turns": "Gesprächsverlauf-Länge (Anzahl Turns)",
    "max_context_tokens": "Max Token-Kontextfenster",
    "audd_api_token": "Veraltet — Musikerkennung nutzt jetzt Shazam (kein Token nötig)",
    "music_platform": "Bevorzugte Musik-Plattform für Song-Links: spotify, apple_music, youtube (leer = Nutzer fragen)",
}


class ToolHandler:
    """Manages tool registration, execution, and fallback parsing."""

    def __init__(self, eye_manager=None, files_manager=None, settings_manager=None, apply_settings_fn=None, config=None, broadcast=None):
        self._tools: dict[str, Tool] = {}
        self._eye_manager = eye_manager
        self._files_manager = files_manager
        self._settings_manager = settings_manager
        self._apply_settings_fn = apply_settings_fn
        self._config = config or {}
        self._broadcast = broadcast
        self._tools_cache: Optional[list[dict[str, Any]]] = None
        self._last_music_result: Optional[dict[str, Any]] = None
        self._register_defaults()

    def _register_defaults(self) -> None:
        """Register built-in tools."""

        # kontext_suche
        self.register(Tool(
            name="kontext_suche",
            description="Durchsucht den erfassten Bildschirmkontext nach einem Stichwort.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Suchbegriff oder Frage zum Kontext",
                    }
                },
                "required": ["query"],
            },
            handler=self._tool_context_search,
        ))

        # notiz_speichern
        self.register(Tool(
            name="notiz_speichern",
            description="Speichert eine Notiz für später.",
            parameters={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Der Notiztext",
                    }
                },
                "required": ["text"],
            },
            handler=self._tool_save_note,
        ))

        # aktuelle_uhrzeit
        self.register(Tool(
            name="aktuelle_uhrzeit",
            description="Gibt die aktuelle Uhrzeit und das Datum zurück.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_current_time,
        ))

        # dateien_suchen
        self.register(Tool(
            name="dateien_suchen",
            description="Durchsucht lokale Dateien (Dokumente, Desktop, Downloads etc.) nach einem Stichwort. "
                        "Gibt Dateiname, Pfad und einen kurzen Textausschnitt zurück.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Suchbegriff – Volltext oder semantisch",
                    },
                    "ordner": {
                        "type": "string",
                        "description": "Optional: Pfadpräfix zum Einschränken der Suche auf einen Ordner",
                    },
                },
                "required": ["query"],
            },
            handler=self._tool_search_files,
        ))

        # datei_lesen
        self.register(Tool(
            name="datei_lesen",
            description="Liest den Textinhalt einer konkreten Datei vom lokalen Dateisystem. "
                        "Nur lesend – keine Ausführung, kein Schreiben.",
            parameters={
                "type": "object",
                "properties": {
                    "pfad": {
                        "type": "string",
                        "description": "Vollständiger Dateipfad",
                    },
                },
                "required": ["pfad"],
            },
            handler=self._tool_read_file,
        ))

        # bildschirm_lesen
        self.register(Tool(
            name="bildschirm_lesen",
            description="Liest den aktuellen Bildschirminhalt. Versucht zuerst UI-Automation "
                        "(Text aus dem aktiven Fenster), fällt zurück auf OCR (Screenshot + Texterkennung). "
                        "Verwende dies, wenn du wissen musst, was der Nutzer gerade auf dem Bildschirm sieht.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_read_screen,
        ))

        # screenshot_historie
        self.register(Tool(
            name="screenshot_historie",
            description="Gibt eine Übersicht der letzten Stunde Bildschirm-Historie zurück "
                        "(Zeitstempel und aktive Fenster pro Screenshot). "
                        "Verwende dies, um zu verstehen was der Nutzer in der letzten Stunde gemacht hat.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_screenshot_history,
        ))

        # einstellungen_lesen
        self.register(Tool(
            name="einstellungen_lesen",
            description="Listet alle Nox-Einstellungen mit aktuellem Wert und Kurzbeschreibung auf. "
                        "Verwende dies NUR wenn der Nutzer nach Einstellungen fragt oder eine ändern möchte.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_read_settings,
        ))

        # einstellung_aendern
        self.register(Tool(
            name="einstellung_aendern",
            description="Ändert eine Nox-Einstellung. Verwende einstellungen_lesen zuerst um gültige Werte zu sehen.",
            parameters={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Der Einstellungs-Name (z.B. ollama_model, ui_theme, wake_word_threshold)",
                    },
                    "value": {
                        "description": "Der neue Wert (String, Zahl, Boolean oder Liste)",
                    },
                },
                "required": ["key", "value"],
            },
            handler=self._tool_change_setting,
        ))

        # musik_erkennen
        self.register(Tool(
            name="musik_erkennen",
            description="Erkennt den aktuell auf dem PC abgespielten Song. "
                        "Nimmt kurze System-Audio auf und erkennt es via Shazam. "
                        "Verwende dies wenn der Nutzer fragt was für ein Song spielt oder welche Musik läuft.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_recognize_music,
        ))

        # fenster_schliessen
        self.register(Tool(
            name="fenster_schliessen",
            description="Versteckt das Nox-Fenster (es läuft im Hintergrund weiter). "
                        "Verwende dies wenn der Nutzer sagt 'schliess dich', 'mach das Fenster zu', 'versteck dich' etc. "
                        "Nox bleibt aktiv und kann mit Hey Nox oder Hotkey wieder geöffnet werden.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_close_window,
        ))

        # nox_beenden
        self.register(Tool(
            name="nox_beenden",
            description="Beendet Nox komplett – der gesamte Prozess wird geschlossen. "
                        "Verwende dies NUR wenn der Nutzer ausdrücklich sagt 'beenden', 'quit', 'schalt dich ab' etc. "
                        "Nach dem Beenden ist Nox nicht mehr verfügbar bis er manuell neu gestartet wird.",
            parameters={"type": "object", "properties": {}},
            handler=self._tool_quit_app,
        ))

        # app_oeffnen
        self.register(Tool(
            name="app_oeffnen",
            description="Startet ein Programm oder öffnet eine App auf dem PC. "
                        "Verwende dies wenn der Nutzer sagt 'öffne Chrome', 'starte Spotify', 'mach Word auf' etc. "
                        "Der Parameter 'name' ist der Name der App oder der Pfad zur ausführbaren Datei.",
            parameters={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name der App (z.B. 'chrome', 'spotify', 'notepad') oder vollständiger Pfad zur .exe",
                    },
                },
                "required": ["name"],
            },
            handler=self._tool_open_app,
        ))

        # system_steuerung
        self.register(Tool(
            name="system_steuerung",
            description="Steuert das System: PC sperren, herunterfahren, neu starten oder in den Ruhezustand versetzen. "
                        "Verwende dies wenn der Nutzer sagt 'fahr den PC runter', 'starte neu', 'sperre den PC', 'Ruhezustand' etc. "
                        "Der Parameter 'aktion' bestimmt was passieren soll: 'sperren', 'herunterfahren', 'neustart' oder 'ruhezustand'.",
            parameters={
                "type": "object",
                "properties": {
                    "aktion": {
                        "type": "string",
                        "description": "System-Aktion: 'sperren' (PC sperren), 'herunterfahren' (PC ausschalten), 'neustart' (PC neu starten), 'ruhezustand' (Standby/Ruhezustand)",
                    },
                },
                "required": ["aktion"],
            },
            handler=self._tool_system_control,
        ))

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool
        self._tools_cache = None
        logger.debug("Tool registered: %s", tool.name)

    def get_ollama_tools(self) -> list[dict[str, Any]]:
        """Get all tools in Ollama API format (cached)."""
        if self._tools_cache is None:
            self._tools_cache = [t.to_ollama_schema() for t in self._tools.values()]
        return self._tools_cache

    def has_tool(self, name: str) -> bool:
        return name in self._tools

    def execute(self, name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool by name with given arguments."""
        tool = self._tools.get(name)
        if not tool:
            return f"Fehler: Unbekanntes Werkzeug '{name}'"
        try:
            result = tool.handler(arguments)
            logger.info("Tool executed: %s -> %s", name, result[:100])
            return result
        except Exception as exc:
            logger.error("Tool execution failed (%s): %s", name, exc, exc_info=True)
            return f"Fehler bei Werkzeug '{name}': {exc}"

    def parse_fallback(self, text: str) -> Optional[tuple[str, str]]:
        """Parse [TOOL: name] params from LLM output (fallback mode).

        Returns (tool_name, params_string) or None if no tool call found.
        """
        match = TOOL_PATTERN.search(text)
        if match:
            return match.group(1).lower(), match.group(2).strip()
        return None

    def strip_tool_marker(self, text: str) -> str:
        """Remove tool call markers from text for display."""
        return TOOL_PATTERN.sub("", text).strip()

    # -----------------------------------------------------------------------
    # Default tool handlers
    # -----------------------------------------------------------------------

    def _tool_context_search(self, args: dict[str, Any]) -> str:
        """Search nox_eye context."""
        query = args.get("query", "")
        if not query or not self._eye_manager:
            return "Kein Kontext verfügbar."
        result = self._eye_manager.get_relevant_context(query, k=3, hours=12.0)
        return result if result else "Keine relevanten Kontexteinträge gefunden."

    def _tool_save_note(self, args: dict[str, Any]) -> str:
        """Save a note (stored as context with type 'note')."""
        text = args.get("text", "")
        if not text:
            return "Notiztext fehlt."
        if self._eye_manager:
            self._eye_manager.context_store.insert(
                app_name="nox",
                window_title="Notiz",
                content_type="note",
                content_text=text,
            )
        return f"Notiz gespeichert: {text[:80]}"

    def _tool_current_time(self, args: dict[str, Any]) -> str:
        """Return current time."""
        now = datetime.now()
        return now.strftime("Es ist %H:%M Uhr am %A, den %d. %B %Y.")

    def _tool_search_files(self, args: dict[str, Any]) -> str:
        """Search local files via nox_files."""
        query = args.get("query", "")
        folder = args.get("ordner")
        if not query:
            return "Kein Suchbegriff angegeben."
        if not self._files_manager:
            return "Dateisuche nicht verfügbar."

        try:
            results = self._files_manager.search(query, k=10, folder=folder)
            if not results:
                return "Keine passenden Dateien gefunden."

            lines = []
            for r in results:
                name = r.get("file_name", "")
                path = r.get("file_path", "")
                snippet = r.get("snippet", "")
                # Truncate snippet for tool output
                if len(snippet) > 200:
                    snippet = snippet[:200] + "..."
                lines.append(f"Datei: {name}\nPfad: {path}\nAusschnitt: {snippet}")

            return "\n---\n".join(lines)
        except Exception as exc:
            logger.error("dateien_suchen error: %s", exc, exc_info=True)
            return f"Fehler bei Dateisuche: {exc}"

    def _tool_read_file(self, args: dict[str, Any]) -> str:
        """Read a specific file's content via nox_files."""
        file_path = args.get("pfad", "")
        if not file_path:
            return "Kein Dateipfad angegeben."
        if not self._files_manager:
            return "Dateisuche nicht verfügbar."

        try:
            content = self._files_manager.read_file(file_path)
            if content is None:
                return f"Datei nicht gefunden oder nicht lesbar: {file_path}"
            return content
        except Exception as exc:
            logger.error("datei_lesen error: %s", exc, exc_info=True)
            return f"Fehler beim Lesen der Datei: {exc}"

    def _tool_read_screen(self, args: dict[str, Any]) -> str:
        """Read current screen content on-demand (bildschirm_lesen tool)."""
        if not self._eye_manager:
            return "Bildschirm-Erfassung nicht verfügbar."
        result = self._eye_manager.read_screen_now()
        return result if result else "Kein Bildschirminhalt erfasst."

    def _tool_screenshot_history(self, args: dict[str, Any]) -> str:
        """Return screenshot history summary (screenshot_historie tool)."""
        if not self._eye_manager:
            return "Screenshot-Historie nicht verfügbar."
        result = self._eye_manager.get_screenshot_history_summary()
        return result if result else "Keine Screenshot-Historie verfügbar."

    def _tool_read_settings(self, args: dict[str, Any]) -> str:
        """Return all settings with current values and short descriptions."""
        if not self._settings_manager:
            return "Einstellungen nicht verfügbar."
        cfg = self._settings_manager.config
        lines = []
        for key, desc in sorted(SETTINGS_DESCRIPTIONS.items()):
            val = cfg.get(key, "(nicht gesetzt)")
            lines.append(f"{key} = {val}  — {desc}")
        return "Aktuelle Nox-Einstellungen:\n\n" + "\n".join(lines)

    def _tool_change_setting(self, args: dict[str, Any]) -> str:
        """Change a single setting and apply it."""
        if not self._settings_manager:
            return "Einstellungen nicht verfügbar."
        key = args.get("key", "").strip()
        value = args.get("value")
        if not key:
            return "Kein Einstellungs-Name angegeben."
        if key not in SETTINGS_DESCRIPTIONS:
            return f"Unbekannte Einstellung '{key}'. Verwende einstellungen_lesen um gültige Einstellungen zu sehen."
        try:
            updates = {key: value}
            self._settings_manager.save(updates)
            if self._apply_settings_fn:
                self._apply_settings_fn(updates)

            # If the user just picked their music platform, open the last recognized song
            if key == "music_platform" and self._last_music_result:
                platform = str(value).strip().lower()
                url_map = {
                    "spotify": self._last_music_result.get("spotify_url", ""),
                    "apple_music": self._last_music_result.get("apple_music_url", ""),
                    "youtube": self._last_music_result.get("youtube_url", ""),
                    "youtube_music": self._last_music_result.get("youtube_music_url", ""),
                    "amazon_music": self._last_music_result.get("amazon_music_url", ""),
                    "deezer": self._last_music_result.get("deezer_url", ""),
                    "tidal": self._last_music_result.get("tidal_url", ""),
                    "soundcloud": self._last_music_result.get("soundcloud_url", ""),
                }
                url = url_map.get(platform, "")
                if not url:
                    url = self._last_music_result.get("youtube_url", "")
                    platform = "youtube"
                if url:
                    self._open_url_external(url)
                    self._broadcast_music_result(self._last_music_result, opened_platform=platform)
                    return f"Ich öffne den Song auf {platform}."

            return f"Einstellung '{key}' geändert auf: {value}"
        except Exception as exc:
            return f"Fehler beim Ändern von '{key}': {exc}"

    def _tool_recognize_music(self, args: dict[str, Any]) -> str:
        """Recognize currently playing music from system audio loopback."""
        output_device = self._config.get("audio_output_device", "default")
        try:
            from nox_voice.music_recognizer import recognize_song
            result = recognize_song(output_device=output_device)
            if "error" in result:
                return result["error"]
            parts = []
            if result.get("artist"):
                parts.append(f"Künstler: {result['artist']}")
            if result.get("title"):
                parts.append(f"Titel: {result['title']}")
            if result.get("album"):
                parts.append(f"Album: {result['album']}")
            if result.get("release_date"):
                parts.append(f"Veröffentlichung: {result['release_date']}")
            if not parts:
                return "Kein Song erkannt."

            self._last_music_result = result
            self._broadcast_music_result(result)

            # Check preferred music platform and open song there
            platform = self._config.get("music_platform", "").strip().lower()
            platform_urls = {
                "spotify": result.get("spotify_url", ""),
                "apple_music": result.get("apple_music_url", ""),
                "youtube": result.get("youtube_url", ""),
            }

            if platform and platform in platform_urls and platform_urls[platform]:
                url = platform_urls[platform]
                self._open_url_external(url)
                parts.append(f"Geöffnet auf {platform}")
            elif platform and platform in platform_urls:
                # Platform set but no URL for it — try YouTube fallback
                yt = platform_urls.get("youtube", "")
                if yt:
                    self._open_url_external(yt)
                    parts.append(f"Geöffnet auf YouTube (kein {platform}-Link verfügbar)")
            else:
                # No platform set — UI will let the user pick; ask them to choose in UI
                return (
                    "Ich habe den Song erkannt. Wähle in der Karte eine Plattform, "
                    "auf der du den Song öffnen möchtest."
                )

            return " | ".join(parts)
        except Exception as exc:
            logger.error("musik_erkennen error: %s", exc, exc_info=True)
            return f"Musikerkennung fehlgeschlagen: {exc}"

    def _broadcast_music_result(self, result: dict[str, Any], opened_platform: str = "") -> None:
        """Send a structured music result event to the UI."""
        if not self._broadcast:
            return
        try:
            import asyncio
            payload = {
                "type": "music_result",
                "artist": result.get("artist", ""),
                "title": result.get("title", ""),
                "album": result.get("album", ""),
                "cover_url": result.get("cover_url", ""),
                "release_date": result.get("release_date", ""),
                "spotify_url": result.get("spotify_url", ""),
                "apple_music_url": result.get("apple_music_url", ""),
                "youtube_url": result.get("youtube_url", ""),
                "youtube_music_url": result.get("youtube_music_url", ""),
                "amazon_music_url": result.get("amazon_music_url", ""),
                "deezer_url": result.get("deezer_url", ""),
                "tidal_url": result.get("tidal_url", ""),
                "soundcloud_url": result.get("soundcloud_url", ""),
                "opened_platform": opened_platform,
            }
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(self._broadcast(payload), loop)
        except Exception:
            pass

    def _open_url_external(self, url: str) -> None:
        """Open a URL in the system default browser."""
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception as exc:
            logger.warning("Failed to open URL %s: %s", url, exc)

    def _tool_close_window(self, args: dict[str, Any]) -> str:
        """Hide the Nox window (app stays running in background)."""
        if self._broadcast:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._broadcast({"type": "close_window"}), loop
                    )
            except Exception:
                pass
        return "Fenster geschlossen. Du kannst mich mit Hey Nox oder dem Hotkey wieder aufrufen."

    def _tool_quit_app(self, args: dict[str, Any]) -> str:
        """Quit the Nox application completely."""
        if self._broadcast:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._broadcast({"type": "quit_app"}), loop
                    )
            except Exception:
                pass
        return "Nox wird beendet. Bis zum nächsten Mal."

    # Known app aliases → executable name or command
    _APP_ALIASES = {
        # Browsers
        "chrome": "chrome",
        "google chrome": "chrome",
        "firefox": "firefox",
        "edge": "msedge",
        "microsoft edge": "msedge",
        "brave": "brave",
        "opera": "opera",
        # Media
        "spotify": "spotify",
        "vlc": "vlc",
        "netflix": "start netflix:",
        # Communication
        "discord": "discord",
        "teams": "teams",
        "microsoft teams": "teams",
        "zoom": "zoom",
        "skype": "skype",
        "slack": "slack",
        # Office
        "word": "winword",
        "excel": "excel",
        "powerpoint": "powerpnt",
        "outlook": "outlook",
        "onenote": "onenote",
        # Dev tools
        "vscode": "code",
        "visual studio code": "code",
        "code": "code",
        "notepad": "notepad",
        "notepad++": "notepad++",
        "terminal": "wt",
        "cmd": "cmd",
        "powershell": "powershell",
        "git": "git",
        # System
        "calculator": "calc",
        "rechner": "calc",
        "explorer": "explorer",
        "file explorer": "explorer",
        "task manager": "taskmgr",
        "task-manager": "taskmgr",
        "settings": "start ms-settings:",
        "einstellungen": "start ms-settings:",
        # Games
        "steam": "steam",
        "epic games": "epicgames",
        "battle.net": "battle.net",
        # Other
        "paint": "mspaint",
        "snipping tool": "snippingtool",
        "screenshot": "snippingtool",
        "clock": "clock",
        "uhr": "clock",
        "calculator": "calc",
    }

    # UWP apps that need 'start <protocol>:' instead of direct exe
    _UWP_APPS = {
        "netflix": "start netfix:",
        "settings": "start ms-settings:",
        "einstellungen": "start ms-settings:",
        "calculator": "calc",
        "rechner": "calc",
        "clock": "start ms-clock:",
        "uhr": "start ms-clock:",
        "snipping tool": "snippingtool",
        "screenshot": "snippingtool",
    }

    def _tool_open_app(self, args: dict[str, Any]) -> str:
        """Open an application on the PC."""
        import subprocess
        import shutil
        import os

        name = args.get("name", "").strip()
        if not name:
            return "Kein App-Name angegeben."

        name_lower = name.lower().strip()

        # If it's a URL, open in browser
        if name_lower.startswith(("http://", "https://")):
            try:
                os.startfile(name)
                return f"Geöffnet: {name}"
            except Exception as exc:
                return f"Konnte URL nicht öffnen: {exc}"

        # If it's a full path to an .exe, launch directly
        if name_lower.endswith(".exe") and os.path.isfile(name):
            try:
                subprocess.Popen([name])
                return f"App gestartet: {os.path.basename(name)}"
            except Exception as exc:
                return f"Konnte App nicht starten: {exc}"

        # Check alias mapping
        alias_cmd = self._APP_ALIASES.get(name_lower)
        if alias_cmd:
            try:
                # UWP apps use 'start protocol:' syntax
                if alias_cmd.startswith("start "):
                    subprocess.Popen(alias_cmd, shell=True)
                    return f"App gestartet: {name}"
                # Built-in Windows apps (calc, notepad, etc.)
                if alias_cmd in ("calc", "notepad", "mspaint", "explorer", "cmd", "taskmgr", "wt"):
                    subprocess.Popen(alias_cmd, shell=True)
                    return f"App gestartet: {name}"
                # Try to find the executable on PATH
                exe_path = shutil.which(alias_cmd)
                if exe_path:
                    subprocess.Popen([exe_path])
                    return f"App gestartet: {name}"
                # Fallback: try shell=True with the command
                subprocess.Popen(alias_cmd, shell=True)
                return f"App gestartet: {name}"
            except Exception as exc:
                logger.error("app_oeffnen alias failed for '%s': %s", name, exc)
                return f"Konnte '{name}' nicht starten: {exc}"

        # No alias found — try to find executable on PATH by the given name
        exe_candidates = [name_lower, f"{name_lower}.exe"]
        for candidate in exe_candidates:
            exe_path = shutil.which(candidate)
            if exe_path:
                try:
                    subprocess.Popen([exe_path])
                    return f"App gestartet: {name}"
                except Exception as exc:
                    return f"Konnte '{name}' nicht starten: {exc}"

        # Last resort: try 'start' command which uses Windows shell resolution
        try:
            subprocess.Popen(f"start {name}", shell=True)
            return f"App gestartet: {name}"
        except Exception as exc:
            return f"Konnte '{name}' nicht finden oder starten: {exc}"

    # System control action aliases
    _SYSTEM_ACTION_ALIASES = {
        # Sperren
        "sperren": "sperren",
        "sperre": "sperren",
        "lock": "sperren",
        "pc sperren": "sperren",
        "sitzung sperren": "sperren",
        # Herunterfahren
        "herunterfahren": "herunterfahren",
        "herunterfahren": "herunterfahren",
        "ausschalten": "herunterfahren",
        "shutdown": "herunterfahren",
        "pc ausschalten": "herunterfahren",
        "pc herunterfahren": "herunterfahren",
        "power off": "herunterfahren",
        # Neustart
        "neustart": "neustart",
        "neu starten": "neustart",
        "neustarten": "neustart",
        "restart": "neustart",
        "reboot": "neustart",
        "pc neustart": "neustart",
        "pc neu starten": "neustart",
        # Ruhezustand
        "ruhezustand": "ruhezustand",
        "standby": "ruhezustand",
        "sleep": "ruhezustand",
        "hibernate": "ruhezustand",
        "energiesparen": "ruhezustand",
        "pc in ruhezustand": "ruhezustand",
        "pc schlafen": "ruhezustand",
    }

    def _tool_system_control(self, args: dict[str, Any]) -> str:
        """Control the system: lock, shutdown, restart, or hibernate."""
        import subprocess
        import ctypes

        aktion_raw = args.get("aktion", "").strip().lower()
        if not aktion_raw:
            return "Keine Aktion angegeben. Verfügbare Aktionen: sperren, herunterfahren, neustart, ruhezustand."

        # Resolve alias
        aktion = self._SYSTEM_ACTION_ALIASES.get(aktion_raw, aktion_raw)

        if aktion == "sperren":
            try:
                # LockWorkStation from user32.dll
                ctypes.windll.user32.LockWorkStation()
                return "PC wird gesperrt."
            except Exception as exc:
                logger.error("system_steuerung sperren failed: %s", exc)
                return f"Konnte PC nicht sperren: {exc}"

        elif aktion == "herunterfahren":
            try:
                # shutdown /s /t 0 — immediate shutdown
                subprocess.Popen(["shutdown", "/s", "/t", "0"])
                return "PC wird heruntergefahren. Bis bald!"
            except Exception as exc:
                logger.error("system_steuerung herunterfahren failed: %s", exc)
                return f"Konnte PC nicht herunterfahren: {exc}"

        elif aktion == "neustart":
            try:
                # shutdown /r /t 0 — immediate restart
                subprocess.Popen(["shutdown", "/r", "/t", "0"])
                return "PC wird neu gestartet. Bis gleich!"
            except Exception as exc:
                logger.error("system_steuerung neustart failed: %s", exc)
                return f"Konnte PC nicht neu starten: {exc}"

        elif aktion == "ruhezustand":
            try:
                # Try hibernate first (saves to disk), fall back to sleep
                # rundll32.exe powrprof.dll,SetSuspendState 0,1,0 = hibernate
                # rundll32.exe powrprof.dll,SetSuspendState 0,0,0 = sleep (standby)
                subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
                return "PC geht in den Ruhezustand."
            except Exception as exc:
                logger.error("system_steuerung ruhezustand failed: %s", exc)
                return f"Konnte PC nicht in den Ruhezustand versetzen: {exc}"

        else:
            return f"Unbekannte Aktion '{aktion_raw}'. Verfügbare Aktionen: sperren, herunterfahren, neustart, ruhezustand."
