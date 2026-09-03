"""Eye Manager – orchestrates screen context capture for Nox.

Nox Eye provides:
1. On-demand screen reading via 'bildschirm_ansehen' tool (UIA + OCR)
2. Window-change-based screenshot history (captures when active window changes)
3. Clipboard monitoring (text changes stored in ContextStore)
4. Context search over stored history (FTS5 + semantic)

The screenshot history runs in a daemon thread and captures all monitors
only when the active window changes (or every 5 min as fallback).
On-demand capture uses UI Automation first, OCR as fallback.
Clipboard monitoring runs continuously (lightweight, text-only, 1s poll).

Threading:
- Screenshot history: daemon thread (window-change-based capture)
- Clipboard monitor: daemon thread (1s poll)
- OCR: on-demand only (Tesseract, CPU-only)
- Cleanup: runs periodically in a daemon thread
"""

import logging
import threading
import time
from typing import Any, Optional

from .window_monitor import WindowMonitor
from .uia_reader import UIAReader
from .ocr_fallback import OCRFallback
from .context_store import ContextStore
from .screenshot_history import ScreenshotHistory
from .clipboard_monitor import ClipboardMonitor
from .vision_analyzer import VisionAnalyzer

logger = logging.getLogger("nox.eye.manager")


class EyeManager:
    """Orchestrates on-demand screen context capture and screenshot history."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._enabled = config.get("nox_eye_enabled", False)
        self._paused = False

        # Excluded apps — Nox itself (don't read own UI), password managers
        excluded_apps = config.get("nox_eye_excluded_apps", [
            "keepass", "1password", "bitwarden", "lastpass",
            "enpass", "dashlane",
            "nox", "electron",
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

        # Vision analyzer — Florence-2 (in-process) + cloud (OVH) + local fallback
        self.vision_analyzer = VisionAnalyzer(config)

        # Clipboard monitor — tracks text changes and stores in ContextStore
        self.clipboard_monitor = ClipboardMonitor()
        self.clipboard_monitor.on_clipboard_change = self._on_clipboard_change

        self._cleanup_thread: Optional[threading.Thread] = None
        self._running = False

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def is_available(self) -> bool:
        return self.window_monitor.is_available or self.screenshot_history.is_available

    def start(self) -> None:
        if not self._enabled:
            logger.info("Nox Eye disabled in config")
            return
        if not self.is_available:
            logger.warning("Nox Eye not available – missing platform dependencies")
            return

        self._running = True
        # Only start screenshot history (lightweight periodic capture)
        # Window monitor and clipboard monitor are NOT started continuously
        self.screenshot_history.start()
        
        # Start clipboard monitor (lightweight, text-only)
        if self.clipboard_monitor.is_available:
            self.clipboard_monitor.start()
            logger.info("Clipboard monitor started")

        # Start periodic cleanup thread
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, daemon=True, name="eye-cleanup"
        )
        self._cleanup_thread.start()

        logger.info("EyeManager started (screenshot history only, on-demand capture for tools)")

    def stop(self) -> None:
        self._running = False
        self.screenshot_history.stop()
        self.clipboard_monitor.stop()
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

    def _on_clipboard_change(self, text: str) -> None:
        """Store clipboard text in ContextStore."""
        try:
            app_name, window_title = self._get_active_window_info_for_clipboard()
            self.context_store.insert(
                app_name=app_name,
                window_title=window_title,
                content_type="clipboard",
                content_text=text,
            )
            logger.debug("Clipboard stored: %d chars", len(text))
        except Exception as exc:
            logger.debug("Clipboard store failed: %s", exc)

    def _get_active_window_info_for_clipboard(self) -> tuple[str, str]:
        """Get active window info for clipboard context."""
        try:
            info = self.window_monitor.get_active_window()
            if info:
                return info.app_name, info.title
        except Exception:
            pass
        return "", ""

    def _capture_screenshot_bytes(self) -> Optional[bytes]:
        """Capture a fresh screenshot and return JPEG bytes."""
        if self.screenshot_history.is_available:
            return self.screenshot_history._capture_all_monitors()
        return None

    def _vision_analyze(self, image_bytes: bytes, window_title: str = "", app_name: str = "") -> Optional[str]:
        """Run vision analysis on screenshot bytes. Returns description or None."""
        if not self.vision_analyzer.is_enabled:
            return None
        try:
            return self.vision_analyzer.analyze_screenshot(image_bytes, window_title, app_name)
        except Exception as exc:
            logger.debug("Vision analysis failed: %s", exc)
            return None

    def read_screen_now(self) -> str:
        """On-demand screen reading: fresh screenshot + vision analysis.

        This is the primary method for the 'bildschirm_ansehen' tool.
        Cascade: vision analysis (OVH/local) → UIA → OCR fallback.
        """
        # Get active window info for context
        window_title = ""
        app_name = ""
        if self.window_monitor.is_available:
            info = self.window_monitor.get_active_window()
            if info:
                window_title = info.title
                app_name = info.app_name

        # 1. Try vision analysis on a fresh screenshot
        img_bytes = self._capture_screenshot_bytes()
        if img_bytes:
            vision_text = self._vision_analyze(img_bytes, window_title, app_name)
            if vision_text:
                prefix = f"Aktives Fenster: {window_title} (App: {app_name})\n" if window_title else ""
                return f"{prefix}Bildschirmanalyse:\n{vision_text}"

        # 2. Fallback: UIA for active window
        if self.window_monitor.is_available:
            info = self.window_monitor.get_active_window()
            if info and not self.window_monitor._is_excluded(info):
                if self.uia_reader.is_available:
                    text = self.uia_reader.extract_text(info.hwnd)
                    if text:
                        if len(text) > 3000:
                            text = text[:3000] + "..."
                        return f"Aktives Fenster: {info.title} (App: {info.app_name})\nInhalt:\n{text}"
            else:
                # Active window is excluded (e.g. Nox itself) — find a media/content window
                media_info = self.window_monitor.find_last_active_media_window()
                if media_info and self.uia_reader.is_available:
                    text = self.uia_reader.extract_text(media_info.hwnd)
                    if text:
                        if len(text) > 3000:
                            text = text[:3000] + "..."
                        return f"Fenster: {media_info.title} (App: {media_info.app_name})\nInhalt:\n{text}"

        # 3. Last resort: screenshot + OCR
        if self.screenshot_history.is_available:
            return self.screenshot_history.extract_text_now()

        return "Bildschirm-Erfassung nicht verfügbar."

    def read_window_by_app_name(self, app_name: str) -> str:
        """Find a window by app name and read its content.
        
        Tries vision analysis on a fresh screenshot first, then UIA, then OCR.
        """
        # 1. Try vision analysis on a fresh screenshot
        img_bytes = self._capture_screenshot_bytes()
        if img_bytes:
            # Try to get window title for the specific app
            w_title = ""
            w_app = app_name
            if self.window_monitor.is_available:
                info = self.window_monitor.find_window_by_app_name(app_name)
                if info:
                    w_title = info.title
                    w_app = info.app_name
            vision_text = self._vision_analyze(img_bytes, w_title, w_app)
            if vision_text:
                prefix = f"Fenster: {w_title} (App: {w_app})\n" if w_title else ""
                return f"{prefix}Bildschirmanalyse:\n{vision_text}"

        # 2. Fallback: UIA for the specific window
        if not self.window_monitor.is_available:
            if self.screenshot_history.is_available:
                return self.screenshot_history.extract_text_now()
            return "Bildschirm-Erfassung nicht verfügbar."

        info = self.window_monitor.find_window_by_app_name(app_name)
        if not info:
            logger.info("No window found for app '%s', falling back to active window", app_name)
            return self.read_screen_now()

        if self.uia_reader.is_available:
            text = self.uia_reader.extract_text(info.hwnd)
            if text:
                if len(text) > 3000:
                    text = text[:3000] + "..."
                return f"Fenster: {info.title} (App: {info.app_name})\nInhalt:\n{text}"

        # UIA failed — fall back to screenshot OCR
        if self.screenshot_history.is_available:
            return self.screenshot_history.extract_text_now()

        return f"Fenster gefunden ({info.title}) aber Inhalt konnte nicht gelesen werden."

    # Known media player apps to search for when user references screen content
    # without naming a specific app
    MEDIA_APPS = [
        "emby", "netflix", "amazon", "prime", "disney", "hulu", "crunchyroll",
        "vlc", "mpv", "plex", "jellyfin", "youtube", "twitch", "kodi",
        "mplayer", "potplayer", "mpc-hc", "mpc-be",
    ]

    def read_media_window(self) -> str:
        """Find and read a media player window (Emby, Netflix, VLC, etc.).
        
        Tries vision analysis on a fresh screenshot first, then UIA for
        known media apps, then largest non-excluded window, then OCR.
        """
        # 1. Try vision analysis on a fresh screenshot
        img_bytes = self._capture_screenshot_bytes()
        if img_bytes:
            # Find media window for context
            w_title = ""
            w_app = ""
            if self.window_monitor.is_available:
                for app in self.MEDIA_APPS:
                    info = self.window_monitor.find_window_by_app_name(app)
                    if info:
                        w_title = info.title
                        w_app = info.app_name
                        break
            vision_text = self._vision_analyze(img_bytes, w_title, w_app)
            if vision_text:
                prefix = f"Fenster: {w_title} (App: {w_app})\n" if w_title else ""
                return f"{prefix}Bildschirmanalyse:\n{vision_text}"

        # 2. Fallback: UIA for known media apps
        if not self.window_monitor.is_available:
            if self.screenshot_history.is_available:
                return self.screenshot_history.extract_text_now()
            return "Bildschirm-Erfassung nicht verfügbar."

        for app_name in self.MEDIA_APPS:
            info = self.window_monitor.find_window_by_app_name(app_name)
            if info:
                logger.info("Found media window via app search: %s (%s)", info.title, info.app_name)
                if self.uia_reader.is_available:
                    text = self.uia_reader.extract_text(info.hwnd)
                    if text:
                        if len(text) > 3000:
                            text = text[:3000] + "..."
                        return f"Fenster: {info.title} (App: {info.app_name})\nInhalt:\n{text}"

        # No known media app found — try largest non-excluded window
        media_info = self.window_monitor.find_last_active_media_window()
        if media_info and self.uia_reader.is_available:
            text = self.uia_reader.extract_text(media_info.hwnd)
            if text:
                if len(text) > 3000:
                    text = text[:3000] + "..."
                return f"Fenster: {media_info.title} (App: {media_info.app_name})\nInhalt:\n{text}"

        # Last resort: screenshot OCR
        if self.screenshot_history.is_available:
            return self.screenshot_history.extract_text_now()

        return "Bildschirm-Erfassung nicht verfügbar."

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
                "engine": "tesseract",
            },
            "screenshot_history": self.screenshot_history.health(),
            "clipboard_monitor": {
                "available": self.clipboard_monitor.is_available,
                "running": self.clipboard_monitor._running,
            },
            "context_store": {
                "db_path": self.context_store.db_path,
                "embedding_model": self.context_store.embedding_model_name,
                "ttl_days": self.context_store.ttl_days,
            },
        }
