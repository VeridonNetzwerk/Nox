"""Settings persistence – load/save config.yaml from %APPDATA%\\Nox.

On first run, copies the bundled config.yaml to %APPDATA%\\Nox\\config.yaml.
All subsequent reads/writes target the user copy, so settings persist
across updates without touching the install directory.
"""

import logging
import os
import shutil
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("nox.settings")

# Paths
APPDATA = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
NOX_DIR = APPDATA / "Nox"
CONFIG_PATH = NOX_DIR / "config.yaml"
BUNDLED_CONFIG = Path(__file__).parent / "config.yaml"


# Keys that must be overwritten in existing user configs when the bundled
# default changed (e.g. bug-fixes to default values). Use sparingly.
_FORCED_OVERRIDES = {
    "wake_word_model": "hey_nox.onnx",
}


class SettingsManager:
    """Manages persistent configuration in %APPDATA%\\Nox\\config.yaml."""

    def __init__(self):
        self._config: dict[str, Any] = {}
        self._ensure_config()
        self.load()

    def _ensure_config(self) -> None:
        """Copy bundled config to APPDATA on first run."""
        NOX_DIR.mkdir(parents=True, exist_ok=True)
        if not CONFIG_PATH.exists():
            if BUNDLED_CONFIG.exists():
                shutil.copy2(BUNDLED_CONFIG, CONFIG_PATH)
                logger.info("Copied default config to %s", CONFIG_PATH)
            else:
                # Create minimal config if bundled doesn't exist
                CONFIG_PATH.write_text("# Nox Configuration\n", encoding="utf-8")
                logger.warning("Bundled config not found, created minimal %s", CONFIG_PATH)

    def load(self) -> dict[str, Any]:
        """Load config from %APPDATA%, merging missing keys from bundled defaults."""
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                self._config = yaml.safe_load(f) or {}

            # Merge missing keys from bundled config so new features
            # appear in existing user configs without overwriting customizations.
            if BUNDLED_CONFIG.exists():
                with open(BUNDLED_CONFIG, "r", encoding="utf-8") as bf:
                    bundled = yaml.safe_load(bf) or {}
                merged = False
                for key, value in bundled.items():
                    if key not in self._config:
                        self._config[key] = value
                        merged = True
                if merged:
                    logger.info("Merged %d missing keys from bundled config", len([k for k in bundled if k not in self._config]))
                    self.save(self._config)

            # Apply forced overrides for corrected defaults.
            overridden = False
            for key, value in _FORCED_OVERRIDES.items():
                if self._config.get(key) != value:
                    self._config[key] = value
                    overridden = True
                    logger.info("Applied forced override %s = %s", key, value)
            if overridden:
                self.save(self._config)

            logger.info("Config loaded from %s", CONFIG_PATH)
            return self._config
        except Exception as exc:
            logger.error("Failed to load config: %s", exc, exc_info=True)
            self._config = {}
            return {}

    def save(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Merge updates into config and persist to disk.

        Args:
            updates: Partial config dict to merge.

        Returns:
            The full updated config.
        """
        self._config.update(updates)
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                yaml.dump(self._config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
            logger.info("Config saved to %s", CONFIG_PATH)
        except Exception as exc:
            logger.error("Failed to save config: %s", exc, exc_info=True)
        return self._config

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._config[key] = value

    @property
    def config(self) -> dict[str, Any]:
        return self._config

    @property
    def path(self) -> str:
        return str(CONFIG_PATH)
