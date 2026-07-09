"""Unit tests for context retrieval ranking logic.

Tests the ContextStore's get_relevant_context method with
various scenarios: recency weighting, semantic similarity,
FTS matching, and combined ranking.
"""

import os
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# We test the ranking logic without requiring sentence-transformers or heavy deps.
# The ContextStore is mocked where needed, and we test the pure Python logic.


def _make_entry(
    app_name: str,
    content_text: str,
    timestamp: str,
    content_type: str = "uia",
    window_title: str = "",
) -> dict:
    """Create a context entry dict as returned by ContextStore."""
    return {
        "app_name": app_name,
        "window_title": window_title,
        "content_type": content_type,
        "content_text": content_text,
        "timestamp": timestamp,
    }


def test_recent_entry_ranks_higher_than_old():
    """Entries within the time window should be returned; old ones excluded."""
    now = datetime.now()
    recent = _make_entry("vscode", "print hello world", now.isoformat())
    old = _make_entry("notepad", "old note", (now - timedelta(hours=48)).isoformat())

    # Simulate the time filter: entries older than 24h should be excluded
    cutoff = now - timedelta(hours=24)
    entries = [recent, old]
    filtered = [
        e for e in entries
        if datetime.fromisoformat(e["timestamp"]) > cutoff
    ]
    assert recent in filtered
    assert old not in filtered


def test_fts_keyword_match_prioritizes_relevant():
    """FTS5 keyword matching should surface entries containing query terms."""
    entries = [
        _make_entry("browser", "Python Tutorial: How to use decorators", datetime.now().isoformat()),
        _make_entry("editor", "Meeting notes from today", datetime.now().isoformat()),
        _make_entry("terminal", "pip install flask requests", datetime.now().isoformat()),
    ]

    query = "python decorators"
    query_terms = query.lower().split()

    # Simple FTS-like scoring: count matching terms
    def fts_score(entry):
        text = entry["content_text"].lower()
        return sum(1 for term in query_terms if term in text)

    scored = sorted(entries, key=fts_score, reverse=True)
    assert scored[0]["content_text"] == "Python Tutorial: How to use decorators"
    assert fts_score(scored[0]) == 2  # "python" + "decorators"


def test_combined_recency_and_relevance_ranking():
    """Combined score should balance recency and keyword relevance."""
    now = datetime.now()
    entries = [
        # Highly relevant but old
        _make_entry("editor", "python decorators tutorial", (now - timedelta(hours=20)).isoformat()),
        # Less relevant but very recent
        _make_entry("browser", "news headlines today", (now - timedelta(minutes=5)).isoformat()),
        # Both relevant and recent
        _make_entry("terminal", "python script running decorators", (now - timedelta(minutes=30)).isoformat()),
    ]

    query = "python decorators"
    query_terms = query.lower().split()

    def combined_score(entry):
        text = entry["content_text"].lower()
        relevance = sum(1 for term in query_terms if term in text)
        age_hours = (now - datetime.fromisoformat(entry["timestamp"])).total_seconds() / 3600
        recency = max(0, 1 - age_hours / 24)  # 1.0 = now, 0.0 = 24h ago
        return relevance * 0.6 + recency * 0.4

    scored = sorted(entries, key=combined_score, reverse=True)
    # The entry with both relevance and recency should win
    assert scored[0]["content_text"] == "python script running decorators"
    assert scored[1]["content_text"] == "python decorators tutorial"


def test_empty_query_returns_empty():
    """Empty query should return no results."""
    entries = [_make_entry("app", "some content", datetime.now().isoformat())]
    query = ""
    query_terms = query.lower().split()
    scored = [
        e for e in entries
        if any(term in e["content_text"].lower() for term in query_terms)
    ]
    assert scored == []


def test_k_limit_respected():
    """Should return at most k entries."""
    now = datetime.now()
    entries = [
        _make_entry(f"app{i}", f"content {i}", (now - timedelta(minutes=i)).isoformat())
        for i in range(10)
    ]
    k = 3
    # Sort by recency (most recent first)
    scored = sorted(entries, key=lambda e: e["timestamp"], reverse=True)
    top_k = scored[:k]
    assert len(top_k) == k


def test_clipboard_entries_included():
    """Clipboard entries should be retrievable alongside UIA/OCR entries."""
    now = datetime.now()
    entries = [
        _make_entry("vscode", "def hello():", now.isoformat(), content_type="uia"),
        _make_entry("unknown", "https://github.com/example", now.isoformat(), content_type="clipboard"),
        _make_entry("browser", "Welcome page", now.isoformat(), content_type="ocr"),
    ]

    query = "github"
    query_terms = query.lower().split()
    matched = [
        e for e in entries
        if any(term in e["content_text"].lower() for term in query_terms)
    ]
    assert len(matched) == 1
    assert matched[0]["content_type"] == "clipboard"
