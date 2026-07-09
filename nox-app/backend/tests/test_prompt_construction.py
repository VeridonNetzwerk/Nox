"""Unit tests for prompt construction logic.

Tests system_prompt.build_system_prompt() and
ConversationStore.build_messages() assembly.
"""

import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch
from typing import Any

import pytest
import yaml

# We can import system_prompt directly since it has no heavy deps
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from orchestrator.system_prompt import build_system_prompt
from orchestrator.conversation_store import ConversationStore


# ---------------------------------------------------------------------------
# System prompt tests
# ---------------------------------------------------------------------------

class TestSystemPrompt:
    def test_base_persona_present(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        assert "Nox" in prompt
        assert "lokal" in prompt.lower() or "local" in prompt.lower()
        assert "Deutsch" in prompt or "deutsch" in prompt.lower()

    def test_text_mode_directive(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        assert "Markdown" in prompt
        assert "TEXT" in prompt

    def test_voice_mode_directive(self):
        prompt = build_system_prompt(voice_mode=True, tools_enabled=False)
        assert "SPRACHE" in prompt
        assert "Markdown" not in prompt.split("SPRACHE")[1].split("Aktuelle")[0]
        assert "kurzen" in prompt or "kurz" in prompt

    def test_tools_directive_present_when_enabled(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=True)
        assert "TOOL" in prompt
        assert "kontext_suche" in prompt
        assert "notiz_speichern" in prompt
        assert "aktuelle_uhrzeit" in prompt

    def test_tools_directive_absent_when_disabled(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        assert "kontext_suche" not in prompt

    def test_current_time_included(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        assert "Aktuelle Zeit" in prompt
        # Should contain a year
        assert str(datetime.now().year) in prompt

    def test_voice_mode_no_markmark_in_output_directive(self):
        """Voice mode should explicitly forbid Markdown."""
        prompt = build_system_prompt(voice_mode=True, tools_enabled=False)
        voice_section = prompt.split("SPRACHE")[1].split("Aktuelle")[0]
        assert "KEIN Markdown" in voice_section or "kein Markdown" in voice_section


# ---------------------------------------------------------------------------
# Conversation store / message assembly tests
# ---------------------------------------------------------------------------

class TestConversationStore:
    @pytest.fixture
    def store(self, tmp_path):
        """Create a ConversationStore with a temp DB."""
        db_path = str(tmp_path / "test.db")
        s = ConversationStore(
            db_path=db_path,
            ollama_host="http://localhost:11434",
            ollama_model="llama3.1",
        )
        yield s
        s.close()

    def test_add_and_retrieve_turn(self, store):
        conv_id = "test-conv-1"
        store.add_turn(conv_id, "user", "Hallo", token_count=10)
        store.add_turn(conv_id, "assistant", "Hi!", token_count=5)

        turns = store.get_recent_turns(conv_id, n=10)
        assert len(turns) == 2
        assert turns[0]["role"] == "user"
        assert turns[0]["content"] == "Hallo"
        assert turns[1]["role"] == "assistant"
        assert turns[1]["content"] == "Hi!"

    def test_recent_turns_limit(self, store):
        conv_id = "test-conv-2"
        for i in range(15):
            store.add_turn(conv_id, "user", f"Message {i}", token_count=5)
            store.add_turn(conv_id, "assistant", f"Reply {i}", token_count=5)

        turns = store.get_recent_turns(conv_id, n=4)
        assert len(turns) == 4
        # Should be the most recent 4 (oldest-first)
        assert "Message 13" in turns[0]["content"] or "Reply 12" in turns[0]["content"]

    def test_build_messages_structure(self, store):
        conv_id = "test-conv-3"
        store.add_turn(conv_id, "user", "Was ist Python?", token_count=10)
        store.add_turn(conv_id, "assistant", "Eine Programmiersprache.", token_count=10)

        system_prompt = "Du bist Nox."
        messages = store.build_messages(
            conversation_id=conv_id,
            system_prompt=system_prompt,
            new_message="Erzähl mir mehr",
            context="Kontext: vscode offen",
            max_turns=10,
        )

        # First message should be system
        assert messages[0]["role"] == "system"
        assert "Nox" in messages[0]["content"]
        # Context should be in system prompt
        assert "Kontext" in messages[0]["content"]

        # Last message should be the new user message
        assert messages[-1]["role"] == "user"
        assert messages[-1]["content"] == "Erzähl mir mehr"

        # Should contain history turns
        roles = [m["role"] for m in messages]
        assert "user" in roles
        assert "assistant" in roles

    def test_build_messages_with_summary(self, store):
        conv_id = "test-conv-4"
        store.add_turn(conv_id, "summary", "Früher Gespräch über Python.", token_count=20)
        store.add_turn(conv_id, "user", "Was ist Java?", token_count=10)
        store.add_turn(conv_id, "assistant", "Auch eine Sprache.", token_count=10)

        messages = store.build_messages(
            conversation_id=conv_id,
            system_prompt="System",
            new_message="Vergleich sie",
            max_turns=10,
        )

        # Summary should appear as a system message after the main system prompt
        summary_msgs = [m for m in messages if "Zusammenfassung" in m.get("content", "")]
        assert len(summary_msgs) == 1

    def test_empty_conversation(self, store):
        conv_id = "test-conv-empty"
        messages = store.build_messages(
            conversation_id=conv_id,
            system_prompt="System",
            new_message="Hallo",
            max_turns=10,
        )
        # Should have system + user (new message)
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Hallo"

    def test_voice_input_flag_stored(self, store):
        conv_id = "test-conv-voice"
        store.add_turn(conv_id, "user", "Sprachnachricht", voice_input=True)
        turns = store.get_recent_turns(conv_id, n=1)
        assert turns[0]["voice_input"] is True

    def test_separate_conversations_isolated(self, store):
        conv1 = "conv-a"
        conv2 = "conv-b"
        store.add_turn(conv1, "user", "In Konversation A", token_count=5)
        store.add_turn(conv2, "user", "In Konversation B", token_count=5)

        turns_a = store.get_recent_turns(conv1, n=10)
        turns_b = store.get_recent_turns(conv2, n=10)

        assert len(turns_a) == 1
        assert turns_a[0]["content"] == "In Konversation A"
        assert len(turns_b) == 1
        assert turns_b[0]["content"] == "In Konversation B"
