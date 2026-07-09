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


class ToolHandler:
    """Manages tool registration, execution, and fallback parsing."""

    def __init__(self, eye_manager=None, files_manager=None):
        self._tools: dict[str, Tool] = {}
        self._eye_manager = eye_manager
        self._files_manager = files_manager
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

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool
        logger.debug("Tool registered: %s", tool.name)

    def get_ollama_tools(self) -> list[dict[str, Any]]:
        """Get all tools in Ollama API format."""
        return [t.to_ollama_schema() for t in self._tools.values()]

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
