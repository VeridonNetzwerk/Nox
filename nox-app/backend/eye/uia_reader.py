"""UI Automation text extraction — cross-platform.

Windows: Uses uiautomation package to extract text from the UI tree.
Linux:   Uses AT-SPI2 (pyatspi) to extract text from the accessibility tree.

Skips password fields on both platforms.
"""

import logging
from typing import Optional

from platform_utils import IS_WINDOWS, IS_LINUX
import atspi_compat

logger = logging.getLogger("nox.eye.uia")

# Conditional import — Windows
try:
    import uiautomation as ua
    _UIA_AVAILABLE = True
except ImportError:
    _UIA_AVAILABLE = False

# Linux AT-SPI2 availability via compat layer
_ATSPI_AVAILABLE = atspi_compat.is_available()


class UIAReader:
    """Extracts text from the active window via UI Automation (Windows) or AT-SPI2 (Linux)."""

    MAX_DEPTH = 8
    MAX_ELEMENTS = 500
    MAX_TEXT_LENGTH = 5000

    def __init__(self):
        self._cached_window = None

    @property
    def is_available(self) -> bool:
        if IS_WINDOWS:
            return _UIA_AVAILABLE
        elif IS_LINUX:
            return _ATSPI_AVAILABLE
        return False

    def extract_text(self, hwnd: int) -> Optional[str]:
        """Extract all visible text from the window with the given hwnd.

        Args:
            hwnd: Window handle/ID of the target window.

        Returns:
            Concatenated text from UI elements, or None if extraction fails.
        """
        if IS_WINDOWS and _UIA_AVAILABLE:
            return self._extract_text_win32(hwnd)
        elif IS_LINUX and _ATSPI_AVAILABLE:
            return self._extract_text_atspi(hwnd)
        return None

    # -----------------------------------------------------------------------
    # Windows backend
    # -----------------------------------------------------------------------

    # Common UI element names that are not useful content
    _UI_NOISE = {
        "minimize", "maximize", "restore", "close", "menu", "menu bar",
        "app bar", "infobar container", "side pane", "tab bar", "new tab",
        "scroll bar", "scrollbar", "status bar", "title bar",
        "non client input sink window", "untitled", "system",
        "back", "forward", "refresh", "stop", "home",
        "settings", "options", "more", "expand", "collapse",
        "search", "search box", "search field",
        "play", "pause", "next", "previous", "volume",
        "loading", "spinner", "progress",
        "tooltip", "popup", "dialog", "notification",
        "ok", "cancel", "apply", "save", "delete",
        "yes", "no", "retry",
    }

    def _is_ui_noise(self, text: str) -> bool:
        """Check if a text element is common UI noise."""
        text_lower = text.strip().lower()
        if not text_lower or len(text_lower) < 2:
            return True
        if text_lower in self._UI_NOISE:
            return True
        # Filter out very short single words that are likely UI labels
        if len(text_lower) <= 3 and text_lower not in ("yes", "no", "ok"):
            return True
        return False

    def _extract_text_win32(self, hwnd: int) -> Optional[str]:
        try:
            el = ua.ControlFromHandle(hwnd)
            if el is None:
                return None

            texts: list[str] = []
            self._walk_win32(el, texts, depth=0)

            if not texts:
                return None

            # Filter out UI noise
            filtered = [t for t in texts if not self._is_ui_noise(t)]
            if not filtered:
                # If everything was filtered, keep original
                filtered = texts

            result = "\n".join(filtered)
            if len(result) > self.MAX_TEXT_LENGTH:
                result = result[:self.MAX_TEXT_LENGTH] + "..."
            return result

        except Exception as exc:
            logger.debug("UIA extraction failed for hwnd=%s: %s", hwnd, exc)
            return None

    def _walk_win32(self, element, texts: list[str], depth: int) -> None:
        """Recursively walk the Windows UI tree collecting text."""
        if depth > self.MAX_DEPTH or len(texts) > self.MAX_ELEMENTS:
            return

        try:
            if hasattr(element, "IsPassword") and element.IsPassword:
                return

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

            try:
                children = element.GetChildren()
                if children:
                    for child in children:
                        if len(texts) > self.MAX_ELEMENTS:
                            break
                        self._walk_win32(child, texts, depth + 1)
            except Exception:
                pass

        except Exception:
            pass

    # -----------------------------------------------------------------------
    # Linux backend (AT-SPI2)
    # -----------------------------------------------------------------------

    def _extract_text_atspi(self, hwnd: int) -> Optional[str]:
        """Extract text from the active window via AT-SPI2 accessibility tree.

        On Linux, hwnd is not a real Win32 handle — it's a hash or window ID.
        We traverse the AT-SPI desktop tree to find the active window and
        extract text from it.
        """
        try:
            desktop = atspi_compat.get_desktop(0)
            if desktop is None:
                return None
            texts: list[str] = []

            for i in range(atspi_compat.get_child_count(desktop)):
                app = atspi_compat.get_child_at_index(desktop, i)
                if app is None:
                    continue
                try:
                    state_set = atspi_compat.get_state_set(app)
                    if not atspi_compat.state_contains(state_set, atspi_compat.STATE_ACTIVE):
                        continue

                    # Walk children of the active app
                    for j in range(atspi_compat.get_child_count(app)):
                        child = atspi_compat.get_child_at_index(app, j)
                        if child is None:
                            continue
                        try:
                            child_state = atspi_compat.get_state_set(child)
                            if atspi_compat.state_contains(child_state, atspi_compat.STATE_ACTIVE):
                                self._walk_atspi(child, texts, depth=0)
                                break
                        except Exception:
                            continue
                    break
                except Exception:
                    continue

            if not texts:
                return None

            result = "\n".join(texts)
            if len(result) > self.MAX_TEXT_LENGTH:
                result = result[:self.MAX_TEXT_LENGTH] + "..."
            return result

        except Exception as exc:
            logger.debug("AT-SPI text extraction failed: %s", exc)
            return None

    def _walk_atspi(self, element, texts: list[str], depth: int) -> None:
        """Recursively walk the AT-SPI accessibility tree collecting text."""
        if depth > self.MAX_DEPTH or len(texts) > self.MAX_ELEMENTS:
            return

        try:
            # Skip password fields
            try:
                role = atspi_compat.get_role(element)
                if role == atspi_compat.ROLE_PASSWORD_TEXT:
                    return
            except Exception:
                pass

            # Collect text from this element
            name = atspi_compat.get_name(element)

            # Try to get text content via Text interface
            text_iface = atspi_compat.query_text(element)
            value = atspi_compat.get_text_content(text_iface)

            text_parts = []
            if name and len(name) > 1:
                text_parts.append(name)
            if value and len(value) > 1:
                text_parts.append(value)

            if text_parts:
                texts.append(" ".join(text_parts))

            # Recurse into children
            try:
                children = atspi_compat.get_child_count(element)
                for i in range(children):
                    if len(texts) > self.MAX_ELEMENTS:
                        break
                    child = atspi_compat.get_child_at_index(element, i)
                    if child is not None:
                        self._walk_atspi(child, texts, depth + 1)
            except Exception:
                pass

        except Exception:
            pass
