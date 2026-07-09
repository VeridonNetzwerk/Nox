"""OCR fallback – screenshot + EasyOCR (GPU) for apps where UIA fails.

Captures the active window region and runs EasyOCR with GPU support
to extract text. Used as a last resort when UI Automation returns nothing.
"""

import logging
from typing import List, Optional

logger = logging.getLogger("nox.eye.ocr")

# Conditional imports
try:
    import numpy as np
    from PIL import ImageGrab
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

try:
    import easyocr
    _EASYOCR_AVAILABLE = True
except ImportError:
    _EASYOCR_AVAILABLE = False

try:
    import win32gui
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False


class OCRFallback:
    """Screenshot-based OCR using EasyOCR with GPU support."""

    MAX_TEXT_LENGTH = 5000

    def __init__(self, languages: Optional[List[str]] = None, gpu: bool = True):
        self.languages = languages or ["de", "en"]
        self.gpu = gpu
        self._reader = None

    @property
    def is_available(self) -> bool:
        return _EASYOCR_AVAILABLE and _PIL_AVAILABLE

    def _ensure_reader(self):
        """Lazily initialize EasyOCR reader (slow first load)."""
        if self._reader is not None:
            return
        logger.info("Initializing EasyOCR (gpu=%s, langs=%s)", self.gpu, self.languages)
        self._reader = easyocr.Reader(self.languages, gpu=self.gpu)
        logger.info("EasyOCR initialized")

    def extract_text(self, hwnd: int) -> Optional[str]:
        """Screenshot the window and run OCR.

        Args:
            hwnd: Window handle to capture.

        Returns:
            Extracted text or None if OCR fails.
        """
        if not self.is_available or not _WIN32_AVAILABLE:
            return None

        try:
            # Get window bounding rect
            rect = win32gui.GetWindowRect(hwnd)
            # rect = (left, top, right, bottom)

            # Capture screenshot of window region
            img = ImageGrab.grab(bbox=rect)
            img_array = np.array(img)

            # Run OCR
            self._ensure_reader()
            results = self._reader.readtext(img_array, detail=0, paragraph=True)

            if not results:
                return None

            text = "\n".join(results)
            if len(text) > self.MAX_TEXT_LENGTH:
                text = text[:self.MAX_TEXT_LENGTH] + "..."
            return text

        except Exception as exc:
            logger.debug("OCR fallback failed for hwnd=%s: %s", hwnd, exc)
            return None
