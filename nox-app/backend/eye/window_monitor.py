"""Active window monitor – tracks window focus changes.

Windows: Uses Win32 API (win32gui) to detect foreground window changes.

A short-interval check (every 500ms) compares the current foreground window
handle against the last known one, which is much cheaper than full polling
of window content.
"""

import logging
import threading
import time
from typing import Callable, List, Optional

from platform_utils import IS_WINDOWS

logger = logging.getLogger("nox.eye.window")

# Conditional imports — Windows
try:
    import win32gui
    import win32process
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False

try:
    import psutil
    _PSUTIL_AVAILABLE = True
except ImportError:
    _PSUTIL_AVAILABLE = False


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
    """Monitors active window changes via platform-native APIs."""

    POLL_INTERVAL = 1.0  # seconds – lightweight check

    def __init__(self, excluded_apps: Optional[List[str]] = None):
        self.excluded_apps = {a.lower() for a in (excluded_apps or [])}
        self.on_window_change: Optional[Callable[[WindowInfo], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._last_hwnd: int = 0

    @property
    def is_available(self) -> bool:
        return IS_WINDOWS and _WIN32_AVAILABLE

    def start(self) -> None:
        if not self.is_available:
            logger.warning("WindowMonitor unavailable: no backend")
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
        if IS_WINDOWS and _WIN32_AVAILABLE:
            return self._get_foreground_window_win32()
        return None

    def find_window_by_app_name(self, app_name: str) -> Optional[WindowInfo]:
        """Find a visible window whose app name or title contains the given string.

        Useful when the user mentions an app (e.g. "Emby") but it's not the active window.
        """
        app_lower = app_name.lower()
        if IS_WINDOWS and _WIN32_AVAILABLE:
            return self._find_window_win32(app_lower)
        return None

    def _find_window_win32(self, app_lower: str) -> Optional[WindowInfo]:
        """Enumerate all windows on Windows and find one matching app_lower."""
        found = []

        def _enum_callback(hwnd, _):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True
                title = win32gui.GetWindowText(hwnd) or ""
                if not title:
                    return True
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                process_name = ""
                app_name = ""
                try:
                    proc = psutil.Process(pid)
                    process_name = proc.name()
                    app_name = proc.name().rsplit(".", 1)[0]
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
                # Check if app name or title contains the search string
                if app_lower in app_name.lower() or app_lower in title.lower():
                    found.append(WindowInfo(hwnd=hwnd, title=title, app_name=app_name,
                                           process_name=process_name, pid=pid))
            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(_enum_callback, None)
        except Exception as exc:
            logger.debug("EnumWindows failed: %s", exc)

        if found:
            # Prefer the largest window (likely the main app window, not a small popup)
            def _window_area(w):
                try:
                    rect = win32gui.GetWindowRect(w.hwnd)
                    return (rect[2] - rect[0]) * (rect[3] - rect[1])
                except Exception:
                    return 0
            best = max(found, key=_window_area)
            logger.info("Found window for '%s': %s (hwnd=%s)", app_lower, best.title, best.hwnd)
            return best
        return None

    def find_last_active_media_window(self) -> Optional[WindowInfo]:
        """Find the best candidate for a media/content window when the active window is excluded.

        Enumerates all visible windows, excludes Nox and password managers,
        and returns the largest remaining window (likely a media player, browser, etc.)
        """
        if not (IS_WINDOWS and _WIN32_AVAILABLE):
            return None

        candidates = []

        def _enum_callback(hwnd, _):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return True
                title = win32gui.GetWindowText(hwnd) or ""
                if not title or len(title) < 3:
                    return True
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                process_name = ""
                app_name = ""
                try:
                    proc = psutil.Process(pid)
                    process_name = proc.name()
                    app_name = proc.name().rsplit(".", 1)[0]
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

                info = WindowInfo(hwnd=hwnd, title=title, app_name=app_name,
                                  process_name=process_name, pid=pid)
                # Exclude Nox, password managers, and system tray-like windows
                if self._is_excluded(info):
                    return True
                # Exclude small windows (likely tooltips, tray icons, etc.)
                try:
                    rect = win32gui.GetWindowRect(hwnd)
                    w = rect[2] - rect[0]
                    h = rect[3] - rect[1]
                    if w < 200 or h < 200:
                        return True
                except Exception:
                    return True

                candidates.append(info)
            except Exception:
                pass
            return True

        try:
            win32gui.EnumWindows(_enum_callback, None)
        except Exception as exc:
            logger.debug("EnumWindows failed: %s", exc)

        if not candidates:
            return None

        # Prefer the largest window
        def _window_area(w):
            try:
                rect = win32gui.GetWindowRect(w.hwnd)
                return (rect[2] - rect[0]) * (rect[3] - rect[1])
            except Exception:
                return 0

        best = max(candidates, key=_window_area)
        logger.info("Found media window: %s (app=%s, hwnd=%s)", best.title, best.app_name, best.hwnd)
        return best

    def _get_foreground_window_win32(self) -> Optional[WindowInfo]:
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

    # -----------------------------------------------------------------------
    # Shared logic
    # -----------------------------------------------------------------------

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
                info = self.get_active_window()
                if info and info.hwnd != self._last_hwnd and info.hwnd != 0:
                    self._last_hwnd = info.hwnd
                    if not self._is_excluded(info):
                        logger.debug("Window changed: %s", info)
                        if self.on_window_change:
                            try:
                                self.on_window_change(info)
                            except Exception as exc:
                                logger.error("Window change callback error: %s", exc, exc_info=True)
            except Exception as exc:
                logger.debug("Window monitor tick error: %s", exc)

            time.sleep(self.POLL_INTERVAL)
