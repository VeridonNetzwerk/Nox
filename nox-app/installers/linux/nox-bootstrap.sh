#!/bin/bash
# Nox bootstrap launcher — ensures Electron is available, then starts Nox.
# On first run, downloads Electron binary automatically and injects app.asar.

NOX_DIR="/opt/Nox"
ELECTRON_RESOURCES="$NOX_DIR/electron/resources"
APP_ASAR="$ELECTRON_RESOURCES/app.asar"
ELECTRON_CACHE_DIR="$HOME/.cache/nox-electron"
ELECTRON_VERSION="33.4.11"
ELECTRON_EXTRACT_DIR="$ELECTRON_CACHE_DIR/electron-v$ELECTRON_VERSION-linux-x64"
ELECTRON_BIN="$ELECTRON_EXTRACT_DIR/electron"
ELECTRON_BIN_RESOURCES="$ELECTRON_EXTRACT_DIR/resources"

# --- Check for pre-built Electron binary (from electron-builder) ---
if [ -x "$NOX_DIR/electron/nox-ui" ]; then
    exec "$NOX_DIR/electron/nox-ui" --no-sandbox "$@"
fi
if [ -x "$NOX_DIR/electron/nox" ]; then
    exec "$NOX_DIR/electron/nox" --no-sandbox "$@"
fi

# --- Check for cached Electron binary ---
if [ -x "$ELECTRON_BIN" ]; then
    # Ensure app.asar is in the Electron's resources
    if [ -f "$APP_ASAR" ] && [ ! -f "$ELECTRON_BIN_RESOURCES/app.asar" ]; then
        cp "$APP_ASAR" "$ELECTRON_BIN_RESOURCES/app.asar"
    fi
    if [ -f "$ELECTRON_BIN_RESOURCES/app.asar" ]; then
        exec "$ELECTRON_BIN" --no-sandbox "$@"
    fi
fi

# --- Check for system electron ---
if command -v electron &>/dev/null; then
    # System electron: run with app path pointing to our resources
    if [ -f "$APP_ASAR" ]; then
        exec electron --no-sandbox --app-path="$ELECTRON_RESOURCES" "$@"
    else
        echo "Nox: app.asar not found at $APP_ASAR"
        exit 1
    fi
fi

# --- Download Electron on first run ---
echo "Nox: Electron not found. Downloading Electron v$ELECTRON_VERSION..."
mkdir -p "$ELECTRON_CACHE_DIR"

URL="https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-x64.zip"
ZIP_FILE="$ELECTRON_CACHE_DIR/electron-v$ELECTRON_VERSION-linux-x64.zip"

if command -v wget &>/dev/null; then
    wget -q --show-progress -O "$ZIP_FILE" "$URL"
elif command -v curl &>/dev/null; then
    curl -L --progress-bar -o "$ZIP_FILE" "$URL"
else
    echo "Error: Need wget or curl to download Electron."
    echo "Please install: sudo apt install wget"
    exit 1
fi

if [ $? -ne 0 ]; then
    echo "Error: Failed to download Electron."
    rm -f "$ZIP_FILE"
    exit 1
fi

# Extract
if command -v unzip &>/dev/null; then
    unzip -q -o "$ZIP_FILE" -d "$ELECTRON_EXTRACT_DIR"
    rm "$ZIP_FILE"
else
    echo "Error: Need 'unzip' to extract Electron."
    echo "Please install: sudo apt install unzip"
    exit 1
fi

chmod +x "$ELECTRON_BIN"

if [ ! -x "$ELECTRON_BIN" ]; then
    echo "Error: Electron extraction failed."
    exit 1
fi

# Copy app.asar into Electron's resources directory so isPackaged=true
if [ -f "$APP_ASAR" ]; then
    mkdir -p "$ELECTRON_BIN_RESOURCES"
    cp "$APP_ASAR" "$ELECTRON_BIN_RESOURCES/app.asar"
    echo "Nox: app.asar injected into Electron resources."
else
    echo "Nox: WARNING — app.asar not found at $APP_ASAR"
    echo "Nox: Falling back to unpackaged mode (some features may not work)."
    cd "$NOX_DIR/ui"
    exec "$ELECTRON_BIN" --no-sandbox "$@" .
fi

echo "Nox: Electron ready. Starting Nox..."
exec "$ELECTRON_BIN" --no-sandbox "$@"
