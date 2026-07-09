"""Context storage – SQLite with FTS5 + sentence-transformers embeddings.

Stores context entries in a SQLite database with:
- Table `context_log`: structured metadata + content
- FTS5 virtual table for full-text search
- Table `context_embeddings`: vector embeddings for semantic search
- Automatic cleanup of entries older than configured TTL
"""

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("nox.eye.store")

# Conditional import for embeddings
try:
    from sentence_transformers import SentenceTransformer
    _ST_AVAILABLE = True
except ImportError:
    _ST_AVAILABLE = False

import numpy as np


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS context_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    app_name TEXT,
    window_title TEXT,
    content_type TEXT NOT NULL,    -- 'uia' | 'ocr' | 'clipboard'
    content_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_timestamp ON context_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_context_app ON context_log(app_name);

CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(
    content_text,
    content='context_log',
    content_rowid='id',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS context_ai AFTER INSERT ON context_log BEGIN
    INSERT INTO context_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;

CREATE TRIGGER IF NOT EXISTS context_ad AFTER DELETE ON context_log BEGIN
    INSERT INTO context_fts(context_fts, rowid, content_text) VALUES('delete', old.id, old.content_text);
END;

CREATE TRIGGER IF NOT EXISTS context_au AFTER UPDATE ON context_log BEGIN
    INSERT INTO context_fts(content_fts, rowid, content_text) VALUES('delete', old.id, old.content_text);
    INSERT INTO context_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;

CREATE TABLE IF NOT EXISTS context_embeddings (
    rowid INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL,
    FOREIGN KEY (rowid) REFERENCES context_log(id) ON DELETE CASCADE
);
"""


class ContextStore:
    """SQLite-based context storage with FTS5 + semantic search."""

    def __init__(
        self,
        db_path: str = "",
        embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2",
        ttl_days: int = 7,
    ):
        if db_path:
            self.db_path = db_path
        else:
            data_dir = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str(data_dir / "nox.db")

        self.embedding_model_name = embedding_model
        self.ttl_days = ttl_days
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._embedder = None

        self._init_db()

    def _init_db(self) -> None:
        """Initialize database schema."""
        with self._lock:
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.executescript(SCHEMA_SQL)
            self._conn.commit()
            logger.info("ContextStore initialized: %s", self.db_path)

    def _ensure_embedder(self) -> None:
        """Lazily load the sentence-transformers model."""
        if self._embedder is not None:
            return
        if not _ST_AVAILABLE:
            logger.warning("sentence-transformers not installed – semantic search disabled")
            return
        logger.info("Loading embedding model: %s", self.embedding_model_name)
        self._embedder = SentenceTransformer(self.embedding_model_name)
        logger.info("Embedding model loaded")

    def insert(
        self,
        app_name: str,
        window_title: str,
        content_type: str,
        content_text: str,
    ) -> int:
        """Insert a context entry and its embedding.

        Returns the row id, or -1 on failure.
        """
        if not content_text or not content_text.strip():
            return -1

        timestamp = datetime.now().isoformat()

        with self._lock:
            try:
                cursor = self._conn.execute(
                    "INSERT INTO context_log (timestamp, app_name, window_title, content_type, content_text) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (timestamp, app_name, window_title, content_type, content_text),
                )
                row_id = cursor.lastrowid
                self._conn.commit()

                # Store embedding if available
                if _ST_AVAILABLE:
                    try:
                        self._ensure_embedder()
                        if self._embedder is not None:
                            embedding = self._embedder.encode(content_text, normalize_embeddings=True)
                            emb_bytes = np.array(embedding, dtype=np.float32).tobytes()
                            self._conn.execute(
                                "INSERT INTO context_embeddings (rowid, embedding) VALUES (?, ?)",
                                (row_id, emb_bytes),
                            )
                            self._conn.commit()
                    except Exception as exc:
                        logger.debug("Failed to store embedding: %s", exc)

                logger.debug("Inserted context: id=%d, type=%s, app=%s", row_id, content_type, app_name)
                return row_id

            except Exception as exc:
                logger.error("Insert failed: %s", exc, exc_info=True)
                return -1

    def get_relevant_context(
        self,
        query: str,
        k: int = 5,
        hours: float = 24.0,
    ) -> list[dict[str, Any]]:
        """Retrieve the k most relevant context entries.

        Combines:
        - Semantic similarity (cosine via embeddings)
        - Recency weighting (newer entries score higher)
        - FTS5 keyword matching as a signal

        Args:
            query: The user's question or search query.
            k: Number of results to return.
            hours: Only consider entries within this many hours.

        Returns:
            List of dicts with keys: id, timestamp, app_name, window_title,
            content_type, content_text, score.
        """
        results: list[dict[str, Any]] = []

        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()

        with self._lock:
            # 1. Semantic search via embeddings
            if _ST_AVAILABLE and self._embedder is not None:
                results = self._semantic_search(query, k * 3, cutoff)
            else:
                # Fallback to FTS5 keyword search
                results = self._fts_search(query, k * 3, cutoff)

        # If semantic search returned nothing, try FTS
        if not results:
            with self._lock:
                results = self._fts_search(query, k * 3, cutoff)

        # Apply recency weighting and re-rank
        now = datetime.now()
        for entry in results:
            try:
                ts = datetime.fromisoformat(entry["timestamp"])
                age_hours = (now - ts).total_seconds() / 3600
                # Recency factor: 1.0 for new, decaying to 0.5 at `hours`
                recency = max(0.5, 1.0 - (age_hours / max(hours, 1)) * 0.5)
                entry["score"] = entry.get("score", 0.5) * recency
            except Exception:
                pass

        # Sort by combined score, return top k
        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        return results[:k]

    def _semantic_search(
        self, query: str, limit: int, cutoff: str
    ) -> list[dict[str, Any]]:
        """Search using cosine similarity of embeddings."""
        try:
            query_emb = self._embedder.encode(query, normalize_embeddings=True)
            query_vec = np.array(query_emb, dtype=np.float32)

            rows = self._conn.execute(
                "SELECT cl.id, cl.timestamp, cl.app_name, cl.window_title, "
                "cl.content_type, cl.content_text, ce.embedding "
                "FROM context_log cl "
                "JOIN context_embeddings ce ON cl.id = ce.rowid "
                "WHERE cl.timestamp >= ? "
                "ORDER BY cl.id DESC LIMIT 500",
                (cutoff,),
            ).fetchall()

            scored = []
            for row in rows:
                entry = {
                    "id": row[0],
                    "timestamp": row[1],
                    "app_name": row[2],
                    "window_title": row[3],
                    "content_type": row[4],
                    "content_text": row[5],
                }
                emb = np.frombuffer(row[6], dtype=np.float32)
                similarity = float(np.dot(query_vec, emb))
                entry["score"] = similarity
                scored.append(entry)

            scored.sort(key=lambda x: x["score"], reverse=True)
            return scored[:limit]

        except Exception as exc:
            logger.debug("Semantic search failed: %s", exc)
            return []

    def _fts_search(
        self, query: str, limit: int, cutoff: str
    ) -> list[dict[str, Any]]:
        """Search using FTS5 full-text matching."""
        try:
            # Escape FTS5 special characters
            safe_query = query.replace('"', '""')
            fts_query = f'"{safe_query}"'

            rows = self._conn.execute(
                "SELECT cl.id, cl.timestamp, cl.app_name, cl.window_title, "
                "cl.content_type, cl.content_text, bm25(context_fts) as rank "
                "FROM context_fts "
                "JOIN context_log cl ON cl.id = context_fts.rowid "
                "WHERE cl.timestamp >= ? AND context_fts MATCH ? "
                "ORDER BY rank ASC LIMIT ?",
                (cutoff, fts_query, limit),
            ).fetchall()

            results = []
            for row in rows:
                entry = {
                    "id": row[0],
                    "timestamp": row[1],
                    "app_name": row[2],
                    "window_title": row[3],
                    "content_type": row[4],
                    "content_text": row[5],
                    "score": max(0.0, -row[6] / 10.0),  # normalize bm25 score
                }
                results.append(entry)
            return results

        except Exception as exc:
            logger.debug("FTS search failed: %s", exc)
            return []

    def cleanup_old_entries(self) -> int:
        """Delete entries older than ttl_days. Returns count of deleted rows."""
        cutoff = (datetime.now() - timedelta(days=self.ttl_days)).isoformat()
        with self._lock:
            try:
                cursor = self._conn.execute(
                    "DELETE FROM context_log WHERE timestamp < ?", (cutoff,)
                )
                deleted = cursor.rowcount
                self._conn.commit()
                if deleted > 0:
                    logger.info("Cleaned up %d old context entries (older than %d days)", deleted, self.ttl_days)
                return deleted
            except Exception as exc:
                logger.error("Cleanup failed: %s", exc, exc_info=True)
                return 0

    def close(self) -> None:
        with self._lock:
            if self._conn:
                self._conn.close()
                self._conn = None
        logger.info("ContextStore closed")
