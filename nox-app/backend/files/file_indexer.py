"""File indexer – scans configured folders and extracts text from files.

Supported formats:
- .txt, .md, .log: direct text read
- .docx: python-docx extraction
- .pdf: PyMuPDF (fitz) for text PDFs, EasyOCR fallback for scanned/image PDFs
- .csv, .json, .xml, .html, .py, .js, .ts, .java, .c, .cpp, .rs, .go, .yaml, .yml, .toml, .ini, .cfg: text read

Binary files (images, videos, audio, executables, archives) are skipped.
Password/credential files (*.kdbx, *password*, *credentials*) are always excluded.
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional, Set

logger = logging.getLogger("nox.files.indexer")

# Conditional imports for document parsing
try:
    import docx
    _DOCX_AVAILABLE = True
except ImportError:
    _DOCX_AVAILABLE = False

try:
    import fitz  # PyMuPDF
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False

try:
    import easyocr
    import numpy as np
    _EASYOCR_AVAILABLE = True
except ImportError:
    _EASYOCR_AVAILABLE = False

# Text file extensions (read directly as UTF-8)
TEXT_EXTENSIONS = {
    ".txt", ".md", ".log", ".csv", ".json", ".xml", ".html", ".htm",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h",
    ".rs", ".go", ".rb", ".php", ".sh", ".bat", ".ps1",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".tex", ".rtf", ".srt", ".vtt",
}

# Document extensions requiring special parsing
DOC_EXTENSIONS = {".docx", ".pdf"}

# All indexable extensions
INDEXABLE_EXTENSIONS = TEXT_EXTENSIONS | DOC_EXTENSIONS

# Filename patterns that indicate password/credential files — always excluded
SENSITIVE_PATTERNS = [
    "password", "credentials", "secret", "apikey", "api_key",
    "private_key", "privatekey", ".kdbx", ".key", ".pem", ".p12",
    ".pfx", ".keystore", ".wallet", "wallet.dat",
]

# Default excluded directory names (sensitive/system)
DEFAULT_EXCLUDED_DIRS = {
    ".ssh", ".gnupg", "Cookies", "cookie", "Local Storage",
    "Session Storage", "Browser Data", "Wallets", "wallet",
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "AppData", "$Recycle.Bin", "System Volume Information",
    "Windows", "Program Files", "Program Files (x86)",
}

# Max file size for indexing (50MB — larger files likely binary or huge logs)
MAX_FILE_SIZE = 50 * 1024 * 1024

# Max text extraction per file (2MB)
MAX_TEXT_LENGTH = 2_000_000


class FileIndexer:
    """Scans folders and extracts text from files for indexing."""

    def __init__(
        self,
        excluded_dirs: Optional[Set[str]] = None,
        gpu_ocr: bool = True,
    ):
        self.excluded_dirs = excluded_dirs or DEFAULT_EXCLUDED_DIRS
        self.gpu_ocr = gpu_ocr
        self._ocr_reader = None

    def should_skip_file(self, path: Path) -> bool:
        """Check if a file should be skipped (sensitive, binary, too large)."""
        name_lower = path.name.lower()

        # Always skip sensitive files
        for pattern in SENSITIVE_PATTERNS:
            if pattern in name_lower:
                return True

        # Skip if extension not indexable
        ext = path.suffix.lower()
        if ext not in INDEXABLE_EXTENSIONS:
            return True

        # Skip if too large
        try:
            size = path.stat().st_size
            if size > MAX_FILE_SIZE:
                return True
        except OSError:
            return True

        return False

    def should_skip_dir(self, path: Path) -> bool:
        """Check if a directory should be skipped."""
        name = path.name

        # Check excluded dirs
        if name in self.excluded_dirs:
            return True
        if name in DEFAULT_EXCLUDED_DIRS:
            return True

        # Check sensitive patterns in directory name
        name_lower = name.lower()
        for pattern in SENSITIVE_PATTERNS:
            if pattern in name_lower:
                return True

        # Skip hidden directories (except user home which is handled by caller)
        if name.startswith(".") and name not in {".config", ".local"}:
            return True

        return False

    def extract_text(self, path: Path) -> Optional[str]:
        """Extract text content from a file.

        Returns extracted text (truncated to MAX_TEXT_LENGTH) or None.
        """
        ext = path.suffix.lower()

        try:
            if ext in TEXT_EXTENSIONS:
                return self._extract_text_file(path)
            elif ext == ".docx":
                return self._extract_docx(path)
            elif ext == ".pdf":
                return self._extract_pdf(path)
        except Exception as exc:
            logger.debug("Extraction failed for %s: %s", path, exc)
            return None

        return None

    def _extract_text_file(self, path: Path) -> Optional[str]:
        """Read a plain text file."""
        try:
            # Try UTF-8 first, fall back to latin-1
            try:
                text = path.read_text(encoding="utf-8", errors="strict")
            except UnicodeDecodeError:
                text = path.read_text(encoding="latin-1", errors="replace")

            if len(text) > MAX_TEXT_LENGTH:
                text = text[:MAX_TEXT_LENGTH]
            return text
        except Exception as exc:
            logger.debug("Text read failed for %s: %s", path, exc)
            return None

    def _extract_docx(self, path: Path) -> Optional[str]:
        """Extract text from a .docx file using python-docx."""
        if not _DOCX_AVAILABLE:
            logger.debug("python-docx not available, skipping %s", path)
            return None

        try:
            doc = docx.Document(str(path))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n".join(paragraphs)

            if len(text) > MAX_TEXT_LENGTH:
                text = text[:MAX_TEXT_LENGTH]
            return text if text.strip() else None
        except Exception as exc:
            logger.debug("DOCX extraction failed for %s: %s", path, exc)
            return None

    def _extract_pdf(self, path: Path) -> Optional[str]:
        """Extract text from a PDF file.

        Uses PyMuPDF for text-based PDFs. Falls back to EasyOCR for
        scanned/image-only PDFs.
        """
        if not _PYMUPDF_AVAILABLE:
            logger.debug("PyMuPDF not available, skipping PDF %s", path)
            return None

        try:
            pdf = fitz.open(str(path))
            text_parts = []

            for page_num in range(len(pdf)):
                page = pdf[page_num]
                page_text = page.get_text()

                if page_text and page_text.strip():
                    text_parts.append(page_text)
                else:
                    # No text layer — try OCR on this page
                    ocr_text = self._ocr_pdf_page(page)
                    if ocr_text:
                        text_parts.append(ocr_text)

            pdf.close()

            text = "\n".join(text_parts)
            if len(text) > MAX_TEXT_LENGTH:
                text = text[:MAX_TEXT_LENGTH]
            return text if text.strip() else None

        except Exception as exc:
            logger.debug("PDF extraction failed for %s: %s", path, exc)
            return None

    def _ocr_pdf_page(self, page) -> Optional[str]:
        """OCR a single PDF page (for scanned/image PDFs)."""
        if not _EASYOCR_AVAILABLE:
            return None

        try:
            self._ensure_ocr_reader()
            if self._ocr_reader is None:
                return None

            # Render page to image at 200 DPI
            pix = page.get_pixmap(dpi=200)
            img_array = np.frombuffer(pix.samples, dtype=np.uint8)
            img_array = img_array.reshape(pix.height, pix.width, pix.n)

            # Run OCR
            results = self._ocr_reader.readtext(img_array, detail=0, paragraph=True)
            if results:
                return "\n".join(results)
            return None
        except Exception as exc:
            logger.debug("PDF OCR failed: %s", exc)
            return None

    def _ensure_ocr_reader(self):
        """Lazily initialize EasyOCR reader."""
        if self._ocr_reader is not None:
            return
        if not _EASYOCR_AVAILABLE:
            return
        logger.info("Initializing EasyOCR for PDF OCR (gpu=%s)", self.gpu_ocr)
        self._ocr_reader = easyocr.Reader(["de", "en"], gpu=self.gpu_ocr)
        logger.info("EasyOCR initialized for file indexer")

    def scan_folder(
        self,
        root: Path,
        on_file: Optional[Callable[..., Any]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> int:
        """Scan a folder tree and call on_file for each indexable file.

        Args:
            root: Root directory to scan.
            on_file: Callback(path, modified_time) called for each file to index.
            should_stop: Callback() returning True if scanning should stop.

        Returns:
            Number of files found.
        """
        count = 0

        try:
            for dirpath, dirnames, filenames in os.walk(root):
                # Check stop condition
                if should_stop and should_stop():
                    logger.info("Scan stopped for %s", root)
                    break

                # Filter directories in-place (os.walk respects this)
                dirnames[:] = [
                    d for d in dirnames
                    if not self.should_skip_dir(Path(dirpath) / d)
                ]

                for filename in filenames:
                    if should_stop and should_stop():
                        break

                    file_path = Path(dirpath) / filename

                    if self.should_skip_file(file_path):
                        continue

                    try:
                        stat = file_path.stat()
                        modified_time = datetime.fromtimestamp(stat.st_mtime).isoformat()

                        if on_file:
                            on_file(file_path, modified_time)
                        count += 1

                    except OSError:
                        continue

        except Exception as exc:
            logger.error("Scan error for %s: %s", root, exc, exc_info=True)

        logger.info("Scanned %s: %d files found", root, count)
        return count
