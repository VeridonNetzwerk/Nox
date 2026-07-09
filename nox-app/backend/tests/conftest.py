"""Pytest configuration for Nox backend tests.

Adds the backend directory to sys.path so test modules can import
backend modules without installation.
"""

import sys
from pathlib import Path

# Add backend dir to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))
