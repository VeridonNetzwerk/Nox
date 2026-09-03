"""Tests for the SettingsManager.

Tests cover:
- First-run config copying from bundled defaults
- Load/save cycle
- Missing key merging from bundled config
- Forced overrides
- Config persistence across instances
- Edge cases (empty config, corrupted config)
"""

import os
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import yaml


@pytest.fixture
def temp_config_env(tmp_path):
    """Create a temporary config environment with a bundled config."""
    config_dir = tmp_path / "Nox"
    config_dir.mkdir()

    backend_dir = tmp_path / "backend"
    backend_dir.mkdir()
    bundled_config = backend_dir / "config.yaml"
    bundled_config.write_text(
        yaml.dump({
            "ollama_model": "qwen3:14b",
            "ollama_host": "http://localhost:11434",
            "wake_word_model": "hey_nox.onnx",
            "wake_word_threshold": 0.5,
            "tts_model": "de_DE-thorsten-medium",
            "tts_engine": "piper",
            "onboarding_completed": False,
            "max_context_tokens": 8192,
            "max_history_turns": 10,
            "nox_eye_ttl_days": 7,
            "nox_eye_excluded_apps": ["app1", "app2"],
        }, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )

    config_path = config_dir / "config.yaml"

    patches = [
        patch("settings_manager.NOX_DIR", config_dir),
        patch("settings_manager.CONFIG_PATH", config_path),
        patch("settings_manager.BUNDLED_CONFIG", bundled_config),
    ]
    for p in patches:
        p.start()

    yield {
        "config_dir": config_dir,
        "config_path": config_path,
        "bundled_config": bundled_config,
    }

    for p in patches:
        p.stop()


@pytest.fixture
def settings_manager(temp_config_env):
    """Create a SettingsManager with temp paths."""
    from settings_manager import SettingsManager
    return SettingsManager()


class TestSettingsManagerInit:
    """Test initialization and first-run behavior."""

    def test_init_copies_bundled_config_on_first_run(self, temp_config_env):
        from settings_manager import SettingsManager
        sm = SettingsManager()
        assert temp_config_env["config_path"].exists()
        config = sm.config
        assert config["ollama_model"] == "qwen3:14b"

    def test_init_creates_config_dir_if_missing(self, tmp_path):
        config_dir = tmp_path / "Nox"
        bundled = tmp_path / "backend" / "config.yaml"
        bundled.parent.mkdir()
        bundled.write_text("test: value\n", encoding="utf-8")
        config_path = config_dir / "config.yaml"

        with patch("settings_manager.NOX_DIR", config_dir), \
             patch("settings_manager.CONFIG_PATH", config_path), \
             patch("settings_manager.BUNDLED_CONFIG", bundled):
            from settings_manager import SettingsManager
            sm = SettingsManager()
        assert config_dir.exists()

    def test_init_creates_minimal_config_when_no_bundled(self, tmp_path):
        config_dir = tmp_path / "Nox"
        config_dir.mkdir()
        config_path = config_dir / "config.yaml"
        bundled = tmp_path / "nonexistent.yaml"

        with patch("settings_manager.NOX_DIR", config_dir), \
             patch("settings_manager.CONFIG_PATH", config_path), \
             patch("settings_manager.BUNDLED_CONFIG", bundled):
            from settings_manager import SettingsManager
            sm = SettingsManager()
        assert config_path.exists()


class TestSettingsManagerLoadSave:
    """Test load/save operations."""

    def test_load_returns_config_dict(self, settings_manager):
        config = settings_manager.load()
        assert isinstance(config, dict)
        assert "ollama_model" in config

    def test_save_persists_changes(self, settings_manager, temp_config_env):
        settings_manager.save({"ollama_model": "llama3.2:3b"})
        with open(temp_config_env["config_path"], "r", encoding="utf-8") as f:
            saved = yaml.safe_load(f)
        assert saved["ollama_model"] == "llama3.2:3b"

    def test_save_merges_with_existing(self, settings_manager):
        original_model = settings_manager.get("ollama_model")
        settings_manager.save({"tts_engine": "edge"})
        assert settings_manager.get("ollama_model") == original_model
        assert settings_manager.get("tts_engine") == "edge"

    def test_get_returns_default_for_missing_key(self, settings_manager):
        assert settings_manager.get("nonexistent_key", "default") == "default"

    def test_get_returns_none_for_missing_key_no_default(self, settings_manager):
        assert settings_manager.get("nonexistent_key") is None

    def test_set_updates_config(self, settings_manager):
        settings_manager.set("custom_key", "custom_value")
        assert settings_manager.get("custom_key") == "custom_value"

    def test_config_property_returns_dict(self, settings_manager):
        assert isinstance(settings_manager.config, dict)

    def test_path_property_returns_string(self, settings_manager):
        assert isinstance(settings_manager.path, str)


class TestSettingsManagerMerging:
    """Test merging of missing keys from bundled config."""

    def test_missing_keys_are_merged(self, temp_config_env):
        temp_config_env["config_path"].write_text(
            yaml.dump({"ollama_model": "custom:model"}),
            encoding="utf-8",
        )

        from settings_manager import SettingsManager
        sm = SettingsManager()

        assert sm.get("ollama_model") == "custom:model"
        assert sm.get("ollama_host") == "http://localhost:11434"
        assert sm.get("wake_word_threshold") == 0.5

    def test_forced_overrides_applied(self, temp_config_env):
        temp_config_env["config_path"].write_text(
            yaml.dump({"wake_word_model": "old_model.onnx"}),
            encoding="utf-8",
        )

        from settings_manager import SettingsManager
        sm = SettingsManager()

        assert sm.get("wake_word_model") == "hey_nox.onnx"


class TestSettingsManagerEdgeCases:
    """Test edge cases and error handling."""

    def test_load_corrupted_config_returns_empty(self, temp_config_env):
        temp_config_env["config_path"].write_text(
            "this: is: not: valid: yaml: [", encoding="utf-8",
        )

        from settings_manager import SettingsManager
        sm = SettingsManager()

        config = sm.config
        assert isinstance(config, dict)

    def test_load_empty_config_file(self, temp_config_env):
        temp_config_env["config_path"].write_text("", encoding="utf-8")

        from settings_manager import SettingsManager
        sm = SettingsManager()

        assert sm.get("ollama_model") == "qwen3:14b"

    def test_save_with_empty_dict(self, settings_manager):
        original = settings_manager.config.copy()
        settings_manager.save({})
        assert settings_manager.config == original
