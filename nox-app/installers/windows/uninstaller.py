#!/usr/bin/env python3
"""Nox — Windows Uninstaller.

Removes Nox from the system:
1. Deletes installation directory
2. Removes Start Menu and Desktop shortcuts
3. Removes Registry uninstall entry
4. Removes autostart entry
5. Optionally keeps user data (%APPDATA%\Nox)

This is compiled to uninstall.exe and placed alongside the Nox installation.
"""

import ctypes
import os
import shutil
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import messagebox

APP_NAME = "Nox"
UNINSTALL_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Nox"
RUN_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def run_as_admin():
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit(0)


def find_install_dir() -> Path:
    """Find the installation directory from the uninstaller's location."""
    return Path(sys.executable).parent


def remove_shortcuts():
    """Remove Start Menu and Desktop shortcuts."""
    # Start Menu
    start_menu = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    shortcut = start_menu / f"{APP_NAME}.lnk"
    if shortcut.exists():
        shortcut.unlink()
        print(f"Removed: {shortcut}")

    # Desktop
    desktop = Path.home() / "Desktop"
    shortcut = desktop / f"{APP_NAME}.lnk"
    if shortcut.exists():
        shortcut.unlink()
        print(f"Removed: {shortcut}")


def remove_registry_entries():
    """Remove Registry entries for uninstall and autostart."""
    try:
        import winreg

        # Uninstall key (try HKLM first, then HKCU)
        for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
            try:
                winreg.DeleteKey(hive, UNINSTALL_REG_KEY)
                print(f"Removed registry key: {UNINSTALL_REG_KEY}")
                break
            except FileNotFoundError:
                continue
            except PermissionError:
                continue

        # Autostart
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_REG_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, APP_NAME)
                print("Removed autostart entry")
        except FileNotFoundError:
            pass
        except Exception:
            pass

    except Exception as exc:
        print(f"Registry cleanup warning: {exc}")


def remove_install_files(install_dir: Path):
    """Remove installation files."""
    if not install_dir.exists():
        return

    # Don't delete the directory while we're running from it
    # Use a delayed deletion via cmd
    uninstaller = install_dir / "uninstall.exe"
    if uninstaller.exists():
        # Schedule deletion after this process exits
        subprocess.Popen(
            ["cmd", "/c", f"timeout /t 2 /nobreak >nul & rmdir /s /q \"{install_dir}\""],
            shell=True,
            creationflags=subprocess.CREATE_NO_WINDOW
        )
    else:
        try:
            shutil.rmtree(install_dir)
        except Exception as exc:
            print(f"Failed to remove install directory: {exc}")


def main():
    if sys.platform != "win32":
        print("This uninstaller is for Windows only.")
        sys.exit(1)

    if not is_admin():
        run_as_admin()
        return

    install_dir = find_install_dir()

    root = tk.Tk()
    root.withdraw()

    result = messagebox.askyesno(
        f"{APP_NAME} deinstallieren",
        f"Möchten Sie {APP_NAME} wirklich deinstallieren?\n\n"
        f"Installationsverzeichnis: {install_dir}\n\n"
        f"Benutzerdaten (Einstellungen, Logs) werden beibehalten.",
        icon="question"
    )

    if not result:
        sys.exit(0)

    # Confirm file deletion
    messagebox.showinfo(
        f"{APP_NAME} deinstallieren",
        f"{APP_NAME} wird jetzt deinstalliert.\n\n"
        f"Bitte schließen Sie alle laufenden {APP_NAME}-Instanzen.",
    )

    print(f"Uninstalling {APP_NAME} from {install_dir}")

    # Kill running Nox processes
    try:
        subprocess.run(["taskkill", "/f", "/im", "Nox.exe"], capture_output=True)
        subprocess.run(["taskkill", "/f", "/im", "python.exe", "/fi",
                        f"WINDOWTITLE eq *Nox*"], capture_output=True)
    except Exception:
        pass

    remove_shortcuts()
    remove_registry_entries()
    remove_install_files(install_dir)

    messagebox.showinfo(
        f"{APP_NAME} deinstalliert",
        f"{APP_NAME} wurde erfolgreich deinstalliert.\n\n"
        f"Benutzerdaten in %APPDATA%\\Nox wurden beibehalten."
    )

    sys.exit(0)


if __name__ == "__main__":
    main()
