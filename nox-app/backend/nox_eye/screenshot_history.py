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
import threading
import time
from collections import deque
from datetime import datetime
from typing import Optional

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

try:
    import win32gui
    import win32process
    import psutil
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False


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
        if not _WIN32_AVAILABLE:
            return "", ""
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

    def _capture_all_monitors(self) -> Optional[bytes]:
        """Capture a screenshot of all monitors and return JPEG-compressed bytes."""
        try:
            img = ImageGrab.grab(all_screens=True)
            # Downscale large screenshots to save memory (max 1920px wide)
            if img.width > 1920:
                ratio = 1920 / img.width
                img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=70)
            return buf.getvalue()
        except Exception as exc:
            logger.debug("Screenshot capture failed: %s", exc)
            return None

    def _capture_loop(self) -> None:
        while self._running:
            if self._paused:
                time.sleep(self.interval)
                continue

            try:
                img_bytes = self._capture_all_monitors()
                if img_bytes is not None:
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
                    logger.debug("Screenshot captured (buffer=%d, size=%dKB)", len(self._buffer), len(img_bytes) // 1024)
            except Exception as exc:
                logger.debug("Screenshot capture error: %s", exc)

            time.sleep(self.interval)

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
        """Lazily initialize EasyOCR reader."""
        if self._ocr_reader is not None:
            return
        try:
            import easyocr
            logger.info("Initializing EasyOCR for screenshots (gpu=%s)", self.ocr_gpu)
            self._ocr_reader = easyocr.Reader(self.ocr_languages, gpu=self.ocr_gpu)
            logger.info("EasyOCR initialized for screenshots")
        except ImportError:
            logger.warning("EasyOCR not available — screenshot OCR disabled")
        except Exception as exc:
            logger.error("Failed to initialize EasyOCR: %s", exc)

    def _ocr_image(self, image_bytes: bytes, app_name: str, window_title: str) -> str:
        """Run OCR on JPEG-compressed image bytes and return formatted text."""
        if not _NP_AVAILABLE:
            return "OCR nicht verfügbar (numpy fehlt)."

        self._ensure_ocr_reader()
        if self._ocr_reader is None:
            return "OCR nicht verfügbar (EasyOCR nicht installiert)."

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img_array = np.array(img)
            results = self._ocr_reader.readtext(img_array, detail=0, paragraph=True)
            if not results:
                return f"Aktiver Bildschirm: {window_title} (App: {app_name})\nKein Text erkannt."

            text = "\n".join(results)
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
