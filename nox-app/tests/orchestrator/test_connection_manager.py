"""Tests for the ConnectionManager class in main.py.

Tests cover:
- Connection management (connect, disconnect, latest)
- Broadcasting messages to connected clients
- Sending to latest connection only
- Single-user behavior (old connections closed on new connect)
- Dead connection cleanup

Since main.py has heavy import-time dependencies, we extract and test
the ConnectionManager class in isolation using exec().
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path

import pytest


def _extract_connection_manager_class():
    """Extract the ConnectionManager class source from main.py without importing it."""
    main_path = Path(__file__).parent.parent / "backend" / "main.py"
    source = main_path.read_text(encoding="utf-8")

    # Find the class definition
    start = source.index("class ConnectionManager:")
    # Find the end (next top-level definition or comment block)
    end_marker = "\n# ---------------------------------------------------------------------------"
    end = source.index(end_marker, start)
    class_source = source[start:end].strip()

    # Execute just the class definition in a clean namespace
    namespace = {}
    exec("from typing import Any, Optional", namespace)
    exec("import logging; logger = logging.getLogger('test')", namespace)
    exec(class_source, namespace)
    return namespace["ConnectionManager"]


ConnectionManager = _extract_connection_manager_class()


class TestConnectionManager:
    """Test the ConnectionManager class."""

    def _make_ws(self):
        """Create a mock WebSocket."""
        ws = MagicMock()
        ws.send_json = AsyncMock()
        ws.close = AsyncMock()
        ws.accept = AsyncMock()
        return ws

    def test_init_empty(self):
        cm = ConnectionManager()
        assert cm._connections == []
        assert cm.latest is None

    def test_connect_adds_connection(self):
        cm = ConnectionManager()
        ws = self._make_ws()
        asyncio.run(cm.connect(ws))
        assert len(cm._connections) == 1
        assert cm.latest is ws

    def test_connect_closes_old_connections(self):
        cm = ConnectionManager()
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        asyncio.run(cm.connect(ws1))
        asyncio.run(cm.connect(ws2))
        assert len(cm._connections) == 1
        assert cm.latest is ws2
        ws1.close.assert_awaited_once()

    def test_disconnect_removes_connection(self):
        cm = ConnectionManager()
        ws = self._make_ws()
        asyncio.run(cm.connect(ws))
        cm.disconnect(ws)
        assert len(cm._connections) == 0
        assert cm.latest is None

    def test_disconnect_nonexistent_connection(self):
        cm = ConnectionManager()
        ws = self._make_ws()
        cm.disconnect(ws)
        assert len(cm._connections) == 0

    def test_broadcast_sends_to_all(self):
        cm = ConnectionManager()
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        asyncio.run(cm.connect(ws1))
        cm._connections.append(ws2)
        msg = {"type": "test"}
        asyncio.run(cm.broadcast(msg))
        ws1.send_json.assert_awaited_with(msg)
        ws2.send_json.assert_awaited_with(msg)

    def test_broadcast_cleans_dead_connections(self):
        cm = ConnectionManager()
        ws = self._make_ws()
        asyncio.run(cm.connect(ws))
        ws.send_json = AsyncMock(side_effect=Exception("Connection closed"))
        asyncio.run(cm.broadcast({"type": "test"}))
        assert len(cm._connections) == 0

    def test_send_to_latest(self):
        cm = ConnectionManager()
        ws = self._make_ws()
        asyncio.run(cm.connect(ws))
        msg = {"type": "test"}
        asyncio.run(cm.send_to_latest(msg))
        ws.send_json.assert_awaited_with(msg)

    def test_send_to_latest_no_connections(self):
        cm = ConnectionManager()
        asyncio.run(cm.send_to_latest({"type": "test"}))

    def test_latest_property_returns_last(self):
        cm = ConnectionManager()
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        asyncio.run(cm.connect(ws1))
        cm._connections.append(ws2)
        assert cm.latest is ws2

    def test_latest_property_empty(self):
        cm = ConnectionManager()
        assert cm.latest is None

    def test_broadcast_with_mixed_dead_and_alive(self):
        cm = ConnectionManager()
        ws_alive = self._make_ws()
        ws_dead = self._make_ws()
        asyncio.run(cm.connect(ws_alive))
        cm._connections.append(ws_dead)
        ws_dead.send_json = AsyncMock(side_effect=Exception("Dead"))
        asyncio.run(cm.broadcast({"type": "test"}))
        ws_alive.send_json.assert_awaited_once()
        assert ws_dead not in cm._connections
        assert ws_alive in cm._connections
