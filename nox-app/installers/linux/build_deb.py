#!/usr/bin/env python3
"""Build a .deb package for Nox on Linux.

Creates a proper Debian package with:
- Application files in /opt/Nox/
- Binary symlink in /usr/bin/nox
- .desktop file in /usr/share/applications/
- Icons in /usr/share/icons/hicolor/
- postinst script for system dependency installation
- prerm script for clean removal

Usage:
    python build_deb.py [--nox-app path/to/nox-app] [--output dist/]

Requirements:
    - dpkg-deb (available on any Debian/Ubuntu system)
    - Pre-built Nox application (backend + UI dist)
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

APP_NAME = "nox"
APP_VERSION = "0.1.0"
APP_MAINTAINER = "Nox <noreply@nox.ai>"
APP_DESCRIPTION = "Local AI Desktop Assistant"
APP_HOMEPAGE = "https://github.com/NoxAI/Nox"

# Debian dependencies (system packages)
DEPENDS = [
    "python3",
    "python3-pip",
    # Audio (PortAudio for sounddevice Python package)
    "portaudio19-dev",
    # X11 window management
    "xdotool",
    "x11-utils",  # provides xprop
    "wmctrl",
    # Audio
    "pulseaudio-utils | pipewire-pulse",
    # Clipboard — xclip for X11, wl-clipboard for Wayland/COSMIC
    "xclip",
    "wl-clipboard",
    # Screenshots — xdg-desktop-portal for Wayland/COSMIC
    "xdg-desktop-portal",
    # AT-SPI2 accessibility (Wayland window info, UI text extraction)
    "at-spi2-core",
    "python3-gi",
    "gir1.2-atspi-2.0",
    # D-Bus Python bindings (for xdg-desktop-portal screenshot)
    "python3-dbus",
    # Electron runtime libraries
    "xdg-utils",
    "libgtk-3-0",
    "libnotify4",
    "libnss3",
    "libxss1",
    "libasound2",
    "libgbm1",
    "libxkbcommon0",
    "libdrm2",
    "libatk-bridge2.0-0",
    "libatk1.0-0",
    # COSMIC screenshot tool
    "cosmic-screenshot",
    # Bootstrap launcher needs wget + unzip to download Electron on first run
    "wget",
    "unzip",
]


def build_deb(nox_app_dir: Path, output_dir: Path):
    """Build the .deb package."""
    if not nox_app_dir.exists():
        print(f"ERROR: Nox app directory not found: {nox_app_dir}")
        sys.exit(1)

    # Create temporary build directory
    build_dir = Path("build_deb_tmp")
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir()

    # Debian package structure
    pkg_root = build_dir / f"{APP_NAME}_{APP_VERSION}_amd64"
    pkg_root.mkdir()

    # --- Control files ---
    control_dir = pkg_root / "DEBIAN"
    control_dir.mkdir()

    # control file
    control_content = f"""Package: {APP_NAME}
Version: {APP_VERSION}
Architecture: amd64
Maintainer: {APP_MAINTAINER}
Depends: {', '.join(DEPENDS)}
Section: utils
Priority: optional
Homepage: {APP_HOMEPAGE}
Description: {APP_DESCRIPTION}
 {APP_NAME} is a fully local, voice-enabled AI desktop assistant.
 All AI models run on the machine — no cloud required after installation.
"""
    (control_dir / "control").write_text(control_content)
    os.chmod(control_dir / "control", 0o644)

    # postinst — runs after installation
    postinst = """#!/bin/bash
set -e

# Update desktop database
update-desktop-database -q /usr/share/applications/ 2>/dev/null || true

# Update icon cache
gtk-update-icon-cache -q /usr/share/icons/hicolor/ 2>/dev/null || true

echo "Nox installed successfully!"
echo "Find it in your application menu or run 'nox' from terminal."
echo "On first run, Nox will download Electron and install Python dependencies automatically."

exit 0
"""
    (control_dir / "postinst").write_text(postinst)
    os.chmod(control_dir / "postinst", 0o755)

    # prerm — runs before removal
    prerm = """#!/bin/bash
set -e

# Kill any running Nox processes
pkill -f "Nox" 2>/dev/null || true
pkill -f "nox" 2>/dev/null || true

exit 0
"""
    (control_dir / "prerm").write_text(prerm)
    os.chmod(control_dir / "prerm", 0o755)

    # postrm — runs after removal
    postrm = """#!/bin/bash
set -e

# Remove user config (optional — ask user? For now, keep it)
# rm -rf ~/.config/Nox 2>/dev/null || true

# Update desktop database
update-desktop-database -q /usr/share/applications/ 2>/dev/null || true

echo "Nox has been removed."

exit 0
"""
    (control_dir / "postrm").write_text(postrm)
    os.chmod(control_dir / "postrm", 0o755)

    # --- Application files ---
    opt_dir = pkg_root / "opt" / "Nox"
    opt_dir.mkdir(parents=True)

    # Copy backend
    backend_src = nox_app_dir / "backend"
    if backend_src.exists():
        print("Copying backend...")
        shutil.copytree(backend_src, opt_dir / "backend",
                        ignore=shutil.ignore_patterns(
                            "__pycache__", "*.pyc", ".git", "tests",
                            "*.egg-info", ".venv", "venv",
                            ".build-cache", ".pytest_cache", ".mypy_cache",
                            ".ruff_cache", "*.log", "logs",
                            "node_modules", ".npm", ".cache",
                            "dist-backend", "build"))

    # --- Build app.asar (Electron app bundle) ---
    # The app.asar contains electron source + built UI dist + package.json.
    # This makes app.isPackaged=true so bootstrap server and backend spawning work.
    ui_dist = nox_app_dir / "ui" / "dist"
    electron_src = nox_app_dir / "ui" / "electron"
    pkg_json = nox_app_dir / "ui" / "package.json"

    if ui_dist.exists() and electron_src.exists() and pkg_json.exists():
        print("Building app.asar...")
        asar_build = build_dir / "asar_build"
        asar_build.mkdir()
        shutil.copytree(electron_src, asar_build / "electron",
                        ignore=shutil.ignore_patterns("node_modules", ".cache"))
        shutil.copytree(ui_dist, asar_build / "dist")
        shutil.copy(pkg_json, asar_build / "package.json")

        asar_out = build_dir / "app.asar"
        result = subprocess.run(
            ["npx", "--yes", "@electron/asar", "pack", str(asar_build), str(asar_out)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0 and asar_out.exists():
            print(f"  app.asar built: {asar_out.stat().st_size / 1024 / 1024:.1f} MB")
            # Install app.asar into /opt/Nox/electron/resources/
            electron_resources = opt_dir / "electron" / "resources"
            electron_resources.mkdir(parents=True)
            shutil.copy(asar_out, electron_resources / "app.asar")
        else:
            print(f"  WARNING: app.asar build failed: {result.stderr}")
            print("  Falling back to unpackaged mode (electron source files)")
            shutil.copytree(electron_src, opt_dir / "ui" / "electron",
                            ignore=shutil.ignore_patterns("node_modules", ".cache"))
            shutil.copytree(ui_dist, opt_dir / "ui" / "dist")
            shutil.copy(pkg_json, opt_dir / "ui" / "package.json")
        shutil.rmtree(asar_build)
    else:
        print("WARNING: UI dist or electron source not found — skipping app.asar")
        if ui_dist.exists():
            shutil.copytree(ui_dist, opt_dir / "ui" / "dist")
        if electron_src.exists():
            shutil.copytree(electron_src, opt_dir / "ui" / "electron",
                            ignore=shutil.ignore_patterns("node_modules", ".cache"))
        if pkg_json.exists():
            shutil.copy(pkg_json, opt_dir / "ui" / "package.json")

    # Copy assets
    assets_src = nox_app_dir / "assets"
    if assets_src.exists():
        print("Copying assets...")
        shutil.copytree(assets_src, opt_dir / "assets",
                        ignore=shutil.ignore_patterns("node_modules", ".cache"))

    # Copy models
    models_src = nox_app_dir / "models"
    if models_src.exists():
        print("Copying models...")
        shutil.copytree(models_src, opt_dir / "models")

    # Copy shared config
    shared_src = nox_app_dir / "shared"
    if shared_src.exists():
        print("Copying shared config...")
        shutil.copytree(shared_src, opt_dir / "shared")

    # --- Launcher script (bootstrap — auto-downloads Electron on first run) ---
    bin_dir = pkg_root / "usr" / "bin"
    bin_dir.mkdir(parents=True)

    # Read the bootstrap script from file
    bootstrap_src = Path(__file__).parent / "nox-bootstrap.sh"
    if bootstrap_src.exists():
        launcher = bootstrap_src.read_text()
    else:
        # Inline fallback (should rarely be used — nox-bootstrap.sh should exist)
        launcher = """#!/bin/bash
NOX_DIR="/opt/Nox"
APP_ASAR="$NOX_DIR/electron/resources/app.asar"
ELECTRON_CACHE_DIR="$HOME/.cache/nox-electron"
ELECTRON_VERSION="33.4.11"
ELECTRON_EXTRACT_DIR="$ELECTRON_CACHE_DIR/electron-v$ELECTRON_VERSION-linux-x64"
ELECTRON_BIN="$ELECTRON_EXTRACT_DIR/electron"
ELECTRON_BIN_RESOURCES="$ELECTRON_EXTRACT_DIR/resources"

if [ -x "$NOX_DIR/electron/nox-ui" ]; then
    exec "$NOX_DIR/electron/nox-ui" --no-sandbox "$@"
fi
if [ -x "$ELECTRON_BIN" ]; then
    if [ -f "$APP_ASAR" ] && [ ! -f "$ELECTRON_BIN_RESOURCES/app.asar" ]; then
        cp "$APP_ASAR" "$ELECTRON_BIN_RESOURCES/app.asar"
    fi
    if [ -f "$ELECTRON_BIN_RESOURCES/app.asar" ]; then
        exec "$ELECTRON_BIN" --no-sandbox "$@"
    fi
fi
if command -v electron &>/dev/null; then
    if [ -f "$APP_ASAR" ]; then
        exec electron --no-sandbox --app-path="$NOX_DIR/electron/resources" "$@"
    fi
fi

echo "Nox: Downloading Electron v$ELECTRON_VERSION..."
mkdir -p "$ELECTRON_CACHE_DIR"
URL="https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-x64.zip"
ZIP_FILE="$ELECTRON_CACHE_DIR/electron-v$ELECTRON_VERSION-linux-x64.zip"
if command -v wget &>/dev/null; then
    wget -q --show-progress -O "$ZIP_FILE" "$URL"
elif command -v curl &>/dev/null; then
    curl -L --progress-bar -o "$ZIP_FILE" "$URL"
else
    echo "Error: Need wget or curl. Install: sudo apt install wget"
    exit 1
fi
unzip -q -o "$ZIP_FILE" -d "$ELECTRON_EXTRACT_DIR"
rm "$ZIP_FILE"
chmod +x "$ELECTRON_BIN"
if [ -f "$APP_ASAR" ]; then
    mkdir -p "$ELECTRON_BIN_RESOURCES"
    cp "$APP_ASAR" "$ELECTRON_BIN_RESOURCES/app.asar"
    exec "$ELECTRON_BIN" --no-sandbox "$@"
fi
cd "$NOX_DIR/ui" && exec "$ELECTRON_BIN" --no-sandbox "$@" .
"""
    (bin_dir / "nox").write_text(launcher)
    os.chmod(bin_dir / "nox", 0o755)

    # --- .desktop file ---
    apps_dir = pkg_root / "usr" / "share" / "applications"
    apps_dir.mkdir(parents=True)

    desktop_entry = f"""[Desktop Entry]
Type=Application
Name=Nox
Comment={APP_DESCRIPTION}
Exec=nox %f
Icon=nox
Terminal=false
Categories=Utility;AI;Assistant;
Keywords=AI;assistant;voice;local;
StartupNotify=true
StartupWMClass=Nox
"""
    (apps_dir / "nox.desktop").write_text(desktop_entry)
    os.chmod(apps_dir / "nox.desktop", 0o644)

    # --- Icons ---
    icons_src = nox_app_dir / "assets" / "branding"
    icon_sizes = {
        "16x16": "icon_16x16.png",
        "32x32": "icon_32x32.png",
        "48x48": "icon_48x48.png",
        "128x128": "icon_128x128.png",
        "256x256": "icon_256x256.png",
        "512x512": "icon_512x512.png",
        "1024x1024": "icon_1024x1024.png",
    }

    # Load the largest available icon for generating missing sizes
    fallback_icon = None
    for size_name in ["1024x1024", "512x512", "256x256"]:
        fname = icon_sizes.get(size_name)
        if fname and (icons_src / fname).exists():
            try:
                from PIL import Image as _Img
                fallback_icon = _Img.open(icons_src / fname)
                print(f"Using {fname} as fallback for missing icon sizes")
            except Exception:
                pass
            break

    for size, filename in icon_sizes.items():
        icon_file = icons_src / filename
        icon_dir = pkg_root / "usr" / "share" / "icons" / "hicolor" / size / "apps"
        icon_dir.mkdir(parents=True)
        if icon_file.exists():
            shutil.copy(icon_file, icon_dir / "nox.png")
        elif fallback_icon is not None:
            # Generate from larger icon
            try:
                px = int(size.split("x")[0])
                resized = fallback_icon.resize((px, px), _Img.LANCZOS)
                if resized.mode in ("RGBA", "LA", "P"):
                    resized = resized.convert("RGB")
                resized.save(icon_dir / "nox.png", "PNG")
                print(f"Generated {size} icon from fallback")
            except Exception as e:
                print(f"Warning: Could not generate {size} icon: {e}")

    # Also install a scalable SVG if available
    svg_icon = icons_src / "icon.svg"
    if svg_icon.exists():
        svg_dir = pkg_root / "usr" / "share" / "icons" / "hicolor" / "scalable" / "apps"
        svg_dir.mkdir(parents=True)
        shutil.copy(svg_icon, svg_dir / "nox.svg")

    # --- Build the .deb ---
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nBuilding .deb package...")
    pkg_name = f"{APP_NAME}_{APP_VERSION}_amd64"
    result = subprocess.run(
        ["dpkg-deb", "--build", pkg_name, str(output_dir / f"{APP_NAME}_{APP_VERSION}_amd64.deb")],
        cwd=str(build_dir)
    )

    if result.returncode == 0:
        deb_path = output_dir / f"{APP_NAME}_{APP_VERSION}_amd64.deb"
        print(f"\n✓ .deb package built: {deb_path}")
        print(f"  Size: {deb_path.stat().st_size / 1024 / 1024:.1f} MB")
        print(f"\nInstall with: sudo dpkg -i {deb_path}")
        print(f"Or: sudo apt install {deb_path}")
    else:
        print(f"\n✗ dpkg-deb failed with exit code {result.returncode}")
        sys.exit(1)

    # Cleanup
    shutil.rmtree(build_dir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Nox .deb package for Linux")
    parser.add_argument("--nox-app", default="../..",
                        help="Path to nox-app directory (default: ../..)")
    parser.add_argument("--output", default="dist",
                        help="Output directory for .deb file (default: dist)")
    args = parser.parse_args()

    nox_app = Path(args.nox_app).resolve()
    output = Path(args.output).resolve()

    build_deb(nox_app, output)
