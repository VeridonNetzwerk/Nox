"""Pytest configuration for Nox backend tests.

Adds the backend directory to sys.path so test modules can import
backend modules without installation.
"""

import sys
import inspect
from pathlib import Path

import pytest

# Add backend dir to path (tests are in nox-app/tests/, backend in nox-app/backend/)
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))


def pytest_collection_modifyitems(config, items):
    """Automatically mark async tests with asyncio marker."""
    for item in items:
        if inspect.iscoroutinefunction(getattr(item, "function", None)):
            item.add_marker(pytest.mark.asyncio)
