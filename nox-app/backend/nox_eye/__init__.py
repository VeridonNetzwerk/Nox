"""Nox Eye – Context Capture Module

Provides awareness of the user's current screen context via:
1. Active window + process tracking (event-driven, not polling)
2. UI Automation text extraction (pywinauto/uiautomation)
3. EasyOCR GPU fallback for apps where UIA fails
4. Clipboard text monitoring

All components degrade gracefully if dependencies are missing.
"""

from .eye_manager import EyeManager

__all__ = ["EyeManager"]
