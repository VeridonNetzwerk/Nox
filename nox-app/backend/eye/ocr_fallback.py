"""OCR fallback – screenshot + Tesseract for apps where UIA fails.

Captures the active window region and runs Tesseract OCR to extract text.
Used as a last resort when UI Automation returns nothing.

Windows: Uses win32gui.GetWindowRect + PIL.ImageGrab for window-region capture.
Linux:   Uses mss for full-screen capture (window-region capture not available
         on Wayland without compositor-specific APIs).
"""

import logging
from typing import List, Optional

from platform_utils import IS_WINDOWS, IS_LINUX, can_screenshot_mss, can_screenshot_portal, capture_screenshot_portal

logger = logging.getLogger("nox.eye.ocr")

# Conditional imports
try:
    import numpy as np
    from PIL import ImageGrab, Image
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

try:
    import pytesseract
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False

try:
    import win32gui
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False

# Linux: mss for screenshots
try:
    import mss
    _MSS_AVAILABLE = True
except ImportError:
    _MSS_AVAILABLE = False


class OCRFallback:
    """Screenshot-based OCR using Tesseract (lightweight, CPU-only)."""

    MAX_TEXT_LENGTH = 5000

    def __init__(self, languages: Optional[List[str]] = None, gpu: bool = True):
        self.languages = languages or ["de", "en"]
        self.gpu = gpu  # Ignored — Tesseract is CPU-only, kept for compat

    @property
    def is_available(self) -> bool:
        if IS_WINDOWS:
            return _TESSERACT_AVAILABLE and _PIL_AVAILABLE and _WIN32_AVAILABLE
        elif IS_LINUX:
            if can_screenshot_mss():
                return _TESSERACT_AVAILABLE and (_MSS_AVAILABLE or _PIL_AVAILABLE)
            elif can_screenshot_portal():
                return _TESSERACT_AVAILABLE and _PIL_AVAILABLE
            return _TESSERACT_AVAILABLE and _PIL_AVAILABLE
        return _TESSERACT_AVAILABLE and _PIL_AVAILABLE

    def _tess_lang(self) -> str:
        """Convert language list to Tesseract format."""
        lang_map = {"de": "deu", "en": "eng"}
        return "+".join(lang_map.get(l, l) for l in self.languages)

    def extract_text(self, hwnd: int) -> Optional[str]:
        """Screenshot the window and run OCR.

        Args:
            hwnd: Window handle to capture (Windows) or ignored (Linux).

        Returns:
            Extracted text or None if OCR fails.
        """
        if IS_WINDOWS and _WIN32_AVAILABLE:
            return self._extract_text_win32(hwnd)
        elif IS_LINUX:
            return self._extract_text_linux()
        return None

    def _extract_text_win32(self, hwnd: int) -> Optional[str]:
        """Screenshot specific window region on Windows."""
        if not self.is_available:
            return None
        try:
            rect = win32gui.GetWindowRect(hwnd)
            img = ImageGrab.grab(bbox=rect)

            text = pytesseract.image_to_string(img, lang=self._tess_lang())
            text = text.strip()

            if not text:
                return None
            if len(text) > self.MAX_TEXT_LENGTH:
                text = text[:self.MAX_TEXT_LENGTH] + "..."
            return text

        except Exception as exc:
            logger.debug("OCR fallback failed for hwnd=%s: %s", hwnd, exc)
            return None

    def _extract_text_linux(self) -> Optional[str]:
        """Screenshot full screen on Linux and run OCR."""
        if not self.is_available:
            return None
        try:
            img = None

            if not can_screenshot_mss() and can_screenshot_portal():
                img_bytes = capture_screenshot_portal()
                if img_bytes and _PIL_AVAILABLE:
                    import io
                    img = Image.open(io.BytesIO(img_bytes))
            elif _MSS_AVAILABLE and can_screenshot_mss():
                with mss.mss() as sct:
                    monitor = sct.monitors[0] if sct.monitors else {"left": 0, "top": 0, "width": 1920, "height": 1080}
                    raw = sct.grab(monitor)
                    if _PIL_AVAILABLE:
                        img = Image.frombytes("RGB", (raw.width, raw.height), raw.rgb)
            elif _PIL_AVAILABLE:
                img = ImageGrab.grab()

            if img is None:
                return None

            text = pytesseract.image_to_string(img, lang=self._tess_lang())
            text = text.strip()

            if not text:
                return None
            if len(text) > self.MAX_TEXT_LENGTH:
                text = text[:self.MAX_TEXT_LENGTH] + "..."
            return text

        except Exception as exc:
            logger.debug("OCR fallback (Linux) failed: %s", exc)
            return None
