"""Nox Eye – On-demand screen context capture.

Provides:
1. On-demand screen reading via UI Automation + OCR fallback
2. Periodic screenshot history (all monitors, configurable interval)
3. Context search over stored history (FTS5 + semantic)

Nox Eye does NOT run continuous window/clipboard monitoring.
Screen content is only captured when the AI explicitly calls
the 'bildschirm_lesen' tool, or via the periodic screenshot history.
"""

from .eye_manager import EyeManager

__all__ = ["EyeManager"]
