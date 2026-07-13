"""Files Manager – orchestrates file indexing, search, and pause/resume.

Coordinates the file indexer and file store. Runs indexing in a background
daemon thread. Provides search and file-reading methods for the tool handler.

Threading:
- Indexing: daemon thread, scans folders periodically
- Search: synchronous (called from tool handler)
- Pause: stops indexing immediately, search still works on existing index
"""

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

from .file_indexer import FileIndexer
from .file_store import FileStore

logger = logging.getLogger("nox.files.manager")

# Default scan interval (re-scan every 30 minutes)
SCAN_INTERVAL = 600  # re-scan every 10 minutes

# Default user folders to index
DEFAULT_FOLDERS = [
    "Documents", "Desktop", "Downloads",
    "Pictures", "Videos", "Music",
]


class FilesManager:
    """Orchestrates file indexing and search."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._enabled = config.get("nox_files_enabled", False)
        self._paused = False
        self._indexing = False
        self._running = False

        # Scope settings
        self._include_full_drive = config.get("nox_files_full_drive", False)
        self._custom_folders: list[str] = config.get("nox_files_custom_folders", [])
        self._excluded_dirs: set[str] = set(config.get("nox_files_excluded_dirs", []))

        # File store (separate DB from nox_eye)
        self.file_store = FileStore(
            db_path=config.get("nox_files_db_path", ""),
            embedding_model=config.get("memory_embedding_model", "paraphrase-multilingual-MiniLM-L12-v2"),
        )

        # File indexer
        self.indexer = FileIndexer(
            excluded_dirs=self._excluded_dirs,
            gpu_ocr=config.get("nox_files_ocr_gpu", config.get("nox_eye_ocr_gpu", True)),
        )

        self._index_thread: Optional[threading.Thread] = None
        self._last_index_time: Optional[float] = None
        self._file_count = 0
        self._network_drives_cache: Optional[list[Path]] = None
        self._network_drives_cache_time: float = 0

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def is_indexing(self) -> bool:
        return self._indexing

    @property
    def is_available(self) -> bool:
        return self.file_store is not None

    def _get_scan_folders(self) -> list[Path]:
        """Determine which folders to scan, prioritized for speed."""
        folders: list[Path] = []
        home = Path.home()

        if self._include_full_drive:
            # Index entire drive(s) — Windows: all drive letters
            import string
            for letter in string.ascii_uppercase:
                drive = Path(f"{letter}:\\")
                if drive.exists():
                    folders.append(drive)
        else:
            # Phase 1: High-priority user folders (Documents, Desktop, Downloads)
            priority_names = ["Documents", "Desktop", "Downloads"]
            for folder_name in priority_names:
                folder = home / folder_name
                if folder.exists():
                    folders.append(folder)

            # Phase 2: Other default user folders
            for folder_name in DEFAULT_FOLDERS:
                if folder_name in priority_names:
                    continue
                folder = home / folder_name
                if folder.exists():
                    folders.append(folder)

            # Phase 3: Custom folders
            for custom in self._custom_folders:
                p = Path(custom)
                if p.exists() and p.is_dir():
                    folders.append(p)

            # Phase 4: Network drives (NAS, UNC paths)
            folders.extend(self._detect_network_drives())

        return folders

    def _detect_network_drives(self) -> list[Path]:
        """Detect network drives — cached for 10 minutes to avoid repeated subprocess calls."""
        now = time.time()
        if self._network_drives_cache is not None and (now - self._network_drives_cache_time) < 600:
            return self._network_drives_cache

        drives: list[Path] = []
        try:
            import subprocess
            # Use 'net use' to find mapped network drives
            result = subprocess.run(
                ["net", "use"],
                capture_output=True, text=True, timeout=10,
                encoding="utf-8", errors="replace",
            )
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                # Lines with network drives look like: "Z:    \\NAS\Share"
                # or "    \\NAS\Share"
                parts = line.split()
                if len(parts) < 2:
                    continue
                # Check for drive letter (Z:) or UNC path (\\server\share)
                drive_letter = None
                unc_path = None
                for part in parts:
                    if len(part) == 2 and part[1] == ":":
                        drive_letter = part
                    elif part.startswith("\\\\"):
                        unc_path = part

                if drive_letter:
                    p = Path(f"{drive_letter}\\")
                    if p.exists():
                        drives.append(p)
                        logger.info("Found network drive: %s", p)
                elif unc_path:
                    p = Path(unc_path)
                    if p.exists():
                        drives.append(p)
                        logger.info("Found UNC network path: %s", p)
        except Exception as exc:
            logger.debug("Network drive detection failed: %s", exc)

        # Also check all drive letters for NAS-like names
        try:
            import string
            for letter in string.ascii_uppercase:
                drive_path = Path(f"{letter}:\\")
                if not drive_path.exists():
                    continue
                if drive_path in drives:
                    continue
                # Check if it's a network/removable drive by trying to read the label
                try:
                    import subprocess
                    result = subprocess.run(
                        ["fsutil", "fsinfo", "volumeinfo", f"{letter}:"],
                        capture_output=True, text=True, timeout=5,
                        encoding="utf-8", errors="replace",
                    )
                    output = result.stdout.lower()
                    # Network drives often have "remote" or specific drive types
                    if "remote" in output or "nas" in output:
                        drives.append(drive_path)
                        logger.info("Found NAS-like drive: %s", drive_path)
                except Exception:
                    pass
        except Exception:
            pass

        self._network_drives_cache = drives
        self._network_drives_cache_time = time.time()
        return drives

    def start(self) -> None:
        if not self._enabled:
            logger.info("Nox Files disabled in config")
            return
        if not self.is_available:
            logger.warning("Nox Files not available")
            return

        self._running = True
        self._index_thread = threading.Thread(
            target=self._index_loop, daemon=True, name="files-indexer"
        )
        self._index_thread.start()
        logger.info("FilesManager started")

    def stop(self) -> None:
        self._running = False
        if self._index_thread and self._index_thread.is_alive():
            self._index_thread.join(timeout=5.0)
        self._index_thread = None
        self.file_store.close()
        logger.info("FilesManager stopped")

    def pause(self) -> None:
        """Pause indexing immediately."""
        self._paused = True
        logger.info("FilesManager paused – indexing stopped")

    def resume(self) -> None:
        """Resume indexing."""
        self._paused = False
        logger.info("FilesManager resumed – indexing active")

    def trigger_reindex(self) -> None:
        """Trigger an immediate re-index (e.g. after settings change)."""
        threading.Thread(
            target=self._do_index, daemon=True, name="files-reindex"
        ).start()

    def _index_loop(self) -> None:
        """Periodic indexing loop."""
        while self._running:
            if not self._paused:
                self._do_index()
            time.sleep(SCAN_INTERVAL)

    def _do_index(self) -> None:
        """Run a two-phase indexing pass.

        Phase 1 (fast): Scan all folders and index filenames/metadata only.
                        This makes files searchable by name immediately.
        Phase 2 (background): Extract text content and update entries.
                              Files become full-text searchable.
        """
        if self._indexing:
            logger.debug("Indexing already in progress, skipping")
            return

        self._indexing = True
        try:
            folders = self._get_scan_folders()

            # --- Phase 1: Fast filename scan ---
            phase1_count = 0
            pending_files: list[tuple[Path, str, int]] = []  # (path, modified_time, size)

            for folder in folders:
                if not self._running or self._paused:
                    break

                logger.info("Phase 1 scanning: %s", folder)

                def on_file_fast(path: Path, modified_time: str):
                    nonlocal phase1_count
                    if not self._running or self._paused:
                        return

                    # Check if re-index needed
                    if not self.file_store.needs_reindex(str(path), modified_time):
                        return

                    try:
                        size = path.stat().st_size if path.exists() else 0
                    except OSError:
                        size = 0

                    # Fast insert: filename only, empty content for now
                    self.file_store.upsert_file_meta(
                        file_path=str(path),
                        file_name=path.name,
                        file_ext=path.suffix.lower(),
                        file_size=size,
                        modified_time=modified_time,
                    )
                    pending_files.append((path, modified_time, size))
                    phase1_count += 1

                self.indexer.scan_folder(
                    root=folder,
                    on_file=on_file_fast,
                    should_stop=lambda: (not self._running) or self._paused,
                )

            logger.info("Phase 1 complete: %d files indexed by name", phase1_count)

            # --- Phase 2: Content extraction (background) ---
            phase2_count = 0
            for path, modified_time, size in pending_files:
                if not self._running or self._paused:
                    break

                try:
                    content = self.indexer.extract_text(path)
                    if content and content.strip():
                        self.file_store.upsert_file(
                            file_path=str(path),
                            file_name=path.name,
                            file_ext=path.suffix.lower(),
                            file_size=size,
                            modified_time=modified_time,
                            content_text=content,
                        )
                        phase2_count += 1
                except Exception as exc:
                    logger.debug("Content extraction failed for %s: %s", path, exc)

            self._file_count = phase1_count
            self._last_index_time = time.time()
            logger.info("Phase 2 complete: %d files with content. Total indexed: %d",
                        phase2_count, phase1_count)

        except Exception as exc:
            logger.error("Indexing error: %s", exc, exc_info=True)
        finally:
            self._indexing = False

    def search(
        self,
        query: str,
        k: int = 10,
        folder: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Search indexed files.

        Args:
            query: Search query.
            k: Max results.
            folder: Optional path prefix to restrict search.

        Returns:
            List of dicts with file_path, file_name, file_ext, snippet, score.
        """
        results = self.file_store.search(query, k=k, folder_filter=folder)

        # Build snippets for display
        for entry in results:
            text = entry.get("content_text", "")
            if not text or not text.strip():
                # Phase 1 file — no content extracted yet, use filename as snippet
                entry["snippet"] = f"[Dateiname: {entry.get('file_name', '')}]"
            elif len(text) > 300:
                # Find query-relevant snippet
                query_lower = query.lower()
                text_lower = text.lower()
                pos = text_lower.find(query_lower)
                if pos >= 0:
                    start = max(0, pos - 100)
                    end = min(len(text), pos + 200)
                    entry["snippet"] = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
                else:
                    entry["snippet"] = text[:300] + "..."
            else:
                entry["snippet"] = text

        return results

    def read_file(self, file_path: str, max_length: int = 100_000) -> Optional[str]:
        """Read the content of a specific file from the index.

        Args:
            file_path: Absolute path to the file.
            max_length: Maximum characters to return.

        Returns:
            File content string, or None if not found.
        """
        # Try from index first
        content = self.file_store.get_file_content(file_path)
        if content:
            if len(content) > max_length:
                return content[:max_length] + "\n\n[... gekürzt ...]"
            return content

        # If not in index, try direct read for text files
        from .file_indexer import INDEXABLE_EXTENSIONS
        path = Path(file_path)
        if path.exists() and path.suffix.lower() in INDEXABLE_EXTENSIONS:
            if not self.indexer.should_skip_file(path):
                content = self.indexer.extract_text(path)
                if content:
                    if len(content) > max_length:
                        return content[:max_length] + "\n\n[... gekürzt ...]"
                    return content

        return None

    def update_settings(self, updates: dict[str, Any]) -> None:
        """Apply settings changes at runtime."""
        if "nox_files_enabled" in updates:
            self._enabled = updates["nox_files_enabled"]
            if self._enabled and not self._running:
                self.start()
            elif not self._enabled and self._running:
                self.stop()

        if "nox_files_full_drive" in updates:
            self._include_full_drive = updates["nox_files_full_drive"]

        if "nox_files_custom_folders" in updates:
            self._custom_folders = updates["nox_files_custom_folders"]

        if "nox_files_excluded_dirs" in updates:
            self._excluded_dirs = set(updates["nox_files_excluded_dirs"])
            self.indexer.excluded_dirs = self._excluded_dirs

    def health(self) -> dict[str, Any]:
        """Return health status."""
        stats = self.file_store.get_stats() if self.file_store else {}
        return {
            "enabled": self._enabled,
            "paused": self._paused,
            "indexing": self._indexing,
            "available": self.is_available,
            "last_index_time": self._last_index_time,
            "files_indexed": stats.get("total_files", 0),
            "by_extension": stats.get("by_extension", []),
            "scan_folders": [str(f) for f in self._get_scan_folders()],
            "full_drive": self._include_full_drive,
        }
