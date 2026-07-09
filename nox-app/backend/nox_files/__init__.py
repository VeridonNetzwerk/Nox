"""Nox Files – Local File Search Module

Provides the assistant with read-only access to local files:
1. File indexer scans configured folders (Documents, Desktop, Downloads, etc.)
2. Text extraction from txt, md, docx, pdf (text + OCR for scanned PDFs)
3. SQLite + FTS5 + embeddings for full-text and semantic search
4. Tools: dateien_suchen (search) and datei_lesen (read file content)

Read-only by design — no write, delete, or execute capabilities.
Sensitive files (passwords, credentials, keys) are always excluded.
"""

from .files_manager import FilesManager

__all__ = ["FilesManager"]
