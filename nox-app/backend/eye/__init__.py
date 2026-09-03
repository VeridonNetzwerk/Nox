"""Nox Eye – Screen context capture for Nox.

Provides:
1. On-demand screen reading via UI Automation + OCR fallback (bildschirm_ansehen tool)
2. Window-change-based screenshot history (all monitors, 1h ring buffer)
3. Clipboard monitoring (text changes stored in ContextStore)
4. Context search over stored history (FTS5 + semantic)

Screen content is captured when the active window changes, or on-demand
when the AI calls the 'bildschirm_ansehen' tool. Clipboard text is captured
continuously (lightweight, text-only).
"""

from .eye_manager import EyeManager

__all__ = ["EyeManager"]
