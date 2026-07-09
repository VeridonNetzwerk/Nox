"""Conversation store – persistent conversation history in SQLite.

Stores conversation turns per session and provides:
- Loading of recent N turns for context window management
- Automatic summarization when context window exceeds a token budget
- Session management (conversation_id)
"""

import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx

logger = logging.getLogger("nox.orchestrator.conversation")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,           -- 'system' | 'user' | 'assistant' | 'summary'
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    voice_input INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conv_id ON conversations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(conversation_id, timestamp);
"""


class ConversationStore:
    """SQLite-backed conversation history with context window management."""

    def __init__(
        self,
        db_path: str = "",
        ollama_host: str = "http://localhost:11434",
        ollama_model: str = "llama3.1",
        max_context_tokens: int = 4096,
        summary_threshold: float = 0.75,
    ):
        if db_path:
            self.db_path = db_path
        else:
            data_dir = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str(data_dir / "nox.db")

        self.ollama_host = ollama_host
        self.ollama_model = ollama_model
        self.max_context_tokens = max_context_tokens
        self.summary_threshold = summary_threshold
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.executescript(SCHEMA_SQL)
            self._conn.commit()
            logger.info("ConversationStore initialized: %s", self.db_path)

    def add_turn(
        self,
        conversation_id: str,
        role: str,
        content: str,
        token_count: int = 0,
        voice_input: bool = False,
    ) -> None:
        """Add a conversation turn to the store."""
        timestamp = datetime.now().isoformat()
        with self._lock:
            try:
                self._conn.execute(
                    "INSERT INTO conversations (conversation_id, role, content, timestamp, token_count, voice_input) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (conversation_id, role, content, timestamp, token_count, int(voice_input)),
                )
                self._conn.commit()
            except Exception as exc:
                logger.error("Failed to add turn: %s", exc, exc_info=True)

    def get_recent_turns(
        self,
        conversation_id: str,
        n: int = 10,
    ) -> list[dict[str, Any]]:
        """Get the most recent N turns for a conversation.

        Returns list of dicts: {role, content, timestamp, voice_input}
        ordered oldest-to-newest.
        """
        with self._lock:
            try:
                rows = self._conn.execute(
                    "SELECT role, content, timestamp, voice_input FROM conversations "
                    "WHERE conversation_id = ? AND role != 'summary' "
                    "ORDER BY id DESC LIMIT ?",
                    (conversation_id, n),
                ).fetchall()
                # Reverse to oldest-first
                rows = list(reversed(rows))
                return [
                    {"role": r[0], "content": r[1], "timestamp": r[2], "voice_input": bool(r[3])}
                    for r in rows
                ]
            except Exception as exc:
                logger.error("Failed to get recent turns: %s", exc, exc_info=True)
                return []

    def get_summary(self, conversation_id: str) -> Optional[str]:
        """Get the most recent summary for a conversation, if any."""
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT content FROM conversations "
                    "WHERE conversation_id = ? AND role = 'summary' "
                    "ORDER BY id DESC LIMIT 1",
                    (conversation_id,),
                ).fetchone()
                return row[0] if row else None
            except Exception:
                return None

    def get_total_tokens(self, conversation_id: str) -> int:
        """Get total token count for recent turns."""
        with self._lock:
            try:
                row = self._conn.execute(
                    "SELECT COALESCE(SUM(token_count), 0) FROM conversations "
                    "WHERE conversation_id = ? AND role != 'summary'",
                    (conversation_id,),
                ).fetchone()
                return row[0] if row else 0
            except Exception:
                return 0

    def needs_summarization(self, conversation_id: str) -> bool:
        """Check if conversation exceeds the summary threshold."""
        total = self.get_total_tokens(conversation_id)
        return total > (self.max_context_tokens * self.summary_threshold)

    async def summarize_old_turns(self, conversation_id: str) -> Optional[str]:
        """Generate an LLM summary of older turns and replace them.

        Keeps the most recent turns, summarizes everything before.
        Returns the summary text or None on failure.
        """
        turns = self.get_recent_turns(conversation_id, n=50)
        if len(turns) < 6:
            return None

        # Keep last 4 turns, summarize the rest
        to_summarize = turns[:-4]
        recent = turns[-4:]

        if not to_summarize:
            return None

        # Build summarization prompt
        history_text = "\n".join(
            f"{'Nutzer' if t['role'] == 'user' else 'Nox'}: {t['content']}"
            for t in to_summarize
        )

        prompt = (
            "Fasse das folgende Gespräch prägnant zusammen. "
            "Behalte wichtige Fakten, Entscheidungen und Kontext bei. "
            "Schreibe auf Deutsch.\n\n"
            f"Gespräch:\n{history_text}\n\n"
            "Zusammenfassung:"
        )

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self.ollama_host}/api/generate",
                    json={
                        "model": self.ollama_model,
                        "prompt": prompt,
                        "stream": False,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                summary = data.get("response", "").strip()

                if summary:
                    # Delete old turns (keep summary + recent)
                    with self._lock:
                        # Get IDs of turns to remove
                        old_ids = self._conn.execute(
                            "SELECT id FROM conversations "
                            "WHERE conversation_id = ? AND role != 'summary' "
                            "ORDER BY id DESC LIMIT 50",
                            (conversation_id,),
                        ).fetchall()
                        # Keep last 4, delete the rest
                        ids_to_delete = [r[0] for r in old_ids[4:]]
                        if ids_to_delete:
                            placeholders = ",".join("?" * len(ids_to_delete))
                            self._conn.execute(
                                f"DELETE FROM conversations WHERE id IN ({placeholders})",
                                ids_to_delete,
                            )
                            self._conn.commit()

                    # Insert summary
                    self.add_turn(conversation_id, "summary", summary, token_count=len(summary) // 4)
                    logger.info("Conversation summarized: %s", conversation_id)
                    return summary

        except Exception as exc:
            logger.error("Summarization failed: %s", exc, exc_info=True)
            return None

    def build_messages(
        self,
        conversation_id: str,
        system_prompt: str,
        new_message: str,
        context: Optional[str] = None,
        max_turns: int = 10,
    ) -> list[dict[str, str]]:
        """Build the message list for Ollama chat API.

        Structure:
        1. System prompt (persona + context)
        2. Summary (if available)
        3. Recent conversation turns
        4. New user message
        """
        messages: list[dict[str, str]] = []

        # System prompt with injected context
        sys_content = system_prompt
        if context:
            sys_content += f"\n\nRelevanter Kontext (Bildschirm/Aktivitäten):\n{context}"
        messages.append({"role": "system", "content": sys_content})

        # Summary of older conversation
        summary = self.get_summary(conversation_id)
        if summary:
            messages.append({"role": "system", "content": f"Zusammenfassung früherer Gespräche: {summary}"})

        # Recent turns
        turns = self.get_recent_turns(conversation_id, n=max_turns)
        for turn in turns:
            messages.append({"role": turn["role"], "content": turn["content"]})

        # New message
        messages.append({"role": "user", "content": new_message})

        return messages

    def close(self) -> None:
        with self._lock:
            if self._conn:
                self._conn.close()
                self._conn = None
        logger.info("ConversationStore closed")
