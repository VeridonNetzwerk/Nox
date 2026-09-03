"""Tests for tool parameter parsing functions in the orchestrator.

Tests cover:
- _parse_timer_params: timer tool parameter parsing
- _parse_reminder_params: reminder tool parameter parsing
- _parse_translate_params: translation tool parameter parsing
- _parse_kv_params: generic key=value parameter parsing
"""

import pytest
from orchestrator.orchestrator import (
    _parse_timer_params,
    _parse_reminder_params,
    _parse_translate_params,
    _parse_kv_params,
)


class TestParseTimerParams:
    """Tests for _parse_timer_params."""

    def test_empty_params(self):
        result = _parse_timer_params("")
        assert result == {"aktion": ""}

    def test_single_action(self):
        result = _parse_timer_params("start")
        assert result == {"aktion": "start"}

    def test_with_minutes(self):
        result = _parse_timer_params("start minuten=10")
        assert result["aktion"] == "start"
        assert result["minuten"] == 10.0

    def test_with_seconds(self):
        result = _parse_timer_params("start sekunden=30")
        assert result["aktion"] == "start"
        assert result["sekunden"] == 30.0

    def test_with_message(self):
        result = _parse_timer_params("start minuten=10 nachricht=Pizza")
        assert result["aktion"] == "start"
        assert result["minuten"] == 10.0
        assert result["nachricht"] == "Pizza"

    def test_with_multi_word_message_using_quotes(self):
        # When nachricht= is followed by bare words, only the first word is the value
        result = _parse_timer_params("start minuten=10 nachricht=Pizza ist fertig")
        assert result["aktion"] == "start"
        assert result["minuten"] == 10.0
        assert result["nachricht"] == "Pizza"
        # Bare words after key=value are collected as nachricht only if nachricht not set
        # Since nachricht=Pizza is already set, bare words are ignored

    def test_with_time(self):
        result = _parse_timer_params("start uhrzeit=14:30")
        assert result["aktion"] == "start"
        assert result["uhrzeit"] == "14:30"

    def test_invalid_minutes_ignored(self):
        result = _parse_timer_params("start minuten=abc")
        assert result["aktion"] == "start"
        assert "minuten" not in result

    def test_bare_message_without_key(self):
        result = _parse_timer_params("start Pizza ist fertig")
        assert result["aktion"] == "start"
        assert result["nachricht"] == "Pizza ist fertig"

    def test_mixed_key_value_and_bare_words(self):
        result = _parse_timer_params("start minuten=5 Pizza fertig")
        assert result["aktion"] == "start"
        assert result["minuten"] == 5.0
        assert result["nachricht"] == "Pizza fertig"


class TestParseReminderParams:
    """Tests for _parse_reminder_params."""

    def test_empty_params(self):
        result = _parse_reminder_params("")
        assert result == {"aktion": ""}

    def test_single_action(self):
        result = _parse_reminder_params("speichern")
        assert result["aktion"] == "speichern"

    def test_with_zeitpunkt_and_text(self):
        result = _parse_reminder_params("speichern zeitpunkt=morgen 08:00 text=Müll rausbringen")
        assert result["aktion"] == "speichern"
        assert result["zeitpunkt"] == "morgen 08:00"
        assert result["text"] == "Müll rausbringen"

    def test_with_id(self):
        result = _parse_reminder_params("loeschen id=42")
        assert result["aktion"] == "loeschen"
        assert result["id"] == 42

    def test_invalid_id_ignored(self):
        result = _parse_reminder_params("loeschen id=abc")
        assert result["aktion"] == "loeschen"
        assert "id" not in result

    def test_text_with_multiple_words(self):
        result = _parse_reminder_params("speichern zeitpunkt=heute text=Meeting um 15 Uhr im Raum 3")
        assert result["aktion"] == "speichern"
        assert result["zeitpunkt"] == "heute"
        assert result["text"] == "Meeting um 15 Uhr im Raum 3"


class TestParseTranslateParams:
    """Tests for _parse_translate_params."""

    def test_empty_params(self):
        result = _parse_translate_params("")
        assert result == {}

    def test_basic_translation(self):
        result = _parse_translate_params("text=Hallo Welt zielsprache=en")
        assert result["text"] == "Hallo Welt"
        assert result["zielsprache"] == "en"

    def test_with_source_language(self):
        result = _parse_translate_params("text=Hello world zielsprache=de quellsprache=en")
        assert result["text"] == "Hello world"
        assert result["zielsprache"] == "de"
        assert result["quellsprache"] == "en"

    def test_text_with_multiple_words(self):
        result = _parse_translate_params("text=Das ist ein Test zielsprache=en")
        assert result["text"] == "Das ist ein Test"
        assert result["zielsprache"] == "en"

    def test_unknown_keys_ignored(self):
        result = _parse_translate_params("text=Hello zielsprache=de unknown=value")
        assert result["text"] == "Hello"
        assert result["zielsprache"] == "de"
        assert "unknown" not in result


class TestParseKvParams:
    """Tests for _parse_kv_params."""

    def test_empty_params(self):
        result = _parse_kv_params("", ["aktion", "wert"])
        assert result == {}

    def test_bare_first_value(self):
        result = _parse_kv_params("rechnen", ["aktion", "wert"])
        assert result["aktion"] == "rechnen"
        assert "wert" not in result

    def test_bare_first_value_with_following_text(self):
        result = _parse_kv_params("rechnen 5+3", ["aktion", "wert"])
        assert result["aktion"] == "rechnen"
        # "5+3" is a bare word, not key=value, so it's not assigned to any key
        assert "wert" not in result

    def test_key_value_pairs(self):
        result = _parse_kv_params("konvertieren wert=100 von=meter nach=feet", ["aktion", "wert", "von", "nach"])
        assert result["aktion"] == "konvertieren"
        assert result["wert"] == 100.0
        assert result["von"] == "meter"
        assert result["nach"] == "feet"

    def test_wert_as_float(self):
        result = _parse_kv_params("wert=42.5", ["aktion", "wert"])
        assert result["wert"] == 42.5

    def test_wert_non_numeric_as_string(self):
        result = _parse_kv_params("wert=abc", ["aktion", "wert"])
        assert result["wert"] == "abc"

    def test_unknown_keys_ignored(self):
        result = _parse_kv_params("aktion=test unknown=value", ["aktion", "wert"])
        assert result["aktion"] == "test"
        assert "unknown" not in result

    def test_multi_word_value(self):
        result = _parse_kv_params("aktion=test wert=hello world foo", ["aktion", "wert"])
        assert result["aktion"] == "test"
        assert result["wert"] == "hello world foo"
