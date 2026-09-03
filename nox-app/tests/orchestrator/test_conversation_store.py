"""Tests for the ConversationStore – SQLite-backed conversation history.

Tests cover:
- Database initialization
- Adding and retrieving conversation turns
- Summary generation and retrieval
- Token counting and summarization threshold
- Message building for LLM API
- Conversation session management
"""

import os
import tempfile
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from orchestrator.conversation_store import ConversationStore


@pytest.fixture
def store(tmp_path):
    """Create a ConversationStore with a temporary database."""
    db_path = str(tmp_path / "test_nox.db")
    return ConversationStore(
        db_path=db_path,
        ollama_host="http://localhost:11434",
        ollama_model="qwen3:14b",
        max_context_tokens=4096,
        summary_threshold=0.75,
    )


class TestConversationStoreInit:
    """Test database initialization."""

    def test_init_creates_database_file(self, tmp_path):
        db_path = str(tmp_path / "test_nox.db")
        store = ConversationStore(db_path=db_path)
        assert os.path.exists(db_path)

    def test_init_creates_tables(self, store):
        # Verify tables exist by inserting and querying
        store.add_turn("test-conv", "user", "hello")
        turns = store.get_recent_turns("test-conv")
        assert len(turns) == 1

    def test_init_default_db_path(self):
        # When no path is provided, should use APPDATA or home dir
        store = ConversationStore(db_path="")
        assert store.db_path.endswith("nox.db")


class TestAddAndGetTurns:
    """Test adding and retrieving conversation turns."""

    def test_add_single_turn(self, store):
        store.add_turn("conv1", "user", "Hello Nox")
        turns = store.get_recent_turns("conv1", n=10)
        assert len(turns) == 1
        assert turns[0]["role"] == "user"
        assert turns[0]["content"] == "Hello Nox"

    def test_add_multiple_turns(self, store):
        store.add_turn("conv1", "user", "Hello")
        store.add_turn("conv1", "assistant", "Hi there!")
        store.add_turn("conv1", "user", "How are you?")
        turns = store.get_recent_turns("conv1", n=10)
        assert len(turns) == 3
        assert turns[0]["role"] == "user"
        assert turns[1]["role"] == "assistant"
        assert turns[2]["role"] == "user"

    def test_get_recent_turns_limits_n(self, store):
        for i in range(5):
            store.add_turn("conv1", "user", f"message {i}")
        turns = store.get_recent_turns("conv1", n=3)
        assert len(turns) == 3
        # Should be the most recent 3, in oldest-first order
        assert turns[0]["content"] == "message 2"
        assert turns[2]["content"] == "message 4"

    def test_get_recent_turns_empty_conversation(self, store):
        turns = store.get_recent_turns("nonexistent", n=10)
        assert turns == []

    def test_separate_conversations(self, store):
        store.add_turn("conv1", "user", "hello from conv1")
        store.add_turn("conv2", "user", "hello from conv2")
        turns1 = store.get_recent_turns("conv1")
        turns2 = store.get_recent_turns("conv2")
        assert len(turns1) == 1
        assert turns1[0]["content"] == "hello from conv1"
        assert len(turns2) == 1
        assert turns2[0]["content"] == "hello from conv2"

    def test_voice_input_flag(self, store):
        store.add_turn("conv1", "user", "hello", voice_input=True)
        turns = store.get_recent_turns("conv1")
        assert turns[0]["voice_input"] is True

    def test_voice_input_default_false(self, store):
        store.add_turn("conv1", "user", "hello")
        turns = store.get_recent_turns("conv1")
        assert turns[0]["voice_input"] is False

    def test_turns_ordered_oldest_first(self, store):
        store.add_turn("conv1", "user", "first")
        store.add_turn("conv1", "assistant", "second")
        store.add_turn("conv1", "user", "third")
        turns = store.get_recent_turns("conv1", n=10)
        assert turns[0]["content"] == "first"
        assert turns[1]["content"] == "second"
        assert turns[2]["content"] == "third"


class TestSummary:
    """Test summary storage and retrieval."""

    def test_get_summary_none_when_no_summary(self, store):
        assert store.get_summary("conv1") is None

    def test_add_and_get_summary(self, store):
        store.add_turn("conv1", "summary", "This is a summary of the conversation.")
        summary = store.get_summary("conv1")
        assert summary == "This is a summary of the conversation."

    def test_get_latest_summary(self, store):
        store.add_turn("conv1", "summary", "First summary")
        store.add_turn("conv1", "summary", "Second summary")
        summary = store.get_summary("conv1")
        assert summary == "Second summary"

    def test_summary_not_in_recent_turns(self, store):
        store.add_turn("conv1", "summary", "A summary")
        store.add_turn("conv1", "user", "hello")
        turns = store.get_recent_turns("conv1")
        assert len(turns) == 1
        assert turns[0]["role"] == "user"


class TestTokenCounting:
    """Test token counting and summarization threshold."""

    def test_get_total_tokens_empty(self, store):
        assert store.get_total_tokens("conv1") == 0

    def test_get_total_tokens_with_turns(self, store):
        store.add_turn("conv1", "user", "hello", token_count=10)
        store.add_turn("conv1", "assistant", "hi", token_count=5)
        assert store.get_total_tokens("conv1") == 15

    def test_needs_summarization_false_when_under_threshold(self, store):
        store.add_turn("conv1", "user", "hello", token_count=100)
        assert store.needs_summarization("conv1") is False

    def test_needs_summarization_true_when_over_threshold(self, store):
        # threshold = 4096 * 0.75 = 3072
        store.add_turn("conv1", "user", "hello", token_count=4000)
        assert store.needs_summarization("conv1") is True

    def test_needs_summarization_at_exact_threshold(self, store):
        # threshold = 3072
        store.add_turn("conv1", "user", "hello", token_count=3072)
        # > not >=, so exactly at threshold should be False
        assert store.needs_summarization("conv1") is False


class TestBuildMessages:
    """Test building messages for the LLM API."""

    def test_build_messages_basic(self, store):
        messages = store.build_messages(
            conversation_id="conv1",
            system_prompt="You are Nox.",
            new_message="Hello",
        )
        # Should have system prompt + user message
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are Nox."
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Hello"

    def test_build_messages_with_context(self, store):
        messages = store.build_messages(
            conversation_id="conv1",
            system_prompt="You are Nox.",
            new_message="Hello",
            context="User is browsing the web.",
        )
        assert "User is browsing the web." in messages[0]["content"]

    def test_build_messages_with_history(self, store):
        store.add_turn("conv1", "user", "previous question")
        store.add_turn("conv1", "assistant", "previous answer")
        messages = store.build_messages(
            conversation_id="conv1",
            system_prompt="You are Nox.",
            new_message="new question",
        )
        # system + history (2 turns) + new message
        assert len(messages) == 4
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "previous question"
        assert messages[2]["role"] == "assistant"
        assert messages[2]["content"] == "previous answer"
        assert messages[3]["role"] == "user"
        assert messages[3]["content"] == "new question"

    def test_build_messages_with_summary(self, store):
        store.add_turn("conv1", "summary", "Earlier we discussed Python.")
        store.add_turn("conv1", "user", "hello")
        messages = store.build_messages(
            conversation_id="conv1",
            system_prompt="You are Nox.",
            new_message="Tell me more",
        )
        # system + summary system + history user + new message
        assert len(messages) == 4
        assert messages[1]["role"] == "system"
        assert "Earlier we discussed Python." in messages[1]["content"]

    def test_build_messages_respects_max_turns(self, store):
        for i in range(10):
            store.add_turn("conv1", "user", f"msg {i}")
            store.add_turn("conv1", "assistant", f"resp {i}")
        messages = store.build_messages(
            conversation_id="conv1",
            system_prompt="You are Nox.",
            new_message="latest",
            max_turns=4,
        )
        # system + 4 history turns + new message
        assert len(messages) == 6


class TestClose:
    """Test cleanup."""

    def test_close_sets_conn_to_none(self, store):
        store.close()
        assert store._conn is None

    def test_close_idempotent(self, store):
        store.close()
        store.close()  # Should not raise
        assert store._conn is None
