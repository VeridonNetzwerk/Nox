"""Clipboard monitor – tracks text changes in the Windows clipboard.

Runs in a daemon thread, polling the clipboard at a short interval.
Only text content is captured (no images or file paths).
"""

import logging
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger("nox.eye.clipboard")

# Conditional imports
try:
    import win32clipboard
    _CLIPBOARD_AVAILABLE = True
except ImportError:
    _CLIPBOARD_AVAILABLE = False


class ClipboardMonitor:
    """Monitors Windows clipboard for text changes."""

    POLL_INTERVAL = 1.0  # seconds

    def __init__(self):
        self.on_clipboard_change: Optional[Callable[[str], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._last_text: str = ""

    @property
    def is_available(self) -> bool:
        return _CLIPBOARD_AVAILABLE

    def start(self) -> None:
        if not self.is_available:
            logger.warning("ClipboardMonitor unavailable: win32clipboard not installed")
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
