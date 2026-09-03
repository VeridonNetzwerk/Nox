#!/usr/bin/env python3
"""Build the Nox Windows installer .exe from installer.py using PyInstaller.

This script compiles installer.py into a standalone .exe using PyInstaller.
The resulting .exe is a custom installer (NOT NSIS-based).

Prerequisites:
    pip install pyinstaller

Usage:
    python build_installer.py [--payload path/to/nox_payload.zip]

The payload zip should contain the pre-built Nox application files
(backend, ui, assets, models) that will be extracted during installation.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def build_installer(payload_path: str | None = None):
    """Build the installer .exe via PyInstaller."""
    installer_py = Path(__file__).parent / "installer.py"
    if not installer_py.exists():
        print(f"ERROR: {installer_py} not found")
        sys.exit(1)

    output_dir = Path(__file__).parent / "dist"
    output_dir.mkdir(exist_ok=True)

    # PyInstaller command
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--windowed",
        "--name", "NoxSetup",
        "--distpath", str(output_dir),
        "--workpath", str(Path(__file__).parent / "build"),
        "--specpath", str(Path(__file__).parent / "build"),
        "--uac-admin",
        "--clean",
        "--noconfirm",
    ]

    # Add icon if available
    icon_path = Path(__file__).parent.parent.parent / "assets" / "branding" / "icon.ico"
    if icon_path.exists():
        cmd += ["--icon", str(icon_path)]

    # Add payload as a data file if specified
    if payload_path:
        payload = Path(payload_path)
        if not payload.exists():
            print(f"ERROR: Payload not found: {payload}")
            sys.exit(1)
        cmd += ["--add-data", f"{payload};."]

    cmd.append(str(installer_py))

    print(f"Running PyInstaller...")
    print(f"  Command: {' '.join(cmd)}")
    result = subprocess.run(cmd)

    if result.returncode == 0:
        exe_path = output_dir / "NoxSetup.exe"
        if exe_path.exists():
            print(f"\n✓ Installer built successfully: {exe_path}")
            print(f"  Size: {exe_path.stat().st_size / 1024 / 1024:.1f} MB")
        else:
            print(f"\n✓ Build completed. Check {output_dir} for the .exe")
    else:
        print(f"\n✗ Build failed with exit code {result.returncode}")
        sys.exit(1)


def create_payload(nox_app_dir: str, output_path: str | None = None):
    """Create a payload zip from the Nox application directory."""
    nox_app = Path(nox_app_dir)
    if not nox_app.exists():
        print(f"ERROR: Nox app directory not found: {nox_app}")
        sys.exit(1)

    if output_path:
        payload = Path(output_path)
    else:
        payload = Path(__file__).parent / "nox_payload.zip"

    print(f"Creating payload zip: {payload}")
    print(f"  Source: {nox_app}")

    import zipfile
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # Backend
        backend = nox_app / "backend"
        if backend.exists():
            for f in backend.rglob("*"):
                if f.is_file() and "__pycache__" not in str(f) and ".pyc" not in str(f):
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)
                    print(f"  + {arcname}")

        # UI dist (built frontend)
        ui_dist = nox_app / "ui" / "dist"
        if ui_dist.exists():
            for f in ui_dist.rglob("*"):
                if f.is_file():
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)

        # Electron files
        electron = nox_app / "ui" / "electron"
        if electron.exists():
            for f in electron.rglob("*"):
                if f.is_file():
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)

        # Assets
        assets = nox_app / "assets"
        if assets.exists():
            for f in assets.rglob("*"):
                if f.is_file():
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)

        # Models
        models = nox_app / "models"
        if models.exists():
            for f in models.rglob("*"):
                if f.is_file():
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)

        # Shared config
        shared = nox_app / "shared"
        if shared.exists():
            for f in shared.rglob("*"):
                if f.is_file():
                    arcname = f.relative_to(nox_app)
                    zf.write(f, arcname)

    print(f"\n✓ Payload created: {payload} ({payload.stat().st_size / 1024 / 1024:.1f} MB)")
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Nox Windows installer .exe")
    parser.add_argument("--payload", help="Path to nox_payload.zip (pre-built)")
    parser.add_argument("--create-payload", help="Create payload zip from Nox app directory")
    parser.add_argument("--nox-app", default="../..", help="Path to nox-app directory (for payload creation)")
    args = parser.parse_args()

    if args.create_payload:
        create_payload(args.create_payload, args.payload)
    else:
        build_installer(args.payload)
