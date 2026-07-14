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

        # lautstaerke
        self.register(Tool(
            name="lautstaerke",
            description="Steuert die System-Lautstärke: lauter, leiser, stumm (mute), stumm aus (unmute), oder auf einen bestimmten Wert setzen. "
                        "Verwende dies wenn der Nutzer sagt 'mach lauter', 'leiser', 'stumm', 'lautstärke auf 50' etc. "
                        "Der Parameter 'aktion' bestimmt was passieren soll: 'lauter', 'leiser', 'mute', 'unmute', 'setzen', 'restore'. "
                        "Der optionale Parameter 'wert' ist die Lautstärke in Prozent (0-100) für die Aktion 'setzen'. "
                        "Erkennt automatisch VoiceMeeter wenn es läuft und steuert es darüber, sonst Windows-Lautstärke.",
            parameters={
                "type": "object",
                "properties": {
                    "aktion": {
                        "type": "string",
                        "description": "Lautstärke-Aktion: 'lauter', 'leiser', 'mute', 'unmute', 'setzen', 'restore' (vorherige Lautstärke wiederherstellen)",
                    },
                    "wert": {
                        "type": "number",
                        "description": "Lautstärke in Prozent (0-100), nur für Aktion 'setzen'",
                    },
                },
                "required": ["aktion"],
            },
            handler=self._tool_volume_control,
        ))

        # search_web
        self.register(Tool(
            name="search_web",
            description="Durchsucht das Web nach aktuellen Informationen. Verwende dies wenn der Nutzer nach aktuellen Fakten, "
                        "Nachrichten, Definitionen oder Dingen fragt die du nicht sicher weisst. "
                        "Gibt Suchergebnisse mit Titel, URL und kurzem Textausschnitt zurück. "
                        "Keine API benötigt — nutzt DuckDuckGo.",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Suchbegriff oder Frage",
                    },
                    "count": {
                        "type": "number",
                        "description": "Anzahl der Ergebnisse (Standard: 5, Max: 10)",
                    },
                },
                "required": ["query"],
            },
            handler=self._tool_search_web,
        ))

        # website_oeffnen
        self.register(Tool(
            name="website_oeffnen",
            description="Öffnet eine Website im Standard-Browser oder startet eine Google-Suche im Browser. "
                        "Verwende dies wenn der Nutzer sagt 'öffne youtube.com', 'geh auf github', 'suche nach Katzenbildern' etc. "
                        "Der Parameter 'url_oder_suche' ist entweder eine URL (z.B. 'youtube.com') oder ein Suchbegriff für Google.",
            parameters={
                "type": "object",
                "properties": {
                    "url_oder_suche": {
                        "type": "string",
                        "description": "URL (z.B. 'youtube.com', 'https://github.com') oder Suchbegriff für Google (z.B. 'Katzenbilder', 'Python Tutorial')",
                    },
                },
                "required": ["url_oder_suche"],
            },
            handler=self._tool_open_website,
        ))

        # fenster_fokus
        self.register(Tool(
            name="fenster_fokus",
            description="Wechselt zu einem Fenster, minimiert oder maximiert es. "
                        "Verwende dies wenn der Nutzer sagt 'wechsel zu Chrome', 'minimiere Spotify', 'maximiere Firefox', "
                        "'bringe Word nach vorne', 'mach das Fenster kleiner' etc. "
                        "Der Parameter 'aktion' bestimmt was passieren soll: 'fokus', 'minimieren', 'maximieren', 'wiederherstellen', 'schliessen'. "
                        "Der Parameter 'name' ist der Fenstertitel oder App-Name (z.B. 'Chrome', 'Spotify', 'Firefox').",
            parameters={
                "type": "object",
                "properties": {
                    "aktion": {
                        "type": "string",
                        "description": "Fenster-Aktion: 'fokus' (in den Vordergrund bringen), 'minimieren', 'maximieren', 'wiederherstellen' (aus minimiert/maximiert zurück), 'schliessen' (Fenster schliessen)",
                    },
                    "name": {
                        "type": "string",
                        "description": "Fenstertitel oder App-Name (z.B. 'Chrome', 'Spotify', 'Firefox', 'Notepad')",
                    },
                },
                "required": ["aktion", "name"],
            },
            handler=self._tool_window_focus,
        ))

        # timer_stellen
        self.register(Tool(
            name="timer_stellen",
            description="Stellt einen Timer, Wecker oder eine Erinnerung. "
                        "Verwende dies wenn der Nutzer sagt 'erinnere mich in 10 Minuten', 'wecke mich um 7 Uhr', 'Timer auf 5 Minuten', 'in 30 Minuten erinnern' etc. "
                        "Der Parameter 'aktion' bestimmt was passieren soll: 'timer' (Countdown), 'wecker' (zu einer bestimmten Uhrzeit), 'liste' (aktive Timer anzeigen), 'abbrechen' (Timer abbrechen). "
                        "Für 'timer': der Parameter 'minuten' (und optional 'sekunden') gibt die Dauer an. "
                        "Für 'wecker': der Parameter 'uhrzeit' gibt die Zielzeit im Format HH:MM an. "
                        "Der optionale Parameter 'nachricht' ist der Erinnerungstext.",
            parameters={
                "type": "object",
                "properties": {
                    "aktion": {
                        "type": "string",
                        "description": "Timer-Aktion: 'timer' (Countdown starten), 'wecker' (Wecker zu bestimmter Uhrzeit), 'liste' (aktive Timer auflisten), 'abbrechen' (Timer abbrechen)",
                    },
                    "minuten": {
                        "type": "number",
                        "description": "Dauer in Minuten (für Aktion 'timer')",
                    },
                    "sekunden": {
                        "type": "number",
                        "description": "Zusätzliche Sekunden (für Aktion 'timer')",
                    },
                    "uhrzeit": {
                        "type": "string",
                        "description": "Zieluhrzeit im Format HH:MM (für Aktion 'wecker'), z.B. '07:00', '14:30'",
                    },
                    "nachricht": {
                        "type": "string",
                        "description": "Erinnerungstext der gesprochen und angezeigt wird wenn der Timer abläuft",
                    },
                },
                "required": ["aktion"],
            },
            handler=self._tool_timer,
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

    # Volume control state — remembers previous volume for restore
    _saved_volume: Optional[float] = None
    _saved_mute: Optional[bool] = None
    _vmr_dll = None
    _vmr_logged_in = False

    # VoiceMeeter process names to check
    _VOICEMEETER_PROCESSES = {
        "voicemeeter8.exe",
        "voicemeeter8x64.exe",
        "voicemeeter7.exe",
        "voicemeeter7x64.exe",
        "voicemeeter6.exe",
        "voicemeeter6x64.exe",
        "voicemeeter5.exe",
        "voicemeeter5x64.exe",
        "voicemeeter.exe",
        "voicemeeterx64.exe",
    }

    # VoiceMeeter Remote DLL paths
    _VOICEMEETER_DLL_PATHS = [
        r"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterRemote64.dll",
        r"C:\Program Files\VB\Voicemeeter\VoicemeeterRemote64.dll",
        r"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterRemote.dll",
        r"C:\Program Files\VB\Voicemeeter\VoicemeeterRemote.dll",
    ]

    def _is_voicemeeter_running(self) -> bool:
        """Check if VoiceMeeter is actually running (not just installed)."""
        try:
            import subprocess
            result = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.lower().splitlines():
                for proc in self._VOICEMEETER_PROCESSES:
                    if proc in line:
                        return True
        except Exception:
            pass
        return False

    def _get_voicemeeter_dll(self):
        """Load VoiceMeeter Remote DLL and login. Returns DLL handle or None."""
        if self._vmr_dll is not None and self._vmr_logged_in:
            return self._vmr_dll
        import ctypes
        import os
        for path in self._VOICEMEETER_DLL_PATHS:
            if os.path.isfile(path):
                try:
                    dll = ctypes.CDLL(path)
                    # Login to VoiceMeeter
                    result = dll.VBVMR_Login()
                    if result == 0:
                        self._vmr_dll = dll
                        self._vmr_logged_in = True
                        logger.info("VoiceMeeter Remote API connected")
                        return dll
                    else:
                        logger.warning("VoiceMeeter VBVMR_Login failed: %d", result)
                except Exception as exc:
                    logger.warning("Failed to load VoiceMeeter DLL %s: %s", path, exc)
        return None

    def _vmr_get_param(self, dll, param_name: str) -> Optional[float]:
        """Get a float parameter from VoiceMeeter."""
        import ctypes
        try:
            value = ctypes.c_float(0.0)
            result = dll.VBVMR_GetParameterFloat(
                ctypes.c_wchar_p(param_name),
                ctypes.byref(value)
            )
            if result == 0:
                return value.value
        except Exception as exc:
            logger.warning("VMR get param '%s' failed: %s", param_name, exc)
        return None

    def _vmr_set_param(self, dll, param_name: str, value: float) -> bool:
        """Set a float parameter in VoiceMeeter."""
        import ctypes
        try:
            result = dll.VBVMR_SetParameterFloat(
                ctypes.c_wchar_p(param_name),
                ctypes.c_float(value)
            )
            return result == 0
        except Exception as exc:
            logger.warning("VMR set param '%s' failed: %s", param_name, exc)
            return False

    def _vmr_get_mute(self, dll, param_name: str) -> Optional[bool]:
        """Get mute state from VoiceMeeter (1=muted, 0=unmuted)."""
        val = self._vmr_get_param(dll, param_name)
        if val is not None:
            return val > 0.5
        return None

    def _vmr_set_mute(self, dll, param_name: str, muted: bool) -> bool:
        """Set mute state in VoiceMeeter."""
        return self._vmr_set_param(dll, param_name, 1.0 if muted else 0.0)

    def _get_windows_volume(self) -> tuple[Optional[float], Optional[bool]]:
        """Get Windows master volume (0.0-1.0) and mute state via pycaw."""
        try:
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
            from ctypes import cast, POINTER
            from comtypes import CLSCTX_ALL
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(
                IAudioEndpointVolume._iid_, CLSCTX_ALL, None
            )
            volume = cast(interface, POINTER(IAudioEndpointVolume))
            level = volume.GetMasterVolumeLevelScalar()
            muted = bool(volume.GetMute())
            return level, muted
        except ImportError:
            logger.warning("pycaw not installed — Windows volume control unavailable")
            return None, None
        except Exception as exc:
            logger.warning("Failed to get Windows volume: %s", exc)
            return None, None

    def _set_windows_volume(self, level: float) -> bool:
        """Set Windows master volume (0.0-1.0) via pycaw."""
        try:
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
            from ctypes import cast, POINTER
            from comtypes import CLSCTX_ALL
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(
                IAudioEndpointVolume._iid_, CLSCTX_ALL, None
            )
            volume = cast(interface, POINTER(IAudioEndpointVolume))
            volume.SetMasterVolumeLevelScalar(max(0.0, min(1.0, level)), None)
            return True
        except Exception as exc:
            logger.warning("Failed to set Windows volume: %s", exc)
            return False

    def _set_windows_mute(self, muted: bool) -> bool:
        """Set Windows master mute via pycaw."""
        try:
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
            from ctypes import cast, POINTER
            from comtypes import CLSCTX_ALL
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(
                IAudioEndpointVolume._iid_, CLSCTX_ALL, None
            )
            volume = cast(interface, POINTER(IAudioEndpointVolume))
            volume.SetMute(1 if muted else 0, None)
            return True
        except Exception as exc:
            logger.warning("Failed to set Windows mute: %s", exc)
            return False

    def _tool_volume_control(self, args: dict[str, Any]) -> str:
        """Control system volume — VoiceMeeter if running, else Windows via pycaw."""
        aktion = args.get("aktion", "").strip().lower()
        wert = args.get("wert")

        if not aktion:
            return "Keine Aktion angegeben. Verfügbare Aktionen: lauter, leiser, mute, unmute, setzen, restore."

        # Check if VoiceMeeter is running
        vm_running = self._is_voicemeeter_running()
        vmr_dll = None
        if vm_running:
            vmr_dll = self._get_voicemeeter_dll()
            if vmr_dll is None:
                logger.info("VoiceMeeter is running but Remote DLL not found — falling back to Windows volume")

        using_vmr = vmr_dll is not None
        # VoiceMeeter master output is Bus[0] — gain in dB (-60 to +12)
        VMR_BUS_GAIN = "Bus[0].Gain"
        VMR_BUS_MUTE = "Bus[0].Mute"

        # --- Read current state ---
        if using_vmr:
            current_gain = self._vmr_get_param(vmr_dll, VMR_BUS_GAIN)
            current_mute = self._vmr_get_mute(vmr_dll, VMR_BUS_MUTE)
            if current_gain is None:
                using_vmr = False
                vmr_dll = None
            else:
                # Convert dB to percentage: -60dB = 0%, 0dB = 100%, +12dB = 120%
                # We map -60..+12 to 0..100 for user-facing percentage
                current_pct = max(0, min(100, int((current_gain + 60) / 72 * 100)))
        else:
            current_level, current_mute = self._get_windows_volume()
            if current_level is None:
                return "Lautstärke-Steuerung nicht verfügbar. Weder VoiceMeeter Remote API noch pycaw sind funktional."
            current_pct = int(current_level * 100)

        # --- Handle actions ---
        if aktion == "restore":
            if self._saved_volume is None:
                return "Keine gespeicherte Lautstärke zum Wiederherstellen."
            if using_vmr:
                # Convert percentage back to dB
                target_db = (self._saved_volume / 100) * 72 - 60
                self._vmr_set_param(vmr_dll, VMR_BUS_GAIN, target_db)
                if self._saved_mute is not None:
                    self._vmr_set_mute(vmr_dll, VMR_BUS_MUTE, self._saved_mute)
            else:
                self._set_windows_volume(self._saved_volume / 100)
                if self._saved_mute is not None:
                    self._set_windows_mute(self._saved_mute)
            restored_pct = self._saved_volume
            self._saved_volume = None
            self._saved_mute = None
            return f"Lautstärke wiederhergestellt auf {restored_pct}%."

        # Save current state before changing (for restore)
        self._saved_volume = current_pct
        self._saved_mute = current_mute

        if aktion == "mute":
            if using_vmr:
                self._vmr_set_mute(vmr_dll, VMR_BUS_MUTE, True)
            else:
                self._set_windows_mute(True)
            return f"Stumm geschaltet. (Vorher: {current_pct}%)"

        elif aktion == "unmute":
            if using_vmr:
                self._vmr_set_mute(vmr_dll, VMR_BUS_MUTE, False)
            else:
                self._set_windows_mute(False)
            return f"Stumm aus. (Aktuell: {current_pct}%)"

        elif aktion == "lauter":
            new_pct = min(100, current_pct + 10)
            if using_vmr:
                target_db = (new_pct / 100) * 72 - 60
                self._vmr_set_param(vmr_dll, VMR_BUS_GAIN, target_db)
            else:
                self._set_windows_volume(new_pct / 100)
            return f"Lautstärke auf {new_pct}% erhöht. (Vorher: {current_pct}%)"

        elif aktion == "leiser":
            new_pct = max(0, current_pct - 10)
            if using_vmr:
                target_db = (new_pct / 100) * 72 - 60
                self._vmr_set_param(vmr_dll, VMR_BUS_GAIN, target_db)
            else:
                self._set_windows_volume(new_pct / 100)
            return f"Lautstärke auf {new_pct}% verringert. (Vorher: {current_pct}%)"

        elif aktion == "setzen":
            if wert is None:
                return "Für 'setzen' muss ein Wert (0-100) angegeben werden."
            try:
                target_pct = int(float(wert))
            except (ValueError, TypeError):
                return f"Ungültiger Wert '{wert}'. Bitte eine Zahl 0-100 angeben."
            target_pct = max(0, min(100, target_pct))
            if using_vmr:
                target_db = (target_pct / 100) * 72 - 60
                self._vmr_set_param(vmr_dll, VMR_BUS_GAIN, target_db)
            else:
                self._set_windows_volume(target_pct / 100)
            return f"Lautstärke auf {target_pct}% gesetzt. (Vorher: {current_pct}%)"

        else:
            return f"Unbekannte Aktion '{aktion}'. Verfügbare Aktionen: lauter, leiser, mute, unmute, setzen, restore."

    def _tool_search_web(self, args: dict[str, Any]) -> str:
        """Search the web via DuckDuckGo HTML scraping — no API key needed."""
        query = args.get("query", "").strip()
        if not query:
            return "Kein Suchbegriff angegeben."

        count = args.get("count", 5)
        try:
            count = int(count)
        except (ValueError, TypeError):
            count = 5
        count = max(1, min(10, count))

        try:
            import requests
            from html.parser import HTMLParser
            import re
            import urllib.parse

            # DuckDuckGo HTML endpoint — no API key needed
            url = "https://html.duckduckgo.com/html/"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "de,en;q=0.9",
            }
            data = {"q": query}

            resp = requests.post(url, headers=headers, data=data, timeout=10)
            resp.raise_for_status()
            html = resp.text

            # Parse results from DuckDuckGo HTML
            results = []

            # DDG HTML results have result blocks with class="result__body"
            # Each has: result__a (title link), result__snippet (text), result__url (display URL)
            # We use regex parsing since it's more resilient than HTMLParser for this

            # Extract result blocks
            result_blocks = re.findall(
                r'<a[^>]+class="result__a"[^>]*>(.*?)</a>.*?'
                r'<a[^>]+class="result__url"[^>]*>(.*?)</a>.*?'
                r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
                html,
                re.DOTALL
            )

            if not result_blocks:
                # Fallback: try alternative DDG HTML structure
                result_blocks = re.findall(
                    r'<a[^>]+rel="nofollow"[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
                    r'class="result__snippet"[^>]*>(.*?)</a>',
                    html,
                    re.DOTALL
                )
                # Reformat to match expected structure
                result_blocks = [(title, url, snippet) for url, title, snippet in result_blocks]

            for title_html, url_html, snippet_html in result_blocks[:count]:
                # Strip HTML tags from title and snippet
                title = re.sub(r'<[^>]+>', '', title_html).strip()
                url_text = re.sub(r'<[^>]+>', '', url_html).strip()
                snippet = re.sub(r'<[^>]+>', '', snippet_html).strip()

                # Decode HTML entities
                title = title.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#x27;", "'")
                snippet = snippet.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#x27;", "'")
                url_text = url_text.replace("&amp;", "&")

                if title and snippet:
                    results.append(f"Titel: {title}\nURL: {url_text}\nAusschnitt: {snippet}")

            if not results:
                # Last resort: try DuckDuckGo Instant Answer API (still no key needed)
                try:
                    ia_url = f"https://api.duckduckgo.com/?q={urllib.parse.quote(query)}&format=json&no_html=1&skip_disambig=1"
                    ia_resp = requests.get(ia_url, headers=headers, timeout=10)
                    ia_data = ia_resp.json()

                    if ia_data.get("AbstractText"):
                        abstract = ia_data["AbstractText"]
                        source = ia_data.get("AbstractURL", "")
                        results.append(f"Titel: {ia_data.get('Heading', query)}\nURL: {source}\nAusschnitt: {abstract}")

                    for topic in (ia_data.get("RelatedTopics") or [])[:count - len(results)]:
                        if isinstance(topic, dict) and topic.get("Text"):
                            text = topic["Text"]
                            first_url = topic.get("FirstURL", "")
                            results.append(f"URL: {first_url}\nAusschnitt: {text}")
                except Exception as exc:
                    logger.warning("DuckDuckGo Instant Answer API failed: %s", exc)

            if not results:
                return f"Keine Suchergebnisse gefunden für '{query}'."

            return f"Web-Suche nach '{query}' ({len(results)} Ergebnisse):\n\n" + "\n---\n".join(results)

        except requests.exceptions.Timeout:
            return f"Web-Suche hat das Zeitlimit überschritten. Bitte später erneut versuchen."
        except requests.exceptions.ConnectionError:
            return f"Keine Internetverbindung für Web-Suche verfügbar."
        except Exception as exc:
            logger.error("search_web error: %s", exc, exc_info=True)
            return f"Web-Suche fehlgeschlagen: {exc}"

    # Known website aliases → full URL
    _WEBSITE_ALIASES = {
        "google": "https://www.google.com",
        "youtube": "https://www.youtube.com",
        "github": "https://github.com",
        "gitlab": "https://gitlab.com",
        "stackoverflow": "https://stackoverflow.com",
        "reddit": "https://www.reddit.com",
        "twitter": "https://twitter.com",
        "x": "https://x.com",
        "facebook": "https://www.facebook.com",
        "instagram": "https://www.instagram.com",
        "linkedin": "https://www.linkedin.com",
        "wikipedia": "https://www.wikipedia.org",
        "amazon": "https://www.amazon.com",
        "netflix": "https://www.netflix.com",
        "spotify": "https://open.spotify.com",
        "twitch": "https://www.twitch.tv",
        "discord": "https://discord.com",
        "gmail": "https://mail.google.com",
        "outlook": "https://outlook.live.com",
        "dropbox": "https://www.dropbox.com",
        "drive": "https://drive.google.com",
        "google drive": "https://drive.google.com",
        "maps": "https://maps.google.com",
        "google maps": "https://maps.google.com",
        "translate": "https://translate.google.com",
        "google translate": "https://translate.google.com",
        "chatgpt": "https://chat.openai.com",
        "openai": "https://chat.openai.com",
        "huggingface": "https://huggingface.co",
        "pinterest": "https://www.pinterest.com",
        "ebay": "https://www.ebay.com",
        "wikipedia de": "https://de.wikipedia.org",
        "wikipedia en": "https://en.wikipedia.org",
    }

    def _tool_open_website(self, args: dict[str, Any]) -> str:
        """Open a website in the default browser or start a Google search."""
        import webbrowser
        import urllib.parse
        import re

        param = args.get("url_oder_suche", "").strip()
        if not param:
            return "Keine URL oder Suchbegriff angegeben."

        param_lower = param.lower().strip()

        # Check if it's a URL (has a domain pattern)
        # Matches: youtube.com, https://github.com, sub.domain.org, etc.
        url_pattern = re.compile(
            r'^(https?://)?[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+(/[\w\-./?=&%#]*)?$',
            re.IGNORECASE
        )

        # Check website aliases first
        if param_lower in self._WEBSITE_ALIASES:
            url = self._WEBSITE_ALIASES[param_lower]
            try:
                webbrowser.open(url)
                return f"Website geöffnet: {url}"
            except Exception as exc:
                return f"Konnte Website nicht öffnen: {exc}"

        # If it looks like a URL, open it directly
        if url_pattern.match(param):
            url = param if param.startswith(("http://", "https://")) else f"https://{param}"
            try:
                webbrowser.open(url)
                return f"Website geöffnet: {url}"
            except Exception as exc:
                return f"Konnte Website nicht öffnen: {exc}"

        # Otherwise treat it as a Google search
        search_url = f"https://www.google.com/search?q={urllib.parse.quote(param)}"
        try:
            webbrowser.open(search_url)
            return f"Google-Suche geöffnet für: {param}"
        except Exception as exc:
            return f"Konnte Google-Suche nicht öffnen: {exc}"

    def _tool_window_focus(self, args: dict[str, Any]) -> str:
        """Switch to, minimize, maximize, restore, or close a window."""
        aktion = args.get("aktion", "").strip().lower()
        name = args.get("name", "").strip()

        if not aktion:
            return "Keine Aktion angegeben. Verfügbare Aktionen: fokus, minimieren, maximieren, wiederherstellen, schliessen."
        if not name:
            return "Kein Fenster-Name angegeben."

        # Try pygetwindow first, fall back to win32gui
        try:
            import pygetwindow as gw
        except ImportError:
            logger.warning("pygetwindow not installed — trying win32gui fallback")
            return self._window_fallback_win32(aktion, name)

        name_lower = name.lower()

        # Find matching windows by title (case-insensitive partial match)
        try:
            all_windows = gw.getAllWindows()
        except Exception as exc:
            logger.error("fenster_fokus getAllWindows failed: %s", exc)
            return f"Konnte Fensterliste nicht abrufen: {exc}"

        # Filter: must have a non-empty title and match the name
        matching = [
            w for w in all_windows
            if w.title and name_lower in w.title.lower()
        ]

        if not matching:
            # Try matching by process name (e.g. 'chrome' matches 'Google Chrome')
            # Build a broader search with common app name mappings
            app_name_map = {
                "chrome": ["chrome", "google chrome"],
                "firefox": ["firefox"],
                "edge": ["edge", "microsoft edge"],
                "spotify": ["spotify"],
                "discord": ["discord"],
                "vscode": ["visual studio code", "code"],
                "code": ["visual studio code", "code"],
                "notepad": ["notepad", "editor"],
                "word": ["word", "microsoft word"],
                "excel": ["excel", "microsoft excel"],
                "explorer": ["explorer", "file explorer"],
                "terminal": ["terminal", "command prompt", "powershell"],
                "cmd": ["command prompt", "cmd"],
                "powershell": ["powershell"],
                "steam": ["steam"],
                "teams": ["teams", "microsoft teams"],
                "outlook": ["outlook", "microsoft outlook"],
                "slack": ["slack"],
                "zoom": ["zoom"],
                "obs": ["obs", "open broadcaster"],
            }
            search_terms = app_name_map.get(name_lower, [name_lower])
            matching = [
                w for w in all_windows
                if w.title and any(term in w.title.lower() for term in search_terms)
            ]

        if not matching:
            return f"Kein Fenster gefunden für '{name}'."

        # Use the first matching window (most recently active is usually first)
        win = matching[0]

        try:
            if aktion == "fokus":
                if win.isMinimized:
                    win.restore()
                win.activate()
                win.minimize()  # Workaround for Windows focus steal protection
                win.restore()
                return f"Fokus auf '{win.title}' gesetzt."

            elif aktion == "minimieren":
                win.minimize()
                return f"'{win.title}' minimiert."

            elif aktion == "maximieren":
                if win.isMinimized:
                    win.restore()
                win.maximize()
                return f"'{win.title}' maximiert."

            elif aktion == "wiederherstellen":
                win.restore()
                return f"'{win.title}' wiederhergestellt."

            elif aktion == "schliessen":
                win.close()
                return f"'{win.title}' geschlossen."

            else:
                return f"Unbekannte Aktion '{aktion}'. Verfügbare Aktionen: fokus, minimieren, maximieren, wiederherstellen, schliessen."

        except Exception as exc:
            logger.error("fenster_fokus action '%s' failed for '%s': %s", aktion, win.title, exc)
            return f"Konnte Aktion '{aktion}' nicht ausführen auf '{win.title}': {exc}"

    def _window_fallback_win32(self, aktion: str, name: str) -> str:
        """Fallback window management using win32gui (no pygetwindow needed)."""
        try:
            import win32gui
            import win32con
        except ImportError:
            return "Fenster-Steuerung nicht verfügbar. Weder pygetwindow noch win32gui sind installiert."

        name_lower = name.lower()
        matching_hwnds = []

        def enum_handler(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title and name_lower in title.lower():
                    matching_hwnds.append((hwnd, title))

        win32gui.EnumWindows(enum_handler, None)

        if not matching_hwnds:
            return f"Kein Fenster gefunden für '{name}'."

        hwnd, title = matching_hwnds[0]

        try:
            if aktion == "fokus":
                if win32gui.IsIconic(hwnd):
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
                return f"Fokus auf '{title}' gesetzt."

            elif aktion == "minimieren":
                win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
                return f"'{title}' minimiert."

            elif aktion == "maximieren":
                if win32gui.IsIconic(hwnd):
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
                return f"'{title}' maximiert."

            elif aktion == "wiederherstellen":
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                return f"'{title}' wiederhergestellt."

            elif aktion == "schliessen":
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                return f"'{title}' geschlossen."

            else:
                return f"Unbekannte Aktion '{aktion}'. Verfügbare Aktionen: fokus, minimieren, maximieren, wiederherstellen, schliessen."

        except Exception as exc:
            logger.error("fenster_fokus win32 fallback '%s' failed for '%s': %s", aktion, title, exc)
            return f"Konnte Aktion '{aktion}' nicht ausführen auf '{title}': {exc}"

    # Active timers: {timer_id: {thread, fire_time, message, cancelled}}
    _active_timers: dict[int, dict[str, Any]] = {}
    _timer_counter = 0

    def _tool_timer(self, args: dict[str, Any]) -> str:
        """Set a countdown timer, alarm, list active timers, or cancel one."""
        import threading
        import time
        import datetime

        aktion = args.get("aktion", "").strip().lower()
        if not aktion:
            return "Keine Aktion angegeben. Verfügbare Aktionen: timer, wecker, liste, abbrechen."

        if aktion == "liste":
            if not self._active_timers:
                return "Keine aktiven Timer."
            lines = []
            now = datetime.datetime.now()
            for tid, info in self._active_timers.items():
                remaining = info["fire_time"] - now
                secs = max(0, int(remaining.total_seconds()))
                mins, s = divmod(secs, 60)
                hours, mins = divmod(mins, 60)
                status = "ABGEBROCHEN" if info.get("cancelled") else f"{hours:02d}:{mins:02d}:{s:02d}"
                msg = info.get("message", "")
                lines.append(f"Timer #{tid}: {status} — {msg}" if msg else f"Timer #{tid}: {status}")
            return "Aktive Timer:\n" + "\n".join(lines)

        if aktion == "abbrechen":
            if not self._active_timers:
                return "Keine aktiven Timer zum Abbrechen."
            count = 0
            for tid, info in self._active_timers.items():
                info["cancelled"] = True
                count += 1
            self._active_timers.clear()
            return f"{count} Timer abgebrochen."

        if aktion == "timer":
            minuten = args.get("minuten", 0)
            sekunden = args.get("sekunden", 0)
            try:
                minuten = float(minuten)
            except (ValueError, TypeError):
                minuten = 0
            try:
                sekunden = float(sekunden)
            except (ValueError, TypeError):
                sekunden = 0

            total_secs = int(minuten * 60 + sekunden)
            if total_secs <= 0:
                return "Bitte eine gültige Dauer angeben (z.B. minuten=10)."

            nachricht = args.get("nachricht", "").strip()
            if not nachricht:
                nachricht = f"Timer abgelaufen — {int(minuten)} Minuten sind vorbei."

            fire_time = datetime.datetime.now() + datetime.timedelta(seconds=total_secs)
            self._timer_counter += 1
            timer_id = self._timer_counter

            self._active_timers[timer_id] = {
                "fire_time": fire_time,
                "message": nachricht,
                "cancelled": False,
            }

            # Start background thread
            def _timer_thread():
                remaining = total_secs
                while remaining > 0:
                    time.sleep(1)
                    info = self._active_timers.get(timer_id)
                    if not info or info.get("cancelled"):
                        return
                    remaining -= 1
                info = self._active_timers.get(timer_id)
                if info and not info.get("cancelled"):
                    self._fire_timer_alert(timer_id, nachricht)

            t = threading.Thread(target=_timer_thread, daemon=True)
            self._active_timers[timer_id]["thread"] = t
            t.start()

            # Human-readable duration
            mins, secs = divmod(total_secs, 60)
            hours, mins = divmod(mins, 60)
            if hours > 0:
                duration = f"{hours}h {mins}m"
            elif mins > 0:
                duration = f"{mins}m {secs}s" if secs > 0 else f"{mins}m"
            else:
                duration = f"{secs}s"

            fire_str = fire_time.strftime("%H:%M")
            return f"Timer gestellt: {duration} (um {fire_str} Uhr). Nachricht: {nachricht}"

        if aktion == "wecker":
            uhrzeit = args.get("uhrzeit", "").strip()
            if not uhrzeit:
                return "Für 'wecker' muss eine Uhrzeit im Format HH:MM angegeben werden (z.B. '07:00')."

            # Parse HH:MM
            try:
                parts = uhrzeit.split(":")
                if len(parts) != 2:
                    return f"Ungültiges Uhrzeit-Format '{uhrzeit}'. Bitte HH:MM verwenden (z.B. '07:30')."
                hour, minute = int(parts[0]), int(parts[1])
                if not (0 <= hour <= 23 and 0 <= minute <= 59):
                    return f"Ungültige Uhrzeit '{uhrzeit}'. Stunde 0-23, Minute 0-59."
            except ValueError:
                return f"Ungültige Uhrzeit '{uhrzeit}'. Bitte HH:MM verwenden (z.B. '07:30')."

            nachricht = args.get("nachricht", "").strip()
            if not nachricht:
                nachricht = f"Wecker! Es ist {hour:02d}:{minute:02d} Uhr."

            now = datetime.datetime.now()
            fire_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            # If time is in the past, schedule for tomorrow
            if fire_time <= now:
                fire_time += datetime.timedelta(days=1)

            total_secs = int((fire_time - now).total_seconds())
            self._timer_counter += 1
            timer_id = self._timer_counter

            self._active_timers[timer_id] = {
                "fire_time": fire_time,
                "message": nachricht,
                "cancelled": False,
            }

            def _alarm_thread():
                remaining = total_secs
                while remaining > 0:
                    time.sleep(1)
                    info = self._active_timers.get(timer_id)
                    if not info or info.get("cancelled"):
                        return
                    remaining -= 1
                info = self._active_timers.get(timer_id)
                if info and not info.get("cancelled"):
                    self._fire_timer_alert(timer_id, nachricht)

            t = threading.Thread(target=_alarm_thread, daemon=True)
            self._active_timers[timer_id]["thread"] = t
            t.start()

            day_str = "heute" if fire_time.date() == now.date() else "morgen"
            return f"Wecker gestellt für {day_str} {hour:02d}:{minute:02d} Uhr. Nachricht: {nachricht}"

        return f"Unbekannte Aktion '{aktion}'. Verfügbare Aktionen: timer, wecker, liste, abbrechen."

    def _fire_timer_alert(self, timer_id: int, message: str) -> None:
        """Fire timer alert: Windows toast notification + broadcast to UI + TTS."""
        import datetime

        # Remove from active timers
        self._active_timers.pop(timer_id, None)

        logger.info("Timer #%d fired: %s", timer_id, message)

        # 1. Windows toast notification via PowerShell
        try:
            import subprocess
            ps_script = (
                f"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
                f"$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                f"$textNodes = $template.GetElementsByTagName('text');"
                f"$textNodes.Item(0).AppendChild($template.CreateTextNode('Nox Timer')) | Out-Null;"
                f"$textNodes.Item(1).AppendChild($template.CreateTextNode('{message.replace(chr(39), chr(96))}')) | Out-Null;"
                f"$toast = [Windows.UI.Notifications.ToastNotification]::new($template);"
                f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Nox').Show($toast);"
            )
            subprocess.Popen(["powershell", "-NoProfile", "-Command", ps_script], shell=True)
        except Exception as exc:
            logger.warning("Toast notification failed: %s", exc)

        # 2. Broadcast timer_alert event to UI
        if self._broadcast:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._broadcast({"type": "timer_alert", "message": message, "timer_id": timer_id}),
                        loop
                    )
            except Exception:
                pass

        # 3. Trigger TTS via API call
        try:
            import requests
            requests.post("http://127.0.0.1:8420/api/tts/speak", json={"text": message}, timeout=5)
        except Exception as exc:
            logger.warning("Timer TTS trigger failed: %s", exc)
