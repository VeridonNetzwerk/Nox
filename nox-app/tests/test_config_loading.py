"""Unit tests for config loading and settings persistence.

Tests SettingsManager: first-run copy, load, save, merge.
"""

import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml


# We test SettingsManager by patching the APPDATA path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from settings_manager import SettingsManager


@pytest.fixture
def temp_appdata(tmp_path, monkeypatch):
    """Patch APPDATA to a temp directory."""
    monkeypatch.setenv("APPDATA", str(tmp_path))
    # Also patch the module-level path that was set at import time
    import settings_manager
    monkeypatch.setattr(settings_manager, "APPDATA", tmp_path)
    monkeypatch.setattr(settings_manager, "NOX_DIR", tmp_path / "Nox")
    monkeypatch.setattr(settings_manager, "CONFIG_PATH", tmp_path / "Nox" / "config.yaml")
    # Also patch BUNDLED_CONFIG to point to the real config.yaml
    bundled = Path(__file__).parent.parent / "backend" / "config.yaml"
    monkeypatch.setattr(settings_manager, "BUNDLED_CONFIG", bundled)
    return tmp_path


class TestSettingsManager:
    def test_first_run_copies_bundled_config(self, temp_appdata):
        """On first run, bundled config.yaml should be copied to %APPDATA%."""
        mgr = SettingsManager()
        assert Path(mgr.path).exists()
        cfg = mgr.load()
        assert "ollama_host" in cfg
        assert "ollama_model" in cfg

    def test_load_returns_dict(self, temp_appdata):
        mgr = SettingsManager()
        cfg = mgr.load()
        assert isinstance(cfg, dict)
        assert cfg.get("server_port") == 8420

    def test_save_persists_to_disk(self, temp_appdata):
        mgr = SettingsManager()
        mgr.save({"ollama_model": "mistral"})
        # Reload from disk
        with open(mgr.path, "r", encoding="utf-8") as f:
            disk_cfg = yaml.safe_load(f)
        assert disk_cfg["ollama_model"] == "mistral"

    def test_save_partial_merge(self, temp_appdata):
        """Save should merge, not replace."""
        mgr = SettingsManager()
        original_host = mgr.get("ollama_host")
        mgr.save({"ollama_model": "mistral"})
        # Original host should still be there
        assert mgr.get("ollama_host") == original_host
        assert mgr.get("ollama_model") == "mistral"

    def test_get_with_default(self, temp_appdata):
        mgr = SettingsManager()
        assert mgr.get("nonexistent_key", "default") == "default"

    def test_set_and_get(self, temp_appdata):
        mgr = SettingsManager()
        mgr.set("custom_key", "custom_value")
        assert mgr.get("custom_key") == "custom_value"

    def test_config_path_in_appdata(self, temp_appdata):
        mgr = SettingsManager()
        assert "Nox" in mgr.path
        assert "config.yaml" in mgr.path

    def test_excluded_apps_list(self, temp_appdata):
        """Excluded apps list should be loadable from config."""
        mgr = SettingsManager()
        cfg = mgr.load()
        excluded = cfg.get("nox_eye_excluded_apps", [])
        assert isinstance(excluded, list)
        assert "keepass" in excluded

    def test_save_and_reload_preserves_list(self, temp_appdata):
        """Lists (like excluded_apps) should survive save/reload."""
        mgr = SettingsManager()
        new_list = ["app1", "app2", "app3"]
        mgr.save({"nox_eye_excluded_apps": new_list})

        # Create a fresh manager to reload from disk
        mgr2 = SettingsManager()
        cfg = mgr2.load()
        assert cfg["nox_eye_excluded_apps"] == new_list
