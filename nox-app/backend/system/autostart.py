"""Autostart management — cross-platform.

Windows: Manages the HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
         registry entry for Nox.
Linux:   Manages a .desktop file in ~/.config/autostart/ for Nox.
"""

import logging
import os
import sys
from pathlib import Path
from typing import Any

from platform_utils import IS_WINDOWS, IS_LINUX, get_autostart_dir

logger = logging.getLogger("nox.autostart")

try:
    import winreg
    _WINREG_AVAILABLE = True
except ImportError:
    _WINREG_AVAILABLE = False

REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "Nox"
DESKTOP_FILE_NAME = "nox.desktop"


class AutostartManager:
    """Manages autostart via Windows Registry (Windows) or .desktop file (Linux)."""

    def __init__(self):
        self._exe_path = self._resolve_exe_path()
        if IS_LINUX:
            self._desktop_file = get_autostart_dir() / DESKTOP_FILE_NAME
        else:
            self._desktop_file = None

    def _resolve_exe_path(self) -> str:
        """Resolve the path to the Nox executable or dev launcher."""
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
        elif IS_LINUX:
            # In production: /usr/bin/nox or /opt/Nox/nox
            # In dev: the npm dev launcher
            # Check common install locations
            candidates = [
                "/usr/bin/nox",
                "/opt/Nox/nox",
                "/usr/local/bin/nox",
            ]
            for c in candidates:
                if os.path.exists(c):
                    return c
            # Dev mode: return a placeholder (Electron handles dev mode)
            return sys.executable if sys.executable else ""
        return sys.executable if sys.executable else ""

    @property
    def is_available(self) -> bool:
        if IS_WINDOWS:
            return _WINREG_AVAILABLE
        elif IS_LINUX:
            return True  # .desktop file mechanism is always available
        return False

    def is_enabled(self) -> bool:
        """Check if autostart is currently enabled."""
        if IS_WINDOWS:
            return self._is_enabled_win32()
        elif IS_LINUX:
            return self._is_enabled_linux()
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

    def _is_enabled_linux(self) -> bool:
        if not self._desktop_file:
            return False
        return self._desktop_file.exists()

    def enable(self) -> bool:
        """Enable autostart."""
        if IS_WINDOWS:
            return self._enable_win32()
        elif IS_LINUX:
            return self._enable_linux()
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

    def _enable_linux(self) -> bool:
        if not self._desktop_file:
            return False
        try:
            autostart_dir = get_autostart_dir()
            autostart_dir.mkdir(parents=True, exist_ok=True)
            desktop_entry = f"""[Desktop Entry]
Type=Application
Name=Nox
Comment=Local AI Desktop Assistant
Exec={self._exe_path}
Icon=nox
Terminal=false
Categories=Utility;AI;Assistant;
X-GNOME-Autostart-enabled=true
"""
            self._desktop_file.write_text(desktop_entry, encoding="utf-8")
            os.chmod(str(self._desktop_file), 0o755)
            logger.info("Autostart enabled: %s", self._desktop_file)
            return True
        except Exception as exc:
            logger.error("Failed to enable autostart: %s", exc, exc_info=True)
            return False

    def disable(self) -> bool:
        """Disable autostart."""
        if IS_WINDOWS:
            return self._disable_win32()
        elif IS_LINUX:
            return self._disable_linux()
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

    def _disable_linux(self) -> bool:
        if not self._desktop_file:
            return False
        try:
            if self._desktop_file.exists():
                self._desktop_file.unlink()
            logger.info("Autostart disabled")
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
