#!/usr/bin/env python3
"""Nox — Custom Windows Installer (Python-based, NOT NSIS).

This script is compiled to a standalone .exe via PyInstaller.
It provides a simple GUI installer that:
1. Shows a welcome screen
2. Lets the user choose an installation directory
3. Copies pre-built Nox files to the destination
4. Creates Start Menu and Desktop shortcuts
5. Registers an uninstaller in the Windows Registry
6. Optionally enables autostart

Build:
    python build_installer.py
"""

import ctypes
import os
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import zipfile
import json

APP_NAME = "Nox"
APP_VERSION = "0.1.0"
APP_PUBLISHER = "Nox"
APP_URL = "https://github.com/NoxAI/Nox"

# Registry key for uninstall information
UNINSTALL_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Nox"

# Default install location
DEFAULT_INSTALL_DIR = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Nox")


def is_admin() -> bool:
    """Check if running with administrator privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def run_as_admin():
    """Re-launch the current process with admin privileges."""
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit(0)


class InstallerApp:
    """Main installer GUI application."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} Installer")
        self.root.geometry("560x420")
        self.root.resizable(False, False)

        # Center window on screen
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 560) // 2
        y = (self.root.winfo_screenheight() - 420) // 2
        self.root.geometry(f"+{x}+{y}")

        self.install_dir = tk.StringVar(value=DEFAULT_INSTALL_DIR)
        self.create_start_menu = tk.BooleanVar(value=True)
        self.create_desktop = tk.BooleanVar(value=True)
        self.enable_autostart = tk.BooleanVar(value=False)
        self.installing = False

        self._build_ui()

    def _build_ui(self):
        """Build the installer UI."""
        # Header
        header_frame = tk.Frame(self.root, bg="#1a1a2e", height=80)
        header_frame.pack(fill="x")
        header_frame.pack_propagate(False)

        tk.Label(
            header_frame, text=APP_NAME, font=("Segoe UI", 24, "bold"),
            bg="#1a1a2e", fg="#e94560"
        ).pack(side="left", padx=20)

        tk.Label(
            header_frame, text=f"v{APP_VERSION}", font=("Segoe UI", 11),
            bg="#1a1a2e", fg="#888"
        ).pack(side="left", pady=(20, 0))

        # Content
        content = tk.Frame(self.root, padx=30, pady=20)
        content.pack(fill="both", expand=True)

        # Welcome text
        tk.Label(
            content,
            text=f"Willkommen zum {APP_NAME} Installer!\n\n"
                 f"{APP_NAME} ist ein lokaler KI-Desktop-Assistent.\n"
                 f"Alle Modelle laufen lokal — keine Cloud erforderlich.",
            font=("Segoe UI", 10), justify="left"
        ).pack(anchor="w", pady=(0, 15))

        # Install directory
        dir_frame = tk.LabelFrame(content, text="Installationsverzeichnis", padx=10, pady=10)
        dir_frame.pack(fill="x", pady=(0, 10))

        tk.Entry(dir_frame, textvariable=self.install_dir, width=50).pack(side="left", padx=(0, 5))
        tk.Button(dir_frame, text="Durchsuchen...", command=self._browse_dir).pack(side="left")

        # Options
        opts_frame = tk.LabelFrame(content, text="Optionen", padx=10, pady=10)
        opts_frame.pack(fill="x", pady=(0, 10))

        tk.Checkbutton(opts_frame, text="Start-Menü Verknüpfung erstellen",
                       variable=self.create_start_menu).pack(anchor="w")
        tk.Checkbutton(opts_frame, text="Desktop-Verknüpfung erstellen",
                       variable=self.create_desktop).pack(anchor="w")
        tk.Checkbutton(opts_frame, text="Autostart aktivieren (mit Windows starten)",
                       variable=self.enable_autostart).pack(anchor="w")

        # Buttons
        btn_frame = tk.Frame(content)
        btn_frame.pack(fill="x", pady=(10, 0))

        tk.Button(btn_frame, text="Abbrechen", command=self.root.destroy,
                  width=12).pack(side="right", padx=(5, 0))
        self.install_btn = tk.Button(btn_frame, text="Installieren", command=self._start_install,
                                     width=12, bg="#e94560", fg="white", font=("Segoe UI", 10, "bold"))
        self.install_btn.pack(side="right")

        # Progress bar (hidden initially)
        self.progress = ttk.Progressbar(content, mode="determinate", length=480)
        self.status_label = tk.Label(content, text="", font=("Segoe UI", 9), fg="#666")
        self.log_text = tk.Text(content, height=6, font=("Consolas", 8), state="disabled",
                                bg="#f5f5f5", relief="sunken")

    def _browse_dir(self):
        """Open directory browser dialog."""
        d = filedialog.askdirectory(initialdir=self.install_dir.get(),
                                    title="Installationsverzeichnis wählen")
        if d:
            self.install_dir.set(d)

    def _log(self, msg: str):
        """Append a message to the log text widget."""
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")
        self.root.update_idletasks()

    def _start_install(self):
        """Start the installation process in a background thread."""
        if self.installing:
            return
        self.installing = True
        self.install_btn.config(state="disabled")

        # Show progress UI
        self.progress.pack(pady=(10, 5))
        self.status_label.pack(anchor="w")
        self.log_text.pack(fill="both", expand=True, pady=(5, 0))
        self.progress["value"] = 0

        threading.Thread(target=self._do_install, daemon=True).start()

    def _do_install(self):
        """Perform the actual installation."""
        try:
            install_dir = Path(self.install_dir.get())
            self._set_status("Erstelle Verzeichnis...")
            self._log(f"Installiere nach: {install_dir}")
            install_dir.mkdir(parents=True, exist_ok=True)
            self.progress["value"] = 5

            # Copy bundled files (the payload is embedded as a zip alongside the exe)
            payload_path = Path(sys.executable).parent / "nox_payload.zip"
            if not payload_path.exists():
                # Dev mode: look for payload in current directory
                payload_path = Path("nox_payload.zip")

            if payload_path.exists():
                self._set_status("Entpacke Dateien...")
                self._log(f"Entpacke {payload_path.name}...")
                with zipfile.ZipFile(payload_path, "r") as zf:
                    members = zf.namelist()
                    total = len(members)
                    for i, member in enumerate(members):
                        zf.extract(member, install_dir)
                        pct = 5 + int((i + 1) / total * 70)
                        self.progress["value"] = pct
                        if (i + 1) % 50 == 0:
                            self._log(f"  {i+1}/{total} Dateien entpackt...")
                self._log("Dateien erfolgreich entpackt.")
            else:
                self._log("WARNUNG: nox_payload.zip nicht gefunden — überspringe Dateikopie.")
                # In dev mode, copy from nox-app directory
                nox_app = Path(__file__).parent.parent.parent
                if nox_app.exists():
                    self._log(f"Kopiere aus Entwicklungsverzeichnis: {nox_app}")
                    # Copy backend
                    backend_src = nox_app / "backend"
                    if backend_src.exists():
                        shutil.copytree(backend_src, install_dir / "backend",
                                        dirs_exist_ok=True, ignore=shutil.ignore_patterns(
                                            "__pycache__", "*.pyc", ".git", "tests"))
                    # Copy UI dist
                    ui_dist = nox_app / "ui" / "dist"
                    if ui_dist.exists():
                        shutil.copytree(ui_dist, install_dir / "ui" / "dist",
                                        dirs_exist_ok=True)
                    # Copy electron files
                    electron_src = nox_app / "ui" / "electron"
                    if electron_src.exists():
                        shutil.copytree(electron_src, install_dir / "ui" / "electron",
                                        dirs_exist_ok=True)
                    # Copy assets
                    assets_src = nox_app / "assets"
                    if assets_src.exists():
                        shutil.copytree(assets_src, install_dir / "assets",
                                        dirs_exist_ok=True)
                    # Copy models
                    models_src = nox_app / "models"
                    if models_src.exists():
                        shutil.copytree(models_src, install_dir / "models",
                                        dirs_exist_ok=True)

            self.progress["value"] = 80

            # Create shortcuts
            nox_exe = install_dir / "Nox.exe"
            if not nox_exe.exists():
                # Look for Nox.exe in subdirectories
                for p in install_dir.rglob("Nox.exe"):
                    nox_exe = p
                    break

            if self.create_start_menu.get():
                self._set_status("Erstelle Start-Menü Verknüpfung...")
                self._create_start_menu_shortcut(nox_exe)
                self._log("Start-Menü Verknüpfung erstellt.")

            if self.create_desktop.get():
                self._set_status("Erstelle Desktop-Verknüpfung...")
                self._create_desktop_shortcut(nox_exe)
                self._log("Desktop-Verknüpfung erstellt.")

            self.progress["value"] = 90

            # Register uninstaller
            self._set_status("Registriere Deinstallationsprogramm...")
            self._register_uninstaller(install_dir, nox_exe)
            self._log("Deinstallationsprogramm registriert.")

            # Autostart
            if self.enable_autostart.get():
                self._set_status("Aktiviere Autostart...")
                self._enable_autostart(nox_exe)
                self._log("Autostart aktiviert.")

            self.progress["value"] = 100
            self._set_status("Installation abgeschlossen!")
            self._log(f"\n{APP_NAME} wurde erfolgreich installiert!")
            self._log(f"Installationsverzeichnis: {install_dir}")

            # Show completion
            self.root.after(500, self._show_completion)

        except Exception as exc:
            self._log(f"\nFEHLER: {exc}")
            self._set_status("Installation fehlgeschlagen!")
            messagebox.showerror("Fehler", f"Installation fehlgeschlagen:\n{exc}", parent=self.root)
            self.installing = False
            self.root.after(1000, lambda: self.install_btn.config(state="normal"))

    def _set_status(self, text: str):
        """Update the status label."""
        self.status_label.config(text=text)
        self.root.update_idletasks()

    def _create_shortcut(self, target: Path, shortcut_path: Path, description: str = ""):
        """Create a Windows .lnk shortcut using PowerShell."""
        try:
            ps_script = (
                f"$ws = New-Object -ComObject WScript.Shell; "
                f"$sc = $ws.CreateShortcut('{shortcut_path}'); "
                f"$sc.TargetPath = '{target}'; "
                f"$sc.WorkingDirectory = '{target.parent}'; "
                f"$sc.Description = '{description}'; "
                f"$sc.Save()"
            )
            subprocess.run(
                ["powershell", "-Command", ps_script],
                capture_output=True, timeout=10
            )
        except Exception as exc:
            self._log(f"  Shortcut creation warning: {exc}")

    def _create_start_menu_shortcut(self, nox_exe: Path):
        """Create Start Menu shortcut."""
        start_menu = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
        shortcut = start_menu / f"{APP_NAME}.lnk"
        self._create_shortcut(nox_exe, shortcut, f"{APP_NAME} — Local AI Desktop Assistant")

    def _create_desktop_shortcut(self, nox_exe: Path):
        """Create Desktop shortcut."""
        desktop = Path.home() / "Desktop"
        shortcut = desktop / f"{APP_NAME}.lnk"
        self._create_shortcut(nox_exe, shortcut, f"{APP_NAME} — Local AI Desktop Assistant")

    def _register_uninstaller(self, install_dir: Path, nox_exe: Path):
        """Register uninstaller in Windows Registry."""
        try:
            import winreg

            uninstaller_path = install_dir / "uninstall.exe"

            with winreg.CreateKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL_REG_KEY) as key:
                winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
                winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
                winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, APP_PUBLISHER)
                winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, str(nox_exe))
                winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, str(install_dir))
                winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, str(uninstaller_path))
                winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
                winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)

        except PermissionError:
            self._log("  WARNUNG: Keine Admin-Rechte für HKLM — versuche HKCU...")
            try:
                import winreg
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_REG_KEY) as key:
                    winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
                    winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
                    winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, APP_PUBLISHER)
                    winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, str(nox_exe))
                    winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, str(install_dir))
                    winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, str(uninstaller_path))
                    winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
                    winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
            except Exception as exc:
                self._log(f"  Registry registration failed: {exc}")
        except Exception as exc:
            self._log(f"  Registry registration failed: {exc}")

    def _enable_autostart(self, nox_exe: Path):
        """Enable autostart via Windows Registry Run key."""
        try:
            import winreg
            run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, run_key, 0, winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, str(nox_exe))
        except Exception as exc:
            self._log(f"  Autostart registration failed: {exc}")

    def _show_completion(self):
        """Show completion dialog."""
        result = messagebox.askyesno(
            "Installation abgeschlossen",
            f"{APP_NAME} wurde erfolgreich installiert!\n\n"
            f"Möchten Sie {APP_NAME} jetzt starten?",
            parent=self.root
        )
        if result:
            nox_exe = Path(self.install_dir.get()) / "Nox.exe"
            if nox_exe.exists():
                subprocess.Popen([str(nox_exe)])
            self.root.destroy()
        else:
            self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    if sys.platform != "win32":
        print("This installer is for Windows only.")
        sys.exit(1)

    # Request admin privileges if not already elevated
    if not is_admin():
        run_as_admin()
        return

    app = InstallerApp()
    app.run()


if __name__ == "__main__":
    main()
