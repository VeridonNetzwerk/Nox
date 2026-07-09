"""UI Automation text extraction via uiautomation package.

Extracts text content from the active window's UI tree using the
Windows UI Automation API. Skips password fields (is_password flag).
"""

import logging
from typing import Optional

logger = logging.getLogger("nox.eye.uia")

# Conditional import
try:
    import uiautomation as ua
    _UIA_AVAILABLE = True
except ImportError:
    _UIA_AVAILABLE = False


class UIAReader:
    """Extracts text from the active window via UI Automation."""

    MAX_DEPTH = 8
    MAX_ELEMENTS = 500
    MAX_TEXT_LENGTH = 5000

    def __init__(self):
        self._cached_window = None

    @property
    def is_available(self) -> bool:
        return _UIA_AVAILABLE

    def extract_text(self, hwnd: int) -> Optional[str]:
        """Extract all visible text from the window with the given hwnd.

        Args:
            hwnd: Window handle of the target window.

        Returns:
            Concatenated text from UI elements, or None if extraction fails.
        """
        if not _UIA_AVAILABLE:
            return None

        try:
            el = ua.ControlFromHandle(hwnd)
            if el is None:
                return None

            texts: list[str] = []
            self._walk(el, texts, depth=0)

            if not texts:
                return None

            result = "\n".join(texts)
            if len(result) > self.MAX_TEXT_LENGTH:
                result = result[:self.MAX_TEXT_LENGTH] + "..."
            return result

        except Exception as exc:
            logger.debug("UIA extraction failed for hwnd=%s: %s", hwnd, exc)
            return None

    def _walk(self, element, texts: list[str], depth: int) -> None:
        """Recursively walk the UI tree collecting text."""
        if depth > self.MAX_DEPTH or len(texts) > self.MAX_ELEMENTS:
            return

        try:
            # Skip password fields
            if hasattr(element, "IsPassword") and element.IsPassword:
                return

            # Collect text from this element
            name = ""
            try:
                name = element.Name or ""
            except Exception:
                pass

            value = ""
            try:
                value = element.GetValuePattern() if hasattr(element, "GetValuePattern") else None
                if value:
                    value = value.Value or ""
            except Exception:
                pass

            text_parts = []
            if name and len(name) > 1:
                text_parts.append(name)
            if value and len(value) > 1:
                text_parts.append(value)

            if text_parts:
                texts.append(" ".join(text_parts))

            # Recurse into children
            try:
                children = element.GetChildren()
                if children:
                    for child in children:
                        if len(texts) > self.MAX_ELEMENTS:
                            break
                        self._walk(child, texts, depth + 1)
            except Exception:
                pass

        except Exception:
            pass
