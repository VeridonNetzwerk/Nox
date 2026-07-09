"""Active window monitor – tracks window focus changes.

Uses Win32 API (win32gui) to detect foreground window changes without
continuous polling. A short-interval check (every 500ms) compares the
current foreground window handle against the last known one, which is
much cheaper than full polling of window content.
"""

import logging
import threading
import time
from typing import Callable, List, Optional

logger = logging.getLogger("nox.eye.window")

# Conditional imports
try:
    import win32gui
    import win32process
    import psutil
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False


class WindowInfo:
    """Snapshot of the active window."""

    __slots__ = ("hwnd", "title", "app_name", "process_name", "pid")

    def __init__(self, hwnd: int, title: str, app_name: str, process_name: str, pid: int):
        self.hwnd = hwnd
        self.title = title
        self.app_name = app_name
        self.process_name = process_name
        self.pid = pid

    def __eq__(self, other):
        if not isinstance(other, WindowInfo):
            return False
        return self.hwnd == other.hwnd

    def __repr__(self):
        return f"WindowInfo(title={self.title!r}, app={self.app_name!r}, pid={self.pid})"


class WindowMonitor:
    """Monitors active window changes via Win32 API."""

    POLL_INTERVAL = 0.5  # seconds – lightweight hwnd check

    def __init__(self, excluded_apps: Optional[List[str]] = None):
        self.excluded_apps = {a.lower() for a in (excluded_apps or [])}
        self.on_window_change: Optional[Callable[[WindowInfo], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._last_hwnd: int = 0

    @property
    def is_available(self) -> bool:
        return _WIN32_AVAILABLE

    def start(self) -> None:
        if not self.is_available:
            logger.warning("WindowMonitor unavailable: win32gui not installed")
            return
        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True, name="window-monitor")
        self._thread.start()
        logger.info("Window monitor started")

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        logger.info("Window monitor stopped")

    def pause(self) -> None:
        self._paused = True
        logger.debug("Window monitor paused")

    def resume(self) -> None:
        self._paused = False
        logger.debug("Window monitor resumed")

    def get_active_window(self) -> Optional[WindowInfo]:
        """Get current foreground window info (one-shot)."""
        if not _WIN32_AVAILABLE:
            return None
        return self._get_foreground_window()

    def _get_foreground_window(self) -> Optional[WindowInfo]:
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return None
            title = win32gui.GetWindowText(hwnd) or ""
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            process_name = ""
            app_name = ""
            try:
                proc = psutil.Process(pid)
                process_name = proc.name()
                app_name = proc.name().rsplit(".", 1)[0]
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            return WindowInfo(hwnd=hwnd, title=title, app_name=app_name,
                              process_name=process_name, pid=pid)
        except Exception as exc:
            logger.debug("Failed to get foreground window: %s", exc)
            return None

    def _is_excluded(self, info: WindowInfo) -> bool:
        app_lower = info.app_name.lower()
        proc_lower = info.process_name.lower()
        for excluded in self.excluded_apps:
            if excluded in app_lower or excluded in proc_lower:
                return True
        return False

    def _run(self) -> None:
        while self._running:
            if self._paused:
                time.sleep(self.POLL_INTERVAL)
                continue

            try:
                hwnd = win32gui.GetForegroundWindow()
                if hwnd != self._last_hwnd and hwnd != 0:
                    self._last_hwnd = hwnd
                    info = self._get_foreground_window()
                    if info and not self._is_excluded(info):
                        logger.debug("Window changed: %s", info)
                        if self.on_window_change:
                            try:
                                self.on_window_change(info)
                            except Exception as exc:
                                logger.error("Window change callback error: %s", exc, exc_info=True)
            except Exception as exc:
                logger.debug("Window monitor tick error: %s", exc)

            time.sleep(self.POLL_INTERVAL)
