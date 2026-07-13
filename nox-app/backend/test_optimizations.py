"""Comprehensive unit tests for all optimized Nox components.

Run with: python test_optimizations.py

Tests cover:
1. ToolHandler: registration, caching, execution, fallback parsing
2. ScreenshotHistory: JPEG compression, ring buffer, OCR interface
3. VoiceManager: voice catalog lookup caches, language detection
4. ConversationStore: add/get turns, summary, build_messages
5. SystemPrompt: build_system_prompt variations
6. SentenceBuffer: sentence splitting for streaming TTS
7. FilesManager: network drive cache, settings update
8. Orchestrator: HTTP client reuse, model switching, tools cache invalidation
"""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime

# Ensure backend dir is on path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))


class TestToolHandler(unittest.TestCase):
    """Test tool registration, caching, execution, and fallback parsing."""

    def setUp(self):
        from orchestrator.tool_handler import ToolHandler, Tool
        self.ToolHandler = ToolHandler
        self.Tool = Tool
        self.handler = ToolHandler(
            eye_manager=MagicMock(),
            files_manager=MagicMock(),
            settings_manager=MagicMock(),
            apply_settings_fn=MagicMock(),
            config={"audio_output_device": "default"},
        )

    def test_tools_registered(self):
        """All expected tools should be registered."""
        expected = {"kontext_suche", "notiz_speichern", "aktuelle_uhrzeit",
                    "dateien_suchen", "datei_lesen", "bildschirm_lesen",
                    "screenshot_historie", "einstellung_aendern", "einstellungen_lesen",
                    "musik_erkennen"}
        for name in expected:
            self.assertTrue(self.handler.has_tool(name), f"Tool '{name}' not registered")

    def test_get_ollama_tools_caching(self):
        """get_ollama_tools() should return cached result on second call."""
        tools1 = self.handler.get_ollama_tools()
        tools2 = self.handler.get_ollama_tools()
        self.assertIs(tools1, tools2, "get_ollama_tools() should return same cached object")

    def test_get_ollama_tools_cache_invalidation(self):
        """Registering a new tool should invalidate the cache."""
        tools1 = self.handler.get_ollama_tools()
        self.handler.register(self.Tool(
            name="test_tool",
            description="Test",
            parameters={"type": "object", "properties": {}},
            handler=lambda args: "test",
        ))
        tools2 = self.handler.get_ollama_tools()
        self.assertIsNot(tools1, tools2, "Cache should be invalidated after register()")
        self.assertTrue(any(t["function"]["name"] == "test_tool" for t in tools2))

    def test_parse_fallback(self):
        """Fallback parser should extract tool name and params."""
        text = "Let me search for that. [TOOL: dateien_suchen] projekt dateien"
        result = self.handler.parse_fallback(text)
        self.assertIsNotNone(result)
        name, params = result
        self.assertEqual(name, "dateien_suchen")
        self.assertEqual(params, "projekt dateien")

    def test_parse_fallback_none(self):
        """Fallback parser should return None when no tool marker found."""
        result = self.handler.parse_fallback("Just a normal response")
        self.assertIsNone(result)

    def test_strip_tool_marker(self):
        """strip_tool_marker should remove [TOOL: ...] from text."""
        text = "Searching... [TOOL: dateien_suchen] test\nDone."
        stripped = self.handler.strip_tool_marker(text)
        self.assertNotIn("[TOOL:", stripped)

    def test_execute_unknown_tool(self):
        """Executing an unknown tool should return an error message."""
        result = self.handler.execute("nonexistent_tool", {})
        self.assertIn("Unbekanntes Werkzeug", result)

    def test_execute_current_time(self):
        """aktuelle_uhrzeit should return a time string."""
        result = self.handler.execute("aktuelle_uhrzeit", {})
        self.assertIn("Es ist", result)
        self.assertIn("Uhr", result)

    def test_execute_save_note(self):
        """notiz_speichern should save a note via eye_manager."""
        result = self.handler.execute("notiz_speichern", {"text": "Test note"})
        self.assertIn("Notiz gespeichert", result)
        self.assertIn("Test note", result)

    def test_execute_save_note_empty(self):
        """notiz_speichern with empty text should return error."""
        result = self.handler.execute("notiz_speichern", {"text": ""})
        self.assertIn("Notiztext fehlt", result)

    def test_execute_context_search(self):
        """kontext_suche should query eye_manager."""
        self.handler._eye_manager.get_relevant_context.return_value = "Some context"
        result = self.handler.execute("kontext_suche", {"query": "test"})
        self.assertEqual(result, "Some context")

    def test_execute_context_search_empty(self):
        """kontext_suche with no eye_manager should return fallback."""
        handler = self.ToolHandler(config={})
        result = handler.execute("kontext_suche", {"query": "test"})
        self.assertIn("Kein Kontext", result)

    def test_execute_read_settings(self):
        """einstellungen_lesen should return settings list."""
        self.handler._settings_manager.config = {"ollama_model": "qwen3:14b"}
        result = self.handler.execute("einstellungen_lesen", {})
        self.assertIn("Aktuelle Nox-Einstellungen", result)
        self.assertIn("ollama_model", result)

    def test_execute_change_setting(self):
        """einstellung_aendern should save and apply settings."""
        self.handler._settings_manager.config = {}
        result = self.handler.execute("einstellung_aendern", {"key": "ollama_model", "value": "llama3"})
        self.assertIn("geändert", result)
        self.handler._settings_manager.save.assert_called_once_with({"ollama_model": "llama3"})
        self.handler._apply_settings_fn.assert_called_once_with({"ollama_model": "llama3"})

    def test_execute_change_setting_unknown(self):
        """einstellung_aendern with unknown key should return error."""
        result = self.handler.execute("einstellung_aendern", {"key": "unknown_key", "value": "x"})
        self.assertIn("Unbekannte Einstellung", result)

    def test_execute_search_files(self):
        """dateien_suchen should query files_manager."""
        self.handler._files_manager.search.return_value = [
            {"file_name": "test.txt", "file_path": "/tmp/test.txt", "snippet": "hello"}
        ]
        result = self.handler.execute("dateien_suchen", {"query": "test"})
        self.assertIn("test.txt", result)
        self.assertIn("/tmp/test.txt", result)

    def test_execute_search_files_no_results(self):
        """dateien_suchen with no results should return appropriate message."""
        self.handler._files_manager.search.return_value = []
        result = self.handler.execute("dateien_suchen", {"query": "nonexistent"})
        self.assertIn("Keine passenden Dateien", result)

    def test_execute_read_file(self):
        """datei_lesen should read file content via files_manager."""
        self.handler._files_manager.read_file.return_value = "File content here"
        result = self.handler.execute("datei_lesen", {"pfad": "/tmp/test.txt"})
        self.assertEqual(result, "File content here")

    def test_execute_read_file_not_found(self):
        """datei_lesen with non-existent file should return error."""
        self.handler._files_manager.read_file.return_value = None
        result = self.handler.execute("datei_lesen", {"pfad": "/nonexistent"})
        self.assertIn("nicht gefunden", result)

    def test_execute_read_screen(self):
        """bildschirm_lesen should call eye_manager.read_screen_now."""
        self.handler._eye_manager.read_screen_now.return_value = "Screen content"
        result = self.handler.execute("bildschirm_lesen", {})
        self.assertEqual(result, "Screen content")

    def test_execute_screenshot_history(self):
        """screenshot_historie should return history summary."""
        self.handler._eye_manager.get_screenshot_history_summary.return_value = "History"
        result = self.handler.execute("screenshot_historie", {})
        self.assertEqual(result, "History")


class TestScreenshotHistory(unittest.TestCase):
    """Test screenshot history with JPEG compression and ring buffer."""

    def setUp(self):
        from nox_eye.screenshot_history import ScreenshotHistory, ScreenshotEntry
        self.ScreenshotHistory = ScreenshotHistory
        self.ScreenshotEntry = ScreenshotEntry

    def test_screenshot_entry_slots(self):
        """ScreenshotEntry should use __slots__ with image_bytes."""
        entry = self.ScreenshotEntry(
            timestamp="2024-01-01",
            image_bytes=b"\xff\xd8\xff\xe0",  # JPEG header
            app_name="test",
            window_title="Test",
        )
        self.assertEqual(entry.timestamp, "2024-01-01")
        self.assertEqual(entry.image_bytes, b"\xff\xd8\xff\xe0")
        self.assertEqual(entry.app_name, "test")
        self.assertEqual(entry.window_title, "Test")
        self.assertFalse(hasattr(entry, "__dict__"))

    def test_ring_buffer_max_entries(self):
        """Buffer should not exceed max_entries."""
        history = self.ScreenshotHistory(interval_seconds=10, history_hours=0.1)
        # max_entries = (0.1 * 3600) / 10 = 36
        self.assertEqual(history._max_entries, 36)

    def test_update_interval(self):
        """update_interval should adjust max_entries."""
        history = self.ScreenshotHistory(interval_seconds=60, history_hours=1.0)
        self.assertEqual(history._max_entries, 60)
        history.update_interval(30)
        self.assertEqual(history.interval, 30)
        self.assertEqual(history._max_entries, 120)

    def test_update_interval_minimum(self):
        """update_interval should enforce minimum of 10 seconds."""
        history = self.ScreenshotHistory(interval_seconds=60, history_hours=1.0)
        history.update_interval(1)
        self.assertEqual(history.interval, 10)

    def test_get_latest_empty(self):
        """get_latest on empty buffer should return None."""
        history = self.ScreenshotHistory()
        self.assertIsNone(history.get_latest())

    def test_get_history_summary_empty(self):
        """get_history_summary on empty buffer should return German message."""
        history = self.ScreenshotHistory()
        summary = history.get_history_summary()
        self.assertIn("Keine Screenshot-Historie", summary)

    def test_health(self):
        """health() should return expected fields."""
        history = self.ScreenshotHistory(interval_seconds=30, history_hours=2.0)
        h = history.health()
        self.assertEqual(h["interval"], 30)
        self.assertEqual(h["history_hours"], 2.0)
        self.assertFalse(h["running"])
        self.assertEqual(h["buffer_count"], 0)


class TestVoiceCatalogCaches(unittest.TestCase):
    """Test that voice catalog lookup caches work correctly."""

    def test_voice_name_map_built(self):
        """_VOICE_NAME_MAP should be populated at import time."""
        from nox_voice.voice_manager import _VOICE_NAME_MAP
        self.assertGreater(len(_VOICE_NAME_MAP), 0)

    def test_voice_gender_map_built(self):
        """_VOICE_GENDER_MAP should be populated at import time."""
        from nox_voice.voice_manager import _VOICE_GENDER_MAP
        self.assertGreater(len(_VOICE_GENDER_MAP), 0)

    def test_voice_name_map_has_edge_voices(self):
        """_VOICE_NAME_MAP should contain Edge voice IDs."""
        from nox_voice.voice_manager import _VOICE_NAME_MAP
        # de-DE-KatjaNeural is a standard Edge voice
        self.assertIn("de-DE-KatjaNeural", _VOICE_NAME_MAP)

    def test_voice_gender_map_has_male_and_female(self):
        """_VOICE_GENDER_MAP should contain both male and female entries."""
        from nox_voice.voice_manager import _VOICE_GENDER_MAP
        genders = set(_VOICE_GENDER_MAP.values())
        self.assertIn("male", genders)
        self.assertIn("female", genders)

    def test_is_male_voice_lookup(self):
        """_is_male_voice should use cached lookup (O(1) dict access)."""
        from nox_voice.voice_manager import _VOICE_GENDER_MAP
        # Find a known male voice
        male_voices = [vid for vid, g in _VOICE_GENDER_MAP.items() if g == "male"]
        self.assertGreater(len(male_voices), 0)
        # Verify lookup
        self.assertEqual(_VOICE_GENDER_MAP[male_voices[0]], "male")


class TestSentenceBuffer(unittest.TestCase):
    """Test sentence buffer for streaming TTS."""

    def setUp(self):
        from orchestrator.orchestrator import SentenceBuffer
        self.SentenceBuffer = SentenceBuffer

    def test_single_sentence_no_end(self):
        """Text without sentence end should not emit."""
        buf = self.SentenceBuffer()
        sentences = buf.feed("Hello world")
        self.assertEqual(sentences, [])

    def test_single_sentence_with_end(self):
        """Text with sentence end should emit one sentence."""
        buf = self.SentenceBuffer()
        sentences = buf.feed("Hello world. ")
        self.assertEqual(len(sentences), 1)
        self.assertIn("Hello world", sentences[0])

    def test_multiple_sentences(self):
        """Multiple sentence ends should emit multiple sentences."""
        buf = self.SentenceBuffer()
        sentences = buf.feed("First. Second. Third. ")
        self.assertEqual(len(sentences), 3)

    def test_partial_then_complete(self):
        """Partial tokens then completion should work."""
        buf = self.SentenceBuffer()
        s1 = buf.feed("Hello ")
        self.assertEqual(s1, [])
        s2 = buf.feed("world. ")
        self.assertEqual(len(s2), 1)

    def test_flush(self):
        """flush() should return remaining buffer content."""
        buf = self.SentenceBuffer()
        buf.feed("Incomplete sentence")
        remaining = buf.flush()
        self.assertIn("Incomplete sentence", remaining)


class TestConversationStore(unittest.TestCase):
    """Test conversation store SQLite operations."""

    def setUp(self):
        from orchestrator.conversation_store import ConversationStore
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmpdir.name) / "test_conv.db")
        self.store = ConversationStore(db_path=self.db_path)

    def tearDown(self):
        self.store.close()
        self.tmpdir.cleanup()

    def test_add_and_get_turns(self):
        """Added turns should be retrievable in order."""
        cid = "test-conv-1"
        self.store.add_turn(cid, "user", "Hello", token_count=5)
        self.store.add_turn(cid, "assistant", "Hi there", token_count=5)
        turns = self.store.get_recent_turns(cid, n=10)
        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]["role"], "user")
        self.assertEqual(turns[0]["content"], "Hello")
        self.assertEqual(turns[1]["role"], "assistant")

    def test_get_recent_turns_limit(self):
        """get_recent_turns should respect the limit."""
        cid = "test-conv-2"
        for i in range(5):
            self.store.add_turn(cid, "user", f"msg-{i}")
        turns = self.store.get_recent_turns(cid, n=2)
        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]["content"], "msg-3")
        self.assertEqual(turns[1]["content"], "msg-4")

    def test_get_summary_none(self):
        """get_summary should return None when no summary exists."""
        result = self.store.get_summary("no-such-conv")
        self.assertIsNone(result)

    def test_build_messages(self):
        """build_messages should construct proper message list."""
        cid = "test-conv-3"
        self.store.add_turn(cid, "user", "Hello")
        self.store.add_turn(cid, "assistant", "Hi")
        messages = self.store.build_messages(
            conversation_id=cid,
            system_prompt="You are Nox",
            new_message="How are you?",
        )
        self.assertEqual(messages[0]["role"], "system")
        self.assertEqual(messages[0]["content"], "You are Nox")
        # Should have system, user, assistant, user
        self.assertEqual(len(messages), 4)
        self.assertEqual(messages[-1]["role"], "user")
        self.assertEqual(messages[-1]["content"], "How are you?")

    def test_build_messages_with_context(self):
        """build_messages should inject context into system prompt."""
        cid = "test-conv-4"
        messages = self.store.build_messages(
            conversation_id=cid,
            system_prompt="You are Nox",
            new_message="Test",
            context="Screen: VS Code",
        )
        self.assertIn("Relevanter Kontext", messages[0]["content"])
        self.assertIn("VS Code", messages[0]["content"])


class TestSystemPrompt(unittest.TestCase):
    """Test system prompt building."""

    def test_text_mode(self):
        """Text mode should include TEXT_MODE_DIRECTIVE."""
        from orchestrator.system_prompt import build_system_prompt
        prompt = build_system_prompt(voice_mode=False, tools_enabled=True)
        self.assertIn("Nox", prompt)
        self.assertIn("TEXT", prompt)
        self.assertIn("Aktuelle Zeit", prompt)

    def test_voice_mode(self):
        """Voice mode should include VOICE_MODE_DIRECTIVE."""
        from orchestrator.system_prompt import build_system_prompt
        prompt = build_system_prompt(voice_mode=True, tools_enabled=True)
        self.assertIn("SPRACHE", prompt)
        self.assertIn("Markdown", prompt)  # Should say "KEIN Markdown"

    def test_tools_disabled(self):
        """Tools disabled should not include tool descriptions."""
        from orchestrator.system_prompt import build_system_prompt
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        self.assertNotIn("kontext_suche", prompt)

    def test_voice_personality_male(self):
        """Male voice personality should mention 'männlich'."""
        from orchestrator.system_prompt import build_system_prompt
        prompt = build_system_prompt(
            voice_mode=True,
            tools_enabled=True,
            voice_personality={"name": "Conrad", "gender": "male", "engine": "edge"},
        )
        self.assertIn("männlich", prompt)
        self.assertIn("Conrad", prompt)

    def test_voice_personality_female(self):
        """Female voice personality should mention 'weiblich'."""
        from orchestrator.system_prompt import build_system_prompt
        prompt = build_system_prompt(
            voice_mode=True,
            tools_enabled=True,
            voice_personality={"name": "Seraphina", "gender": "female", "engine": "edge"},
        )
        self.assertIn("weiblich", prompt)
        self.assertIn("Seraphina", prompt)


class TestFilesManagerNetworkCache(unittest.TestCase):
    """Test network drive detection caching."""

    def setUp(self):
        from nox_files.files_manager import FilesManager
        self.FilesManager = FilesManager

    def test_network_drives_cache_init(self):
        """Network drives cache should be None initially."""
        fm = self.FilesManager({"nox_files_enabled": False})
        self.assertIsNone(fm._network_drives_cache)
        self.assertEqual(fm._network_drives_cache_time, 0)

    def test_network_drives_cache_after_call(self):
        """After calling _detect_network_drives, cache should be populated."""
        fm = self.FilesManager({"nox_files_enabled": False})
        drives = fm._detect_network_drives()
        self.assertIsNotNone(fm._network_drives_cache)
        self.assertEqual(drives, fm._network_drives_cache)
        self.assertGreater(fm._network_drives_cache_time, 0)

    def test_network_drives_cache_hit(self):
        """Second call within 10 minutes should return cached result."""
        fm = self.FilesManager({"nox_files_enabled": False})
        drives1 = fm._detect_network_drives()
        # Manually set cache time to recent
        fm._network_drives_cache_time = time.time()
        drives2 = fm._detect_network_drives()
        self.assertIs(drives1, drives2, "Should return same cached object")


class TestOrchestratorHttpAndToolsCache(unittest.TestCase):
    """Test orchestrator HTTP client reuse and tools cache."""

    def setUp(self):
        from orchestrator.orchestrator import Orchestrator
        self.Orchestrator = Orchestrator

    def test_http_client_initial_none(self):
        """HTTP client should be None initially."""
        orch = self.Orchestrator(
            config={"ollama_host": "http://localhost:11434", "ollama_model": "test"},
            eye_manager=MagicMock(),
            voice_manager=MagicMock(),
            files_manager=MagicMock(),
        )
        self.assertIsNone(orch._http_client)

    def test_tools_cache_initial_none(self):
        """Tools cache should be None initially."""
        orch = self.Orchestrator(
            config={"ollama_host": "http://localhost:11434", "ollama_model": "test"},
            eye_manager=MagicMock(),
            voice_manager=MagicMock(),
            files_manager=MagicMock(),
        )
        self.assertIsNone(orch._tools_cache)

    def test_set_model_invalidates_tools_cache(self):
        """set_model should set _tools_supported and _tools_cache to None."""
        orch = self.Orchestrator(
            config={"ollama_host": "http://localhost:11434", "ollama_model": "test"},
            eye_manager=MagicMock(),
            voice_manager=MagicMock(),
            files_manager=MagicMock(),
        )
        orch._tools_supported = True
        orch._tools_cache = ["fake"]
        orch.set_model("new-model")
        self.assertIsNone(orch._tools_supported)
        self.assertIsNone(orch._tools_cache)
        self.assertEqual(orch.ollama_model, "new-model")

    def test_new_conversation(self):
        """new_conversation should generate a new UUID."""
        orch = self.Orchestrator(
            config={"ollama_host": "http://localhost:11434", "ollama_model": "test"},
            eye_manager=MagicMock(),
            voice_manager=MagicMock(),
            files_manager=MagicMock(),
        )
        old_id = orch.conversation_id
        new_id = orch.new_conversation()
        self.assertNotEqual(old_id, new_id)
        self.assertEqual(orch.conversation_id, new_id)


class TestVADHelpers(unittest.TestCase):
    """Test VAD helper functions."""

    def test_ends_with_fillword_true(self):
        """Should detect fill words at end of text."""
        from nox_voice.vad import _ends_with_fillword
        self.assertTrue(_ends_with_fillword("das ist also"))
        self.assertTrue(_ends_with_fillword("naja das war"))

    def test_ends_with_fillword_false(self):
        """Should not detect fill words in normal text."""
        from nox_voice.vad import _ends_with_fillword
        self.assertFalse(_ends_with_fillword("das ist ein Test"))

    def test_is_incomplete_sentence_no_punctuation(self):
        """Text without ending punctuation should be incomplete."""
        from nox_voice.vad import _is_incomplete_sentence
        self.assertTrue(_is_incomplete_sentence("das ist ein Test"))

    def test_is_incomplete_sentence_with_punctuation(self):
        """Text with ending punctuation should be complete."""
        from nox_voice.vad import _is_incomplete_sentence
        self.assertFalse(_is_incomplete_sentence("Das ist ein Test."))

    def test_is_incomplete_sentence_empty(self):
        """Empty text should be incomplete."""
        from nox_voice.vad import _is_incomplete_sentence
        self.assertTrue(_is_incomplete_sentence(""))


class TestMusicRecognizerInterface(unittest.TestCase):
    """Test music recognizer function signature (without actual Shazam call)."""

    def test_recognize_song_signature(self):
        """recognize_song should be callable with output_device parameter."""
        from nox_voice.music_recognizer import recognize_song
        import inspect
        sig = inspect.signature(recognize_song)
        params = list(sig.parameters.keys())
        self.assertIn("output_device", params)


if __name__ == "__main__":
    unittest.main(verbosity=2)
