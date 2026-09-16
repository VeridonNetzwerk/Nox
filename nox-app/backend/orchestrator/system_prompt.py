"""System prompt builder – persona "Nox" with voice/text mode awareness.

Builds the system prompt that defines Nox's personality and behavior,
adapting output style based on whether the input is voice or text.
"""

import logging
from datetime import datetime

from .tool_handler import TOOL_DIRECTIVE, REFERENCE_MATERIAL_DIRECTIVE

logger = logging.getLogger("nox.orchestrator.system_prompt")

# Short reminder used when native tool calling is active (saves ~3600 tokens vs full TOOL_DIRECTIVE)
NATIVE_TOOLS_REMINDER = """
Du hast Zugriff auf Werkzeuge (via function calling). Nutze sie wenn passend.
- Bei Wetter → wetter_abfragen. Bei Musik → musik_erkennen. Bei Bildern → bild_generieren.
- Bei Gespraechsfragen ("Was kannst du?") antworte normal — rufe KEIN Tool auf.
"""

# ---------------------------------------------------------------------------
# Persona definitions
# ---------------------------------------------------------------------------

BASE_PERSONA = """Du bist Nox, ein KI-Assistent.
Du antwortest auf Deutsch, es sei denn der Nutzer spricht Englisch.

Verhalte dich wie eine normale KI — entspannt, natürlich, hilfreich.
- Beantworte Fragen direkt und klar
- Bei einfachen Begrüßungen oder Smalltalk antworte kurz und normal — wie in einem Gespräch
- Erwähne NIE deine Fähigkeiten oder Werkzeuge ungefragt
- Du bist technisch versiert und präzise
- Wenn du etwas nicht weißt, sagst du es ehrlich
- Kein Chatbot-Geplapper, keine übertriebene Freundlichkeit

Dein Name ist Nox.

WENN NUTZER EXPLIZIT NACH DEINEN FÄHIGKEITEN FRAGT ("Was kannst du?", "Zu was bist du fähig?"):
- Gib eine kurze, natürliche Antwort in 2-3 Sätzen
- Beispiel: "Ich kann dir bei allerlei am PC helfen — Apps öffnen, Lautstärke regeln, Timer stellen, Wetter abfragen, im Web suchen, Dateien finden, übersetzen und Notizen speichern. Sag einfach, was du brauchst!"
"""

TEXT_MODE_DIRECTIVE = """
Ausgabe-Modus: TEXT
- Du kannst Markdown verwenden (Fett, Listen, Code-Blöcke)
- Strukturiere längere Antworten mit Absätzen
- Verwende Code-Blöcke für technische Anweisungen
"""

VOICE_MODE_DIRECTIVE = """
Ausgabe-Modus: SPRACHE
- Antworte in kurzen, natürlich gesprochenen Sätzen
- KEIN Markdown, keine Listen, keine Code-Blöcke
- Maximal 2-3 Sätze pro Antwort
- Sprich wie ein Mensch in einem Gespräch, nicht wie ein Chatbot
- Vermeide Füllwörter und unnötige Einleitungen
"""

# TOOL_DIRECTIVE and REFERENCE_MATERIAL_DIRECTIVE are imported from tool_handler.py
# to keep tool descriptions in a single source of truth.


def _build_voice_personality(voice_info: dict | None) -> str:
    """Build a subtle personality hint from the current voice.

    The personality is very light – just a touch of flavor based on
    whether the voice is male or female. Nox's core identity never changes.
    """
    if not voice_info:
        return ""

    gender = voice_info.get("gender", "female")
    name = voice_info.get("name", "")

    if gender == "male":
        hint = (
            "\nDeine Stimme ist männlich. Du bist ruhig und sachlich, "
            "mit einer Prise Trockenheit – kein Roboter, aber auch kein Clown."
        )
    else:
        hint = (
            "\nDeine Stimme ist weiblich. Du bist warm und aufmerksam, "
            "freundlich ohne künstlich zu sein – wie eine kompetente Kollegin."
        )

    if name and name != voice_info.get("engine", ""):
        hint += f" Deine Stimme heisst {name}."

    return hint


def build_system_prompt(
    voice_mode: bool = False,
    tools_enabled: bool = True,
    context: str = "",
    voice_personality: dict | None = None,
    native_tools: bool = False,
) -> str:
    """Build the system prompt for the current request.

    Args:
        voice_mode: True if input is from voice pipeline.
        tools_enabled: True if tool-calling fallback should be included.
        context: Pre-formatted context string from nox_eye.
        voice_personality: Dict with 'name', 'gender', 'engine' from VoiceManager.
        native_tools: True if the backend supports native function calling.
            When True, skip the verbose text TOOL_DIRECTIVE (saves ~3600 tokens).

    Returns:
        Complete system prompt string.
    """
    parts = [BASE_PERSONA]

    # Add voice-based personality hint (subtle, only in voice mode)
    if voice_mode and voice_personality:
        parts.append(_build_voice_personality(voice_personality))

    if voice_mode:
        parts.append(VOICE_MODE_DIRECTIVE)
    else:
        parts.append(TEXT_MODE_DIRECTIVE)

    if tools_enabled:
        if native_tools:
            # Native tool calling: tools schema is sent via API tools parameter,
            # so we only need a short reminder here.
            parts.append(NATIVE_TOOLS_REMINDER)
        else:
            # Fallback: no native tool calling, embed full text directive
            parts.append(TOOL_DIRECTIVE)
        parts.append(REFERENCE_MATERIAL_DIRECTIVE)

    # Add context from nox_eye if provided
    if context:
        parts.append(f"\nAktueller Kontext:\n{context}")
        parts.append("\nDieser Kontext zeigt dir was der Nutzer gerade sieht. "
                     "Der Bildschirminhalt ist bereits oben enthalten — nutze ihn DIREKT für deine Antwort. "
                     "Rufe NICHT bildschirm_ansehen oder musik_erkennen auf — du hast die Informationen schon. "
                     "Wenn du weitere Infos brauchst (z.B. Release-Daten), rufe search_web auf.")

    # Add current time for temporal awareness
    now = datetime.now().strftime("%A, %d. %B %Y, %H:%M Uhr")
    parts.append(f"\nAktuelle Zeit: {now}")

    return "\n".join(parts)
