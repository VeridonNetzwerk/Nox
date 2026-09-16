"""OCR fallback – screenshot + Tesseract for apps where UIA fails.

Captures the active window region and runs Tesseract OCR to extract text.
Used as a last resort when UI Automation returns nothing.

Windows: Uses win32gui.GetWindowRect + PIL.ImageGrab for window-region capture.
"""

import logging
from typing import List, Optional

from platform_utils import IS_WINDOWS

logger = logging.getLogger("nox.eye.ocr")

# Conditional imports
try:
    from PIL import ImageGrab
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


class OCRFallback:
    """Screenshot-based OCR using Tesseract (lightweight, CPU-only)."""

    MAX_TEXT_LENGTH = 5000

    def __init__(self, languages: Optional[List[str]] = None, gpu: bool = True):
        self.languages = languages or ["de", "en"]
        self.gpu = gpu  # Ignored — Tesseract is CPU-only, kept for compat

    @property
    def is_available(self) -> bool:
        return IS_WINDOWS and _TESSERACT_AVAILABLE and _PIL_AVAILABLE and _WIN32_AVAILABLE

    def _tess_lang(self) -> str:
        """Convert language list to Tesseract format."""
        lang_map = {"de": "deu", "en": "eng"}
        return "+".join(lang_map.get(l, l) for l in self.languages)

    def extract_text(self, hwnd: int) -> Optional[str]:
        """Screenshot the window and run OCR.

        Args:
            hwnd: Window handle to capture.

        Returns:
            Extracted text or None if OCR fails.
        """
        if IS_WINDOWS and _WIN32_AVAILABLE:
            return self._extract_text_win32(hwnd)
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
