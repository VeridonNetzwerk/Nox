"""Autostart management — Windows.

Manages the HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
registry entry for Nox.
"""

import logging
import sys
from pathlib import Path
from typing import Any

from platform_utils import IS_WINDOWS

logger = logging.getLogger("nox.autostart")

try:
    import winreg
    _WINREG_AVAILABLE = True
except ImportError:
    _WINREG_AVAILABLE = False

REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "Nox"


class AutostartManager:
    """Manages autostart via the Windows Registry."""

    def __init__(self):
        self._exe_path = self._resolve_exe_path()

    def _resolve_exe_path(self) -> str:
        """Resolve the path to the Nox executable."""
        if IS_WINDOWS:
            # In production: the installed executable (electron-builder layout)
            # Nox.exe is at the app root, Python is at resources/backend/.venv/Scripts/
            if sys.executable and sys.executable.endswith(".exe"):
                exe_dir = Path(sys.executable)
                # Walk up to find Nox.exe (max 5 levels)
                for _ in range(5):
                    exe_dir = exe_dir.parent
                    nox_exe = exe_dir / "Nox.exe"
                    if nox_exe.exists():
                        return str(nox_exe)
            # In dev: return the current executable path
            return sys.executable if sys.executable else ""
        return sys.executable if sys.executable else ""

    @property
    def is_available(self) -> bool:
        return IS_WINDOWS and _WINREG_AVAILABLE

    def is_enabled(self) -> bool:
        """Check if autostart is currently enabled."""
        if IS_WINDOWS:
            return self._is_enabled_win32()
        return False

    def _is_enabled_win32(self) -> bool:
        if not _WINREG_AVAILABLE:
            return False
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0, winreg.KEY_READ) as key:
                winreg.QueryValueEx(key, APP_NAME)
                return True
        except FileNotFoundError:
            return False
        except Exception:
            return False

    def enable(self) -> bool:
        """Enable autostart."""
        if IS_WINDOWS:
            return self._enable_win32()
        return False

    def _enable_win32(self) -> bool:
        if not _WINREG_AVAILABLE or not self._exe_path:
            logger.warning("Cannot enable autostart: winreg=%s, exe=%s",
                           _WINREG_AVAILABLE, self._exe_path)
            return False
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, self._exe_path)
            logger.info("Autostart enabled: %s", self._exe_path)
            return True
        except Exception as exc:
            logger.error("Failed to enable autostart: %s", exc, exc_info=True)
            return False

    def disable(self) -> bool:
        """Disable autostart."""
        if IS_WINDOWS:
            return self._disable_win32()
        return False

    def _disable_win32(self) -> bool:
        if not _WINREG_AVAILABLE:
            return False
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, APP_NAME)
            logger.info("Autostart disabled")
            return True
        except FileNotFoundError:
            return True
        except Exception as exc:
            logger.error("Failed to disable autostart: %s", exc, exc_info=True)
            return False

    def status(self) -> dict[str, Any]:
        """Return autostart status for API."""
        return {
            "available": self.is_available,
            "enabled": self.is_enabled(),
            "exe_path": self._exe_path,
        }
