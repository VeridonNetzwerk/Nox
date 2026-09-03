# Nox Installers

Custom installers for Nox — no NSIS, no Inno Setup, no electron-builder for the installer itself.

## Windows Installer (.exe)

A Python-based installer compiled to a standalone `.exe` via PyInstaller.

### Build

```bash
# From the installers/windows/ directory:

# 1. Create payload zip from nox-app
python build_installer.py --create-payload ../../ --payload nox_payload.zip

# 2. Build the installer .exe
python build_installer.py --payload nox_payload.zip

# Output: dist/NoxSetup.exe
```

### What it does

- Shows a GUI wizard (welcome, directory selection, options)
- Extracts the payload zip to the chosen install directory
- Creates Start Menu and Desktop shortcuts
- Registers an uninstaller in the Windows Registry
- Optionally enables autostart
- Requests admin privileges (UAC) automatically

### Uninstaller

The uninstaller (`uninstaller.py`) is also compiled to `uninstall.exe` and placed
alongside the Nox installation. It:
- Removes shortcuts
- Removes Registry entries
- Deletes the installation directory
- Preserves user data in `%APPDATA%\Nox`

## Linux Installer (.deb)

A proper Debian package built with `dpkg-deb`.

### Build

```bash
# From the installers/linux/ directory:
python build_deb.py --nox-app ../../ --output dist/

# Output: dist/nox_0.1.0_amd64.deb
```

### Install

```bash
sudo dpkg -i dist/nox_0.1.0_amd64.deb
# Or:
sudo apt install dist/nox_0.1.0_amd64.deb
```

### What it does

- Installs application files to `/opt/Nox/`
- Creates `/usr/bin/nox` launcher symlink
- Installs `.desktop` file for application menu integration
- Installs icons in `/usr/share/icons/hicolor/`
- `postinst` script installs Python pip dependencies
- `prerm` script kills running Nox processes
- Declares system package dependencies (xdotool, wmctrl, pulseaudio-utils, etc.)

### System Dependencies

The .deb declares dependencies on these system packages:
- `xdotool`, `xprop`, `wmctrl` — X11 window management
- `pulseaudio-utils | pipewire-pulse` — Audio capture
- `at-spi2-core`, `python3-gi`, `gir1.2-atspi-2.0` — AT-SPI2 accessibility
- `xdg-utils` — Default browser/app opening
- Various Electron runtime libraries
