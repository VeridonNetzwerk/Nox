"""Screenshot history — periodic multi-monitor capture with 1h ring buffer.

Takes screenshots of all monitors at a configurable interval (default 60s),
keeps them in memory for 1 hour, and provides on-demand capture + OCR
extraction for the AI tool interface.

Threading:
- Capture thread: daemon, takes screenshots at interval
- OCR: on-demand only (expensive, GPU-bound)
"""

import io
import logging
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from typing import Optional

from platform_utils import IS_WINDOWS, IS_LINUX, can_screenshot_mss, can_screenshot_portal, capture_screenshot_portal, is_cosmic
import atspi_compat

logger = logging.getLogger("nox.eye.screenshot")

try:
    from PIL import ImageGrab, Image
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

try:
    import numpy as np
    _NP_AVAILABLE = True
except ImportError:
    _NP_AVAILABLE = False

# Windows-specific imports
try:
    import win32gui
    import win32process
    import psutil
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False

# Linux: mss for screenshots (cross-platform, works on X11 and Wayland)
try:
    import mss
    _MSS_AVAILABLE = True
except ImportError:
    _MSS_AVAILABLE = False

try:
    import pytesseract
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False


class ScreenshotEntry:
    """One screenshot snapshot with metadata."""

    __slots__ = ("timestamp", "image_bytes", "app_name", "window_title")

    def __init__(self, timestamp: str, image_bytes: bytes, app_name: str, window_title: str):
        self.timestamp = timestamp
        self.image_bytes = image_bytes  # JPEG-compressed bytes
        self.app_name = app_name
        self.window_title = window_title


class ScreenshotHistory:
    """Periodic multi-monitor screenshot capture with ring buffer."""

    def __init__(
        self,
        interval_seconds: int = 60,
        history_hours: float = 1.0,
        ocr_gpu: bool = True,
        ocr_languages: Optional[list[str]] = None,
    ):
        self.interval = interval_seconds
        self.history_hours = history_hours
        self.ocr_gpu = ocr_gpu
        self.ocr_languages = ocr_languages or ["de", "en"]

        self._buffer: deque[ScreenshotEntry] = deque()
        self._max_entries = int((history_hours * 3600) / max(interval_seconds, 1))
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._ocr_reader = None

    @property
    def is_available(self) -> bool:
        if IS_WINDOWS:
            return _PIL_AVAILABLE
        elif IS_LINUX:
            # mss works on X11 and wlroots Wayland, but NOT on COSMIC/GNOME Wayland
            # For COSMIC/GNOME, we need xdg-desktop-portal
            if can_screenshot_mss():
                return _MSS_AVAILABLE or _PIL_AVAILABLE
            elif can_screenshot_portal():
                return _PIL_AVAILABLE  # PIL needed to process the portal screenshot
            return _PIL_AVAILABLE
        return _PIL_AVAILABLE

    def start(self) -> None:
        if not self.is_available:
            logger.warning("ScreenshotHistory unavailable: PIL not installed")
            return
        self._running = True
        self._paused = False
        self._thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="screenshot-history"
        )
        self._thread.start()
        logger.info(
            "Screenshot history started (interval=%ds, history=%.1fh, max_entries=%d)",
            self.interval, self.history_hours, self._max_entries,
        )

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        with self._lock:
            self._buffer.clear()
        logger.info("Screenshot history stopped")

    def pause(self) -> None:
        self._paused = True
        logger.debug("Screenshot history paused")

    def resume(self) -> None:
        self._paused = False
        logger.debug("Screenshot history resumed")

    def update_interval(self, seconds: int) -> None:
        """Hot-update the capture interval."""
        self.interval = max(10, seconds)
        self._max_entries = int((self.history_hours * 3600) / self.interval)
        logger.info("Screenshot interval updated: %ds (max_entries=%d)", self.interval, self._max_entries)

    def _get_active_window_info(self) -> tuple[str, str]:
        """Get active window app name and title."""
        if IS_WINDOWS and _WIN32_AVAILABLE:
            return self._get_active_window_info_win32()
        elif IS_LINUX:
            return self._get_active_window_info_linux()
        return "", ""

    def _get_active_window_info_win32(self) -> tuple[str, str]:
        """Get active window info on Windows."""
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return "", ""
            title = win32gui.GetWindowText(hwnd) or ""
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            app_name = ""
            try:
                proc = psutil.Process(pid)
                app_name = proc.name().rsplit(".", 1)[0]
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            return app_name, title
        except Exception:
            return "", ""

    def _get_active_window_info_linux(self) -> tuple[str, str]:
        """Get active window info on Linux via xdotool/kdotool/cosmic-ext-window-helper/AT-SPI2."""
        from platform_utils import is_command_available, get_display_server, is_cosmic
        try:
            ds = get_display_server()
            if ds == "x11" and is_command_available("xdotool"):
                result = subprocess.run(
                    ["xdotool", "getactivewindow", "getwindowname"],
                    capture_output=True, text=True, timeout=2
                )
                title = result.stdout.strip() if result.returncode == 0 else ""
                result = subprocess.run(
                    ["xdotool", "getactivewindow", "getwindowpid"],
                    capture_output=True, text=True, timeout=2
                )
                pid = int(result.stdout.strip()) if result.returncode == 0 else 0
                app_name = ""
                if pid:
                    try:
                        import psutil
                        proc = psutil.Process(pid)
                        app_name = proc.name()
                    except Exception:
                        pass
                return app_name, title
            elif ds == "wayland":
                # COSMIC: try cosmic-ext-window-helper first
                if is_cosmic() and is_command_available("cosmic-ext-window-helper"):
                    try:
                        result = subprocess.run(
                            ["cosmic-ext-window-helper", "state"],
                            capture_output=True, text=True, timeout=2
                        )
                        if result.returncode == 0 and result.stdout.strip():
                            import json
                            windows = json.loads(result.stdout.strip())
                            for win in windows:
                                if win.get("is_active"):
                                    app_name = win.get("app_id", "")
                                    title = win.get("title", "")
                                    if app_name or title:
                                        return app_name, title
                    except Exception:
                        pass
                # KDE Wayland: kdotool
                if is_command_available("kdotool"):
                    result = subprocess.run(
                        ["kdotool", "getactivewindow", "getwindowname"],
                        capture_output=True, text=True, timeout=2
                    )
                    title = result.stdout.strip() if result.returncode == 0 else ""
                    result = subprocess.run(
                        ["kdotool", "getactivewindow", "getwindowpid"],
                        capture_output=True, text=True, timeout=2
                    )
                    pid = int(result.stdout.strip()) if result.returncode == 0 else 0
                    app_name = ""
                    if pid:
                        try:
                            import psutil
                            proc = psutil.Process(pid)
                            app_name = proc.name()
                        except Exception:
                            pass
                    return app_name, title
                # AT-SPI2 fallback for COSMIC/GNOME Wayland
                try:
                    desktop = atspi_compat.get_desktop(0)
                    if desktop is None:
                        return app_name, title
                    for i in range(atspi_compat.get_child_count(desktop)):
                        app = atspi_compat.get_child_at_index(desktop, i)
                        if app is None:
                            continue
                        try:
                            state_set = atspi_compat.get_state_set(app)
                            if atspi_compat.state_contains(state_set, atspi_compat.STATE_ACTIVE):
                                app_name = atspi_compat.get_name(app)
                                title = ""
                                for j in range(atspi_compat.get_child_count(app)):
                                    child = atspi_compat.get_child_at_index(app, j)
                                    if child is None:
                                        continue
                                    try:
                                        child_state = atspi_compat.get_state_set(child)
                                        if atspi_compat.state_contains(child_state, atspi_compat.STATE_ACTIVE):
                                            title = atspi_compat.get_name(child)
                                            break
                                    except Exception:
                                        continue
                                return app_name, title
                        except Exception:
                            continue
                except Exception:
                    pass
        except Exception:
            pass
        return "", ""

    def _capture_all_monitors(self) -> Optional[bytes]:
        """Capture a screenshot of all monitors and return JPEG-compressed bytes."""
        if IS_LINUX:
            # On COSMIC/GNOME Wayland, mss doesn't work — use xdg-desktop-portal
            if not can_screenshot_mss() and can_screenshot_portal():
                return self._capture_portal()
            # On X11 or wlroots Wayland, use mss
            if _MSS_AVAILABLE and can_screenshot_mss():
                return self._capture_mss()
            # Fallback to PIL (works on X11)
            if _PIL_AVAILABLE:
                return self._capture_pil()
            # Last resort: try portal even if mss was expected
            if can_screenshot_portal():
                return self._capture_portal()
        elif _PIL_AVAILABLE:
            return self._capture_pil()
        return None

    def _capture_pil(self) -> Optional[bytes]:
        """Capture via PIL.ImageGrab (Windows)."""
        try:
            img = ImageGrab.grab(all_screens=True)
            if img.width > 1920:
                ratio = 1920 / img.width
                img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=70)
            return buf.getvalue()
        except Exception as exc:
            logger.debug("Screenshot capture (PIL) failed: %s", exc)
            return None

    def _capture_portal(self) -> Optional[bytes]:
        """Capture via xdg-desktop-portal D-Bus (COSMIC/GNOME Wayland)."""
        try:
            return capture_screenshot_portal()
        except Exception as exc:
            logger.debug("Screenshot capture (portal) failed: %s", exc)
            return None

    def _capture_mss(self) -> Optional[bytes]:
        """Capture via mss (Linux X11 and wlroots Wayland)."""
        try:
            with mss.mss() as sct:
                # Capture all monitors combined
                monitors = sct.monitors
                if not monitors or len(monitors) <= 1:
                    # monitors[0] is the combined virtual screen on most systems
                    monitor = monitors[0] if monitors else {"left": 0, "top": 0, "width": 1920, "height": 1080}
                else:
                    monitor = monitors[0]

                raw = sct.grab(monitor)
                # Convert BGRA to RGB
                if _NP_AVAILABLE:
                    arr = np.frombuffer(raw.rgb, dtype=np.uint8)
                    arr = arr.reshape(raw.height, raw.width, 3)
                    img = Image.fromarray(arr, "RGB")
                else:
                    # Fallback without numpy
                    img = Image.frombytes("RGB", (raw.width, raw.height), raw.rgb)

                if img.width > 1920:
                    ratio = 1920 / img.width
                    img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=70)
                return buf.getvalue()
        except Exception as exc:
            logger.debug("Screenshot capture (mss) failed: %s", exc)
            return None

    def _capture_loop(self) -> None:
        last_window_key = None
        last_capture_time = 0.0
        # Max interval: even if window doesn't change, capture every 5 min
        max_interval = 300

        while self._running:
            if self._paused:
                time.sleep(self.interval)
                continue

            try:
                app_name, window_title = self._get_active_window_info()
                window_key = f"{app_name}|{window_title}"
                now = time.time()

                # Capture only on window change or max interval elapsed
                should_capture = (
                    window_key != last_window_key
                    or (now - last_capture_time) >= max_interval
                )

                if should_capture:
                    img_bytes = self._capture_all_monitors()
                    if img_bytes is not None:
                        entry = ScreenshotEntry(
                            timestamp=datetime.now().isoformat(),
                            image_bytes=img_bytes,
                            app_name=app_name,
                            window_title=window_title,
                        )
                        with self._lock:
                            self._buffer.append(entry)
                            while len(self._buffer) > self._max_entries:
                                self._buffer.popleft()
                        last_window_key = window_key
                        last_capture_time = now
                        logger.debug("Screenshot captured (buffer=%d, trigger=%s)", len(self._buffer), "change" if window_key != last_window_key else "timeout")
            except Exception as exc:
                logger.debug("Screenshot capture error: %s", exc)

            # Poll window changes at 2s interval (lightweight), not the full capture interval
            time.sleep(2)

    def capture_now(self) -> Optional[ScreenshotEntry]:
        """Take an immediate screenshot and return it."""
        if not self.is_available:
            return None
        img_bytes = self._capture_all_monitors()
        if img_bytes is None:
            return None
        app_name, window_title = self._get_active_window_info()
        entry = ScreenshotEntry(
            timestamp=datetime.now().isoformat(),
            image_bytes=img_bytes,
            app_name=app_name,
            window_title=window_title,
        )
        with self._lock:
            self._buffer.append(entry)
            while len(self._buffer) > self._max_entries:
                self._buffer.popleft()
        return entry

    def get_latest(self) -> Optional[ScreenshotEntry]:
        """Get the most recent screenshot from the buffer."""
        with self._lock:
            if self._buffer:
                return self._buffer[-1]
        return None

    def get_history_summary(self) -> str:
        """Return a text summary of the screenshot history (timestamps + active windows)."""
        with self._lock:
            entries = list(self._buffer)

        if not entries:
            return "Keine Screenshot-Historie verfügbar."

        lines = [f"Screenshot-Historie ({len(entries)} Einträge, letzte {self.history_hours}h):"]
        for entry in entries:
            lines.append(
                f"  [{entry.timestamp}] App: {entry.app_name}, Fenster: {entry.window_title}"
            )
        return "\n".join(lines)

    def extract_text_from_latest(self) -> str:
        """OCR the most recent screenshot and return extracted text."""
        entry = self.get_latest()
        if entry is None:
            return "Kein Screenshot verfügbar."
        return self._ocr_image(entry.image_bytes, entry.app_name, entry.window_title)

    def extract_text_now(self) -> str:
        """Capture a fresh screenshot and OCR it immediately."""
        entry = self.capture_now()
        if entry is None:
            return "Konnte keinen Screenshot erstellen."
        return self._ocr_image(entry.image_bytes, entry.app_name, entry.window_title)

    def _ensure_ocr_reader(self):
        """Check Tesseract availability (no lazy init needed — it's a CLI tool)."""
        if self._ocr_reader is not None:
            return
        if not _TESSERACT_AVAILABLE:
            logger.warning("pytesseract not available — screenshot OCR disabled")
            return
        self._ocr_reader = True  # Just a flag — Tesseract is stateless
        logger.info("Tesseract OCR ready for screenshots")

    def _tess_lang(self) -> str:
        """Convert language list to Tesseract format."""
        lang_map = {"de": "deu", "en": "eng"}
        return "+".join(lang_map.get(l, l) for l in self.ocr_languages)

    def _ocr_image(self, image_bytes: bytes, app_name: str, window_title: str) -> str:
        """Run OCR on JPEG-compressed image bytes and return formatted text."""
        self._ensure_ocr_reader()
        if self._ocr_reader is None:
            return "OCR nicht verfügbar (Tesseract nicht installiert)."

        try:
            img = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(img, lang=self._tess_lang())
            text = text.strip()
            if not text:
                return f"Aktiver Bildschirm: {window_title} (App: {app_name})\nKein Text erkannt."

            if len(text) > 5000:
                text = text[:5000] + "..."

            return f"Aktiver Bildschirm: {window_title} (App: {app_name})\nErkannter Text:\n{text}"
        except Exception as exc:
            logger.error("OCR failed: %s", exc, exc_info=True)
            return f"OCR fehlgeschlagen: {exc}"

    def health(self) -> dict:
        """Return health status."""
        with self._lock:
            buffer_count = len(self._buffer)
        return {
            "available": self.is_available,
            "running": self._running,
            "paused": self._paused,
            "interval": self.interval,
            "history_hours": self.history_hours,
            "buffer_count": buffer_count,
            "max_entries": self._max_entries,
            "ocr_available": self._ocr_reader is not None,
        }
