"""File storage – SQLite with FTS5 + sentence-transformers embeddings.

Stores indexed file contents in a SQLite database with:
- Table `file_index`: file path, name, extension, size, modified date, content
- FTS5 virtual table for full-text search
- Table `file_embeddings`: vector embeddings for semantic search
- Automatic re-indexing when file modification time changes
"""

import logging
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("nox.files.store")

try:
    from sentence_transformers import SentenceTransformer
    _ST_AVAILABLE = True
except ImportError:
    _ST_AVAILABLE = False

import numpy as np


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS file_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_ext TEXT,
    file_size INTEGER,
    modified_time TEXT,
    indexed_time TEXT NOT NULL,
    content_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_path ON file_index(file_path);
CREATE INDEX IF NOT EXISTS idx_file_name ON file_index(file_name);
CREATE INDEX IF NOT EXISTS idx_file_ext ON file_index(file_ext);

CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
    content_text,
    content='file_index',
    content_rowid='id',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS file_ai AFTER INSERT ON file_index BEGIN
    INSERT INTO file_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;

CREATE TRIGGER IF NOT EXISTS file_ad AFTER DELETE ON file_index BEGIN
    INSERT INTO file_fts(file_fts, rowid, content_text) VALUES('delete', old.id, old.content_text);
END;

CREATE TRIGGER IF NOT EXISTS file_au AFTER UPDATE ON file_index BEGIN
    INSERT INTO file_fts(file_fts, rowid, content_text) VALUES('delete', old.id, old.content_text);
    INSERT INTO file_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;

CREATE TABLE IF NOT EXISTS file_embeddings (
    rowid INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL,
    FOREIGN KEY (rowid) REFERENCES file_index(id) ON DELETE CASCADE
);
"""


class FileStore:
    """SQLite-based file content storage with FTS5 + semantic search."""

    MAX_TEXT_LENGTH = 2_000_000  # 2MB text limit per file

    def __init__(
        self,
        db_path: str = "",
        embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2",
    ):
        if db_path:
            self.db_path = db_path
        else:
            data_dir = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str(data_dir / "nox_files.db")

        self.embedding_model_name = embedding_model
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._embedder = None

        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.executescript(SCHEMA_SQL)
            self._conn.commit()
            logger.info("FileStore initialized: %s", self.db_path)

    def _ensure_embedder(self) -> None:
        if self._embedder is not None:
            return
        if not _ST_AVAILABLE:
            logger.warning("sentence-transformers not installed – semantic search disabled")
            return
        logger.info("Loading embedding model: %s", self.embedding_model_name)
        self._embedder = SentenceTransformer(self.embedding_model_name)
        logger.info("Embedding model loaded")

    def upsert_file(
        self,
        file_path: str,
        file_name: str,
        file_ext: str,
        file_size: int,
        modified_time: str,
        content_text: str,
    ) -> int:
        """Insert or update a file entry. Returns row id, or -1 on failure."""
        if not content_text or not content_text.strip():
            return -1

        if len(content_text) > self.MAX_TEXT_LENGTH:
            content_text = content_text[:self.MAX_TEXT_LENGTH]

        indexed_time = datetime.now().isoformat()

        with self._lock:
            try:
                # Check if file already exists
                existing = self._conn.execute(
                    "SELECT id FROM file_index WHERE file_path = ?", (file_path,)
                ).fetchone()

                if existing:
                    row_id = existing[0]
                    self._conn.execute(
                        "UPDATE file_index SET file_name=?, file_ext=?, file_size=?, "
                        "modified_time=?, indexed_time=?, content_text=? WHERE id=?",
                        (file_name, file_ext, file_size, modified_time, indexed_time, content_text, row_id),
                    )
                else:
                    cursor = self._conn.execute(
                        "INSERT INTO file_index (file_path, file_name, file_ext, file_size, "
                        "modified_time, indexed_time, content_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (file_path, file_name, file_ext, file_size, modified_time, indexed_time, content_text),
                    )
                    row_id = cursor.lastrowid

                self._conn.commit()

                # Update embedding
                if _ST_AVAILABLE:
                    try:
                        self._ensure_embedder()
                        if self._embedder is not None:
                            embedding = self._embedder.encode(content_text, normalize_embeddings=True)
                            emb_bytes = np.array(embedding, dtype=np.float32).tobytes()
                            self._conn.execute(
                                "INSERT OR REPLACE INTO file_embeddings (rowid, embedding) VALUES (?, ?)",
                                (row_id, emb_bytes),
                            )
                            self._conn.commit()
                    except Exception as exc:
                        logger.debug("Failed to store embedding: %s", exc)

                logger.debug("Indexed file: id=%d, path=%s", row_id, file_path)
                return row_id

            except Exception as exc:
                logger.error("Upsert failed for %s: %s", file_path, exc, exc_info=True)
                return -1

    def upsert_file_meta(
        self,
        file_path: str,
        file_name: str,
        file_ext: str,
        file_size: int,
        modified_time: str,
    ) -> int:
        """Fast insert/update: filename and metadata only, no content extraction.

        Used in Phase 1 of two-phase indexing. Stores empty content_text
        so the file is searchable by filename via FTS immediately.
        Returns row id, or -1 on failure.
        """
        indexed_time = datetime.now().isoformat()

        with self._lock:
            try:
                existing = self._conn.execute(
                    "SELECT id, content_text FROM file_index WHERE file_path = ?", (file_path,)
                ).fetchone()

                if existing:
                    row_id = existing[0]
                    # Only update meta if content hasn't been extracted yet
                    # (avoid overwriting full content with empty placeholder)
                    if existing[1] and existing[1].strip():
                        # Content already extracted — just update meta
                        self._conn.execute(
                            "UPDATE file_index SET file_name=?, file_ext=?, file_size=?, "
                            "modified_time=? WHERE id=?",
                            (file_name, file_ext, file_size, modified_time, row_id),
                        )
                    else:
                        # No content yet — update with empty placeholder
                        self._conn.execute(
                            "UPDATE file_index SET file_name=?, file_ext=?, file_size=?, "
                            "modified_time=?, indexed_time=?, content_text=? WHERE id=?",
                            (file_name, file_ext, file_size, modified_time, indexed_time, "", row_id),
                        )
                else:
                    cursor = self._conn.execute(
                        "INSERT INTO file_index (file_path, file_name, file_ext, file_size, "
                        "modified_time, indexed_time, content_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (file_path, file_name, file_ext, file_size, modified_time, indexed_time, ""),
                    )
                    row_id = cursor.lastrowid

                self._conn.commit()
                return row_id

            except Exception as exc:
                logger.error("upsert_file_meta failed for %s: %s", file_path, exc)
                return -1

    def needs_reindex(self, file_path: str, modified_time: str) -> bool:
        """Check if a file needs re-indexing (new or modified)."""
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT modified_time FROM file_index WHERE file_path = ?", (file_path,)
                ).fetchone()
                if row is None:
                    return True
                return row[0] != modified_time
            except Exception:
                return True

    def remove_file(self, file_path: str) -> bool:
        """Remove a file from the index."""
        with self._lock:
            try:
                self._conn.execute("DELETE FROM file_index WHERE file_path = ?", (file_path,))
                self._conn.commit()
                return True
            except Exception as exc:
                logger.error("Remove failed for %s: %s", file_path, exc)
                return False

    def remove_prefix(self, prefix: str) -> int:
        """Remove all files under a given path prefix (e.g. deleted folder)."""
        with self._lock:
            try:
                cursor = self._conn.execute(
                    "DELETE FROM file_index WHERE file_path LIKE ?", (prefix + "%",)
                )
                deleted = cursor.rowcount
                self._conn.commit()
                if deleted > 0:
                    logger.info("Removed %d files under %s", deleted, prefix)
                return deleted
            except Exception as exc:
                logger.error("Remove prefix failed: %s", exc)
                return 0

    def search(
        self,
        query: str,
        k: int = 10,
        folder_filter: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Search indexed files by query.

        Combines semantic similarity, FTS5 keyword matching, and filename search.
        Files indexed in Phase 1 (filename only, no content) are still searchable
        by filename via LIKE matching.

        Args:
            query: Search query.
            k: Number of results.
            folder_filter: Optional path prefix to restrict search scope.

        Returns:
            List of dicts with keys: id, file_path, file_name, file_ext,
            content_text (snippet), score.
        """
        results: list[dict[str, Any]] = []

        with self._lock:
            if _ST_AVAILABLE:
                self._ensure_embedder()
                if self._embedder is not None:
                    results = self._semantic_search(query, k * 3, folder_filter)
                else:
                    results = self._fts_search(query, k * 3, folder_filter)
            else:
                results = self._fts_search(query, k * 3, folder_filter)

        if not results:
            with self._lock:
                results = self._fts_search(query, k * 3, folder_filter)

        # Always also search by filename (catches Phase 1 files without content)
        with self._lock:
            fname_results = self._filename_search(query, k * 3, folder_filter)

        # Merge: add filename results that aren't already in results
        existing_ids = {r.get("id") for r in results}
        for r in fname_results:
            if r.get("id") not in existing_ids:
                results.append(r)

        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        return results[:k]

    def _semantic_search(
        self, query: str, limit: int, folder_filter: Optional[str]
    ) -> list[dict[str, Any]]:
        try:
            query_emb = self._embedder.encode(query, normalize_embeddings=True)
            query_vec = np.array(query_emb, dtype=np.float32)

            if folder_filter:
                rows = self._conn.execute(
                    "SELECT fi.id, fi.file_path, fi.file_name, fi.file_ext, "
                    "fi.content_text, fe.embedding "
                    "FROM file_index fi "
                    "JOIN file_embeddings fe ON fi.id = fe.rowid "
                    "WHERE fi.file_path LIKE ? "
                    "ORDER BY fi.id DESC LIMIT 1000",
                    (folder_filter + "%",),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT fi.id, fi.file_path, fi.file_name, fi.file_ext, "
                    "fi.content_text, fe.embedding "
                    "FROM file_index fi "
                    "JOIN file_embeddings fe ON fi.id = fe.rowid "
                    "ORDER BY fi.id DESC LIMIT 1000",
                ).fetchall()

            scored = []
            for row in rows:
                entry = {
                    "id": row[0],
                    "file_path": row[1],
                    "file_name": row[2],
                    "file_ext": row[3],
                    "content_text": row[4],
                }
                emb = np.frombuffer(row[5], dtype=np.float32)
                similarity = float(np.dot(query_vec, emb))
                entry["score"] = similarity
                scored.append(entry)

            scored.sort(key=lambda x: x["score"], reverse=True)
            return scored[:limit]

        except Exception as exc:
            logger.debug("Semantic search failed: %s", exc)
            return []

    def _fts_search(
        self, query: str, limit: int, folder_filter: Optional[str]
    ) -> list[dict[str, Any]]:
        try:
            safe_query = query.replace('"', '""')
            fts_query = f'"{safe_query}"'

            if folder_filter:
                rows = self._conn.execute(
                    "SELECT fi.id, fi.file_path, fi.file_name, fi.file_ext, "
                    "fi.content_text, bm25(file_fts) as rank "
                    "FROM file_fts "
                    "JOIN file_index fi ON fi.id = file_fts.rowid "
                    "WHERE fi.file_path LIKE ? AND file_fts MATCH ? "
                    "ORDER BY rank ASC LIMIT ?",
                    (folder_filter + "%", fts_query, limit),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT fi.id, fi.file_path, fi.file_name, fi.file_ext, "
                    "fi.content_text, bm25(file_fts) as rank "
                    "FROM file_fts "
                    "JOIN file_index fi ON fi.id = file_fts.rowid "
                    "WHERE file_fts MATCH ? "
                    "ORDER BY rank ASC LIMIT ?",
                    (fts_query, limit),
                ).fetchall()

            results = []
            for row in rows:
                entry = {
                    "id": row[0],
                    "file_path": row[1],
                    "file_name": row[2],
                    "file_ext": row[3],
                    "content_text": row[4],
                    "score": max(0.0, -row[5] / 10.0),
                }
                results.append(entry)
            return results

        except Exception as exc:
            logger.debug("FTS search failed: %s", exc)
            return []

    def _filename_search(
        self, query: str, limit: int, folder_filter: Optional[str]
    ) -> list[dict[str, Any]]:
        """Search by filename — catches Phase 1 files (no content extracted yet)."""
        try:
            safe_query = f"%{query.replace('%', '\\%').replace('_', '\\_')}%"
            if folder_filter:
                rows = self._conn.execute(
                    "SELECT id, file_path, file_name, file_ext, content_text "
                    "FROM file_index "
                    "WHERE file_path LIKE ? AND (file_name LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\') "
                    "ORDER BY modified_time DESC LIMIT ?",
                    (folder_filter + "%", safe_query, safe_query, limit),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT id, file_path, file_name, file_ext, content_text "
                    "FROM file_index "
                    "WHERE file_name LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' "
                    "ORDER BY modified_time DESC LIMIT ?",
                    (safe_query, safe_query, limit),
                ).fetchall()

            results = []
            for row in rows:
                entry = {
                    "id": row[0],
                    "file_path": row[1],
                    "file_name": row[2],
                    "file_ext": row[3],
                    "content_text": row[4],
                    "score": 0.5,  # lower score than semantic/FTS matches
                }
                results.append(entry)
            return results

        except Exception as exc:
            logger.debug("Filename search failed: %s", exc)
            return []

    def get_file_content(self, file_path: str) -> Optional[str]:
        """Retrieve the full stored content of a specific file."""
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT content_text FROM file_index WHERE file_path = ?", (file_path,)
                ).fetchone()
                return row[0] if row else None
            except Exception as exc:
                logger.error("Get content failed: %s", exc)
                return None

    def get_stats(self) -> dict[str, Any]:
        """Return index statistics."""
        with self._lock:
            try:
                total = self._conn.execute("SELECT COUNT(*) FROM file_index").fetchone()[0]
                by_ext = self._conn.execute(
                    "SELECT file_ext, COUNT(*) as cnt FROM file_index "
                    "GROUP BY file_ext ORDER BY cnt DESC LIMIT 10"
                ).fetchall()
                return {
                    "total_files": total,
                    "by_extension": [{"ext": r[0] or "(none)", "count": r[1]} for r in by_ext],
                }
            except Exception as exc:
                logger.error("Stats failed: %s", exc)
                return {"total_files": 0, "by_extension": []}

    def close(self) -> None:
        with self._lock:
            if self._conn:
                self._conn.close()
                self._conn = None
        logger.info("FileStore closed")
