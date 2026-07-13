"""Eye Manager – orchestrates screen context capture for Nox.

Nox Eye runs ONLY when Nox is actively invoked (not continuously). It provides:
1. On-demand screen reading via 'bildschirm_lesen' tool (UIA + OCR)
2. Periodic screenshot history (default every 60s, kept for 1h)
3. Context search over stored history

The screenshot history runs in a daemon thread and captures all monitors.
On-demand capture uses UI Automation first, OCR as fallback.

Threading:
- Screenshot history: daemon thread (periodic capture)
- OCR: on-demand only (expensive, GPU-bound)
- Cleanup: runs periodically in a daemon thread
"""

import logging
import threading
import time
from datetime import datetime
from typing import Any, Optional

from .window_monitor import WindowMonitor, WindowInfo
from .uia_reader import UIAReader
from .ocr_fallback import OCRFallback
from .context_store import ContextStore
from .screenshot_history import ScreenshotHistory

logger = logging.getLogger("nox.eye.manager")


class EyeManager:
    """Orchestrates on-demand screen context capture and screenshot history."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._enabled = config.get("nox_eye_enabled", False)
        self._paused = False
        self._log_content = config.get("log_context_content", False)

        # Excluded apps (password managers, private browsers, etc.)
        excluded_apps = config.get("nox_eye_excluded_apps", [
            "keepass", "1password", "bitwarden", "lastpass",
            "enpass", "dashlane",
        ])

        # Window monitor — used for on-demand queries only (not always-on)
        self.window_monitor = WindowMonitor(excluded_apps=excluded_apps)

        self.uia_reader = UIAReader()
        self.ocr_fallback = OCRFallback(
            gpu=config.get("nox_eye_ocr_gpu", True),
        )

        self.context_store = ContextStore(
            db_path=config.get("memory_db_path", ""),
            embedding_model=config.get("memory_embedding_model", "paraphrase-multilingual-MiniLM-L12-v2"),
            ttl_days=config.get("nox_eye_ttl_days", 7),
        )

        # Screenshot history — periodic capture of all monitors
        self.screenshot_history = ScreenshotHistory(
            interval_seconds=config.get("nox_eye_screenshot_interval", 60),
            history_hours=1.0,
            ocr_gpu=config.get("nox_eye_ocr_gpu", True),
        )

        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def is_available(self) -> bool:
        return self.window_monitor.is_available

    def start(self) -> None:
        if not self._enabled:
            logger.info("Nox Eye disabled in config")
            return
        if not self.is_available:
            logger.warning("Nox Eye not available – missing win32 dependencies")
            return

        self._running = True
        # Only start screenshot history (lightweight periodic capture)
        # Window monitor and clipboard monitor are NOT started continuously
        self.screenshot_history.start()

        # Start periodic cleanup thread
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, daemon=True, name="eye-cleanup"
        )
        self._cleanup_thread.start()

        logger.info("EyeManager started (screenshot history only, on-demand capture for tools)")

    def stop(self) -> None:
        self._running = False
        self.screenshot_history.stop()
        self.context_store.close()
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            self._cleanup_thread.join(timeout=2.0)
        self._cleanup_thread = None
        logger.info("EyeManager stopped")

    def pause(self) -> None:
        """Pause screenshot history capture."""
        self._paused = True
        self.screenshot_history.pause()
        logger.info("EyeManager paused – screenshot history stopped")

    def resume(self) -> None:
        """Resume screenshot history capture."""
        self._paused = False
        self.screenshot_history.resume()
        logger.info("EyeManager resumed – screenshot history active")

    def _on_window_change(self, info: WindowInfo) -> None:
        """Called when the foreground window changes (unused in on-demand mode)."""
        pass

    def _capture_window_content(self, info: WindowInfo) -> None:
        """Extract text from the active window (UIA first, OCR fallback)."""
        if self._paused:
            return

        # Try UI Automation first
        content_text = None
        content_type = "uia"

        if self.uia_reader.is_available:
            content_text = self.uia_reader.extract_text(info.hwnd)

        # Fallback to OCR if UIA returned nothing
        if not content_text and self.config.get("nox_eye_ocr_fallback", True):
            content_type = "ocr"
            content_text = self.ocr_fallback.extract_text(info.hwnd)

        if content_text:
            self.context_store.insert(
                app_name=info.app_name,
                window_title=info.title,
                content_type=content_type,
                content_text=content_text,
            )
            logger.debug(
                "Captured %s content from %s (%d chars)",
                content_type, info.app_name, len(content_text),
            )
            if self._log_content:
                logger.debug("Content (opt-in): %s", content_text[:200])

    def get_fast_context(self) -> str:
        """Capture the current active window content on-demand (Fast Context).

        Unlike get_relevant_context which searches stored history,
        this immediately captures what's currently on screen.
        """
        if not self.is_available:
            return ""

        info = self.window_monitor.get_active_window()
        if not info:
            return ""

        # Check excluded apps
        if self.window_monitor._is_excluded(info):
            return ""

        # Try UI Automation first
        content_text = None
        if self.uia_reader.is_available:
            content_text = self.uia_reader.extract_text(info.hwnd)

        # Fallback to OCR
        if not content_text and self.config.get("nox_eye_ocr_fallback", True):
            content_text = self.ocr_fallback.extract_text(info.hwnd)

        if not content_text:
            return ""

        # Truncate for tool output
        if len(content_text) > 2000:
            content_text = content_text[:2000] + "..."

        return f"Aktuelles Fenster: {info.title} (App: {info.app_name})\nInhalt:\n{content_text}"

    def read_screen_now(self) -> str:
        """On-demand screen reading: capture all monitors + OCR.

        This is the primary method for the 'bildschirm_lesen' tool.
        Captures a fresh screenshot of all monitors and runs OCR.
        """
        if not self.is_available:
            return "Bildschirm-Erfassung nicht verfügbar."

        # Try UIA first for the active window (faster, more accurate)
        info = self.window_monitor.get_active_window()
        if info and not self.window_monitor._is_excluded(info):
            if self.uia_reader.is_available:
                text = self.uia_reader.extract_text(info.hwnd)
                if text:
                    if len(text) > 3000:
                        text = text[:3000] + "..."
                    return f"Aktives Fenster: {info.title} (App: {info.app_name})\nInhalt:\n{text}"

        # Fallback: screenshot + OCR of all monitors
        return self.screenshot_history.extract_text_now()

    def get_screenshot_history_summary(self) -> str:
        """Return a text summary of recent screenshot history."""
        return self.screenshot_history.get_history_summary()

    def get_relevant_context(
        self,
        query: str,
        k: int = 5,
        hours: float = 24.0,
    ) -> str:
        """Retrieve relevant context for a user query.

        Returns a formatted string suitable for injection into an LLM prompt.
        Returns empty string if no relevant context is found.
        """
        entries = self.context_store.get_relevant_context(query, k=k, hours=hours)
        if not entries:
            return ""

        lines = []
        for entry in entries:
            timestamp = entry.get("timestamp", "")
            app = entry.get("app_name", "")
            title = entry.get("window_title", "")
            content_type = entry.get("content_type", "")
            text = entry.get("content_text", "")
            # Truncate individual entries
            if len(text) > 500:
                text = text[:500] + "..."
            lines.append(
                f"[{timestamp}] App: {app}, Fenster: {title} ({content_type}):\n{text}"
            )

        return "\n---\n".join(lines)

    def _cleanup_loop(self) -> None:
        """Periodically clean up old entries."""
        cleanup_interval = 3600  # 1 hour
        while self._running:
            time.sleep(cleanup_interval)
            try:
                self.context_store.cleanup_old_entries()
            except Exception as exc:
                logger.error("Cleanup loop error: %s", exc, exc_info=True)

    def health(self) -> dict[str, Any]:
        """Return health status of all eye components."""
        return {
            "enabled": self._enabled,
            "paused": self._paused,
            "window_monitor": {
                "available": self.window_monitor.is_available,
                "running": self.window_monitor._running,
            },
            "uia_reader": {
                "available": self.uia_reader.is_available,
            },
            "ocr_fallback": {
                "available": self.ocr_fallback.is_available,
                "gpu": self.ocr_fallback.gpu,
            },
            "screenshot_history": self.screenshot_history.health(),
            "context_store": {
                "db_path": self.context_store.db_path,
                "embedding_model": self.context_store.embedding_model_name,
                "ttl_days": self.context_store.ttl_days,
            },
        }
