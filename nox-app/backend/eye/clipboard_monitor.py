"""Clipboard monitor – tracks text changes in the system clipboard.

Windows: Uses win32clipboard API.
Linux:   Uses pyperclip (which uses xclip/xsel/wl-copy under the hood),
         with direct wl-paste fallback for COSMIC/Wayland.

Runs in a daemon thread, polling the clipboard at a short interval.
Only text content is captured (no images or file paths).
"""

import logging
import subprocess
import threading
import time
from typing import Callable, Optional

from platform_utils import IS_WINDOWS, IS_LINUX, is_command_available, is_wayland

logger = logging.getLogger("nox.eye.clipboard")

# Conditional imports — Windows
try:
    import win32clipboard
    _WINCLIP_AVAILABLE = True
except ImportError:
    _WINCLIP_AVAILABLE = False

# Conditional imports — Linux (pyperclip)
try:
    import pyperclip
    _PYPERCLIP_AVAILABLE = True
except ImportError:
    _PYPERCLIP_AVAILABLE = False


class ClipboardMonitor:
    """Monitors system clipboard for text changes."""

    POLL_INTERVAL = 1.0  # seconds

    def __init__(self):
        self.on_clipboard_change: Optional[Callable[[str], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._last_text: str = ""

    @property
    def is_available(self) -> bool:
        if IS_WINDOWS:
            return _WINCLIP_AVAILABLE
        elif IS_LINUX:
            if _PYPERCLIP_AVAILABLE:
                return True
            # Fallback: wl-paste on Wayland
            if is_wayland() and is_command_available("wl-paste"):
                return True
            # Fallback: xclip on X11
            if is_command_available("xclip") or is_command_available("xsel"):
                return True
            return False
        return False

    def start(self) -> None:
        if not self.is_available:
            logger.warning("ClipboardMonitor unavailable: no clipboard backend")
            return
        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True, name="clipboard-monitor")
        self._thread.start()
        logger.info("Clipboard monitor started")

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        logger.info("Clipboard monitor stopped")

    def pause(self) -> None:
        self._paused = True
        logger.debug("Clipboard monitor paused")

    def resume(self) -> None:
        self._paused = False
        logger.debug("Clipboard monitor resumed")

    def _get_clipboard_text(self) -> Optional[str]:
        """Read text from clipboard, return None if not text or error."""
        if IS_WINDOWS and _WINCLIP_AVAILABLE:
            return self._get_clipboard_win32()
        elif IS_LINUX:
            if _PYPERCLIP_AVAILABLE:
                text = self._get_clipboard_pyperclip()
                if text is not None:
                    return text
                # pyperclip failed — try wl-paste on Wayland
            if is_wayland() and is_command_available("wl-paste"):
                return self._get_clipboard_wl_paste()
            if is_command_available("xclip"):
                return self._get_clipboard_xclip()
        return None

    def _get_clipboard_win32(self) -> Optional[str]:
        """Read text from Windows clipboard."""
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                    return win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            return None
        return None

    def _get_clipboard_pyperclip(self) -> Optional[str]:
        """Read text from clipboard via pyperclip (Linux/macOS)."""
        try:
            return pyperclip.paste()
        except Exception:
            return None

    def _get_clipboard_wl_paste(self) -> Optional[str]:
        """Read text from Wayland clipboard via wl-paste (COSMIC/Sway/Hyprland)."""
        try:
            result = subprocess.run(
                ["wl-paste", "--no-newline"],
                capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0:
                return result.stdout
            return None
        except Exception:
            return None

    def _get_clipboard_xclip(self) -> Optional[str]:
        """Read text from X11 clipboard via xclip."""
        try:
            result = subprocess.run(
                ["xclip", "-selection", "clipboard", "-o"],
                capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0:
                return result.stdout
            return None
        except Exception:
            return None

    def _run(self) -> None:
        while self._running:
            if self._paused:
                time.sleep(self.POLL_INTERVAL)
                continue

            try:
                text = self._get_clipboard_text()
                if text and text != self._last_text:
                    self._last_text = text
                    logger.debug("Clipboard changed: %d chars", len(text))
                    if self.on_clipboard_change:
                        try:
                            self.on_clipboard_change(text)
                        except Exception as exc:
                            logger.error("Clipboard callback error: %s", exc, exc_info=True)
            except Exception as exc:
                logger.debug("Clipboard monitor tick error: %s", exc)

            time.sleep(self.POLL_INTERVAL)
