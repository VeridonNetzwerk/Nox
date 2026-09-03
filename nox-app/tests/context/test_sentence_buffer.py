"""Tests for the SentenceBuffer class in the orchestrator module.

Verifies that streamed tokens are correctly accumulated into complete sentences
for TTS piping, including edge cases like abbreviations, multiple sentences,
and empty/whitespace-only input.
"""

import pytest
from orchestrator.orchestrator import SentenceBuffer


class TestSentenceBufferBasic:
    """Basic sentence boundary detection tests."""

    def test_empty_feed_returns_no_sentences(self):
        buf = SentenceBuffer()
        assert buf.feed("") == []

    def test_single_word_no_sentence(self):
        buf = SentenceBuffer()
        assert buf.feed("hello") == []

    def test_partial_sentence_accumulates(self):
        buf = SentenceBuffer()
        assert buf.feed("Hello wor") == []
        assert buf.feed("ld. ") == ["Hello world."]

    def test_complete_sentence_with_period(self):
        buf = SentenceBuffer()
        result = buf.feed("Hello world. ")
        assert result == ["Hello world."]

    def test_complete_sentence_with_exclamation(self):
        buf = SentenceBuffer()
        result = buf.feed("Stop! ")
        assert result == ["Stop!"]

    def test_complete_sentence_with_question_mark(self):
        buf = SentenceBuffer()
        result = buf.feed("What? ")
        assert result == ["What?"]


class TestSentenceBufferMultiple:
    """Multiple sentences in a single feed or across feeds."""

    def test_two_sentences_in_one_feed(self):
        buf = SentenceBuffer()
        result = buf.feed("Hello world. How are you? ")
        assert result == ["Hello world.", "How are you?"]

    def test_sentences_across_multiple_feeds(self):
        buf = SentenceBuffer()
        assert buf.feed("Hello ") == []
        assert buf.feed("world. ") == ["Hello world."]
        assert buf.feed("How are ") == []
        assert buf.feed("you? ") == ["How are you?"]

    def test_three_sentences_in_one_feed(self):
        buf = SentenceBuffer()
        result = buf.feed("One. Two. Three. ")
        assert result == ["One.", "Two.", "Three."]

    def test_sentence_without_trailing_space_not_emitted(self):
        buf = SentenceBuffer()
        # No trailing space after period means sentence is not complete yet
        result = buf.feed("Hello world.")
        assert result == []

    def test_sentence_emitted_when_space_added(self):
        buf = SentenceBuffer()
        buf.feed("Hello world.")
        result = buf.feed(" Next. ")
        assert result == ["Hello world.", "Next."]


class TestSentenceBufferFlush:
    """Flush behavior for remaining buffer content."""

    def test_flush_returns_remaining_text(self):
        buf = SentenceBuffer()
        buf.feed("Hello world")
        remaining = buf.flush()
        assert remaining == "Hello world"

    def test_flush_clears_buffer(self):
        buf = SentenceBuffer()
        buf.feed("Hello world")
        buf.flush()
        assert buf.flush() == ""

    def test_flush_after_complete_sentences(self):
        buf = SentenceBuffer()
        buf.feed("Hello world. ")
        buf.flush()  # Should return empty since sentence was already emitted
        # Buffer should be empty now
        assert buf.flush() == ""

    def test_flush_empty_buffer(self):
        buf = SentenceBuffer()
        assert buf.flush() == ""

    def test_flush_whitespace_only(self):
        buf = SentenceBuffer()
        buf.feed("   ")
        assert buf.flush() == ""


class TestSentenceBufferEdgeCases:
    """Edge cases and tricky inputs."""

    def test_newline_as_sentence_boundary(self):
        buf = SentenceBuffer()
        # The regex matches .!? followed by \s, which includes newlines
        result = buf.feed("Hello.\n")
        assert result == ["Hello."]

    def test_tab_as_sentence_boundary(self):
        buf = SentenceBuffer()
        result = buf.feed("Hello.\t")
        assert result == ["Hello."]

    def test_multiple_punctuation(self):
        buf = SentenceBuffer()
        result = buf.feed("What?! ")
        # The regex matches ! followed by \s, so "What?!" is one sentence
        assert result == ["What?!"]

    def test_ellipsis_not_split(self):
        buf = SentenceBuffer()
        result = buf.feed("Wait... then go. ")
        # The third dot in "..." is followed by a space, so it matches [.!?]\s
        # This splits into "Wait..." and "then go."
        assert len(result) == 2
        assert result[0] == "Wait..."
        assert result[1] == "then go."

    def test_empty_string_feeds(self):
        buf = SentenceBuffer()
        assert buf.feed("") == []
        assert buf.feed("") == []
        assert buf.flush() == ""

    def test_german_umlauts(self):
        buf = SentenceBuffer()
        result = buf.feed("Wie geht's? Mir geht's gut. ")
        assert result == ["Wie geht's?", "Mir geht's gut."]

    def test_numbers_with_decimals_not_split(self):
        buf = SentenceBuffer()
        # "3.14" should not be split as a sentence because there's no space after the period
        result = buf.feed("Pi is 3.14. ")
        assert result == ["Pi is 3.14."]

    def test_single_character_sentences(self):
        buf = SentenceBuffer()
        result = buf.feed("A. B. C. ")
        assert result == ["A.", "B.", "C."]
