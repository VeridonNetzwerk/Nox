"""Platform utilities — cross-platform OS detection, paths, and helpers.

Centralizes all platform-specific logic so other modules don't need
to repeat os detection or path construction.

Usage:
    from platform_utils import IS_WINDOWS, IS_LINUX, get_app_data_dir, ...
"""

import os
import platform
import sys
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------

IS_WINDOWS = sys.platform == "win32" or platform.system() == "Windows"
IS_LINUX = sys.platform.startswith("linux") or platform.system() == "Linux"
IS_MACOS = sys.platform == "darwin" or platform.system() == "Darwin"

# ---------------------------------------------------------------------------
# Paths — central directory resolution for all Nox modules
# ---------------------------------------------------------------------------


def get_app_data_dir() -> Path:
    """Return the Nox application data directory.

    Windows: %APPDATA%\\Nox  (e.g. C:\\Users\\<user>\\AppData\\Roaming\\Nox)
    Linux:   ~/.config/Nox
    macOS:   ~/Library/Application Support/Nox
    """
    if IS_WINDOWS:
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "Nox"
    elif IS_MACOS:
        return Path.home() / "Library" / "Application Support" / "Nox"
    else:
        # Linux — follow XDG Base Directory spec
        xdg_config = os.environ.get("XDG_CONFIG_HOME", "")
        if xdg_config:
            base = Path(xdg_config)
        else:
            base = Path.home() / ".config"
        return base / "Nox"


def get_logs_dir() -> Path:
    """Return the Nox logs directory."""
    return get_app_data_dir() / "logs"


def get_data_dir() -> Path:
    """Return the Nox data directory (SQLite DBs, install_id, etc.)."""
    return get_app_data_dir() / "data"


def get_config_path() -> Path:
    """Return the path to config.yaml."""
    return get_app_data_dir() / "config.yaml"


def get_autostart_dir() -> Path:
    """Return the autostart directory for the current platform.

    Linux: ~/.config/autostart/
    macOS: ~/Library/LaunchAgents/ (not used directly, but for reference)
    Windows: (uses Registry, not a directory)
    """
    if IS_LINUX:
        xdg_config = os.environ.get("XDG_CONFIG_HOME", "")
        if xdg_config:
            return Path(xdg_config) / "autostart"
        return Path.home() / ".config" / "autostart"
    elif IS_MACOS:
        return Path.home() / "Library" / "LaunchAgents"
    else:
        # Windows uses Registry — this path is not used on Windows
        return get_app_data_dir() / "autostart"


def get_install_dir() -> Path:
    """Return the installation directory (where the app is installed).

    In production: the directory containing the executable.
    In dev: the nox-app directory.
    """
    if getattr(sys, "frozen", False):
        # PyInstaller / packaged mode
        return Path(sys.executable).parent
    else:
        # Dev mode — backend directory's parent
        return Path(__file__).parent.parent


def get_models_dir() -> Path:
    """Return the models directory.

    Production: uses NOX_MODELS_DIR env var (set by Electron).
    Dev: nox-app/models/
    """
    env_models = os.environ.get("NOX_MODELS_DIR")
    if env_models:
        return Path(env_models)
    return Path(__file__).parent.parent / "models"


# ---------------------------------------------------------------------------
# Display server detection (Linux only)
# ---------------------------------------------------------------------------

def get_display_server() -> str:
    """Detect the display server on Linux.

    Returns: 'x11', 'wayland', or 'unknown'
    """
    if not IS_LINUX:
        return "unknown"

    # Check WAYLAND_DISPLAY env var first
    wayland_display = os.environ.get("WAYLAND_DISPLAY", "")
    if wayland_display:
        return "wayland"

    # Check XDG_SESSION_TYPE
    session_type = os.environ.get("XDG_SESSION_TYPE", "")
    if session_type == "wayland":
        return "wayland"
    elif session_type == "x11":
        return "x11"

    # Check if DISPLAY is set (X11)
    if os.environ.get("DISPLAY", ""):
        return "x11"

    return "unknown"


def is_x11() -> bool:
    """True if running on X11."""
    return get_display_server() == "x11"


def is_wayland() -> bool:
    """True if running on Wayland."""
    return get_display_server() == "wayland"


# ---------------------------------------------------------------------------
# Binary availability checks (Linux helpers)
# ---------------------------------------------------------------------------

def is_command_available(command: str) -> bool:
    """Check if a system command is available on PATH."""
    import shutil
    return shutil.which(command) is not None


def get_desktop_environment() -> str:
    """Detect the desktop environment on Linux.

    Returns: 'gnome', 'kde', 'cosmic', 'xfce', 'mate', 'cinnamon', 'unity', or 'unknown'
    """
    if not IS_LINUX:
        return "unknown"

    # XDG_CURRENT_DESKTOP is the most reliable
    xdg_current = os.environ.get("XDG_CURRENT_DESKTOP", "").lower()
    if "gnome" in xdg_current:
        return "gnome"
    elif "kde" in xdg_current:
        return "kde"
    elif "cosmic" in xdg_current:
        return "cosmic"
    elif "xfce" in xdg_current:
        return "xfce"
    elif "mate" in xdg_current:
        return "mate"
    elif "cinnamon" in xdg_current:
        return "cinnamon"
    elif "unity" in xdg_current:
        return "unity"

    # Fallback: check DESKTOP_SESSION
    desktop_session = os.environ.get("DESKTOP_SESSION", "").lower()
    if "gnome" in desktop_session:
        return "gnome"
    elif "kde" in desktop_session or "plasma" in desktop_session:
        return "kde"
    elif "cosmic" in desktop_session:
        return "cosmic"
    elif "xfce" in desktop_session:
        return "xfce"

    return "unknown"


def is_cosmic() -> bool:
    """True if running on the COSMIC desktop environment (Pop!_OS)."""
    return get_desktop_environment() == "cosmic"


# ---------------------------------------------------------------------------
# Screenshot helpers — xdg-desktop-portal D-Bus for Wayland/COSMIC
# ---------------------------------------------------------------------------

def can_screenshot_mss() -> bool:
    """Check if mss can capture screenshots on the current display server.

    mss works on X11 and wlroots-based Wayland compositors (Sway, etc.)
    but NOT on COSMIC (which doesn't implement wlr-screencopy).
    """
    if not IS_LINUX:
        return False
    ds = get_display_server()
    if ds == "x11":
        return True
    # On Wayland, mss only works with wlr-screencopy — not COSMIC, not GNOME
    if ds == "wayland":
        de = get_desktop_environment()
        if de in ("cosmic", "gnome"):
            return False
        # wlroots-based compositors (Sway, Hyprland, etc.) support wlr-screencopy
        return True
    return False


def can_screenshot_portal() -> bool:
    """Check if a Wayland-compatible screenshot method is available.

    Checks for cosmic-screenshot CLI (COSMIC) or xdg-desktop-portal D-Bus.
    """
    if not IS_LINUX:
        return False
    # cosmic-screenshot CLI (preferred on COSMIC)
    if is_command_available("cosmic-screenshot"):
        return True
    # xdg-desktop-portal D-Bus (fallback)
    try:
        import dbus  # type: ignore
        bus = dbus.SessionBus()
        try:
            proxy = bus.get_object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")
            iface = dbus.Interface(proxy, "org.freedesktop.DBus.Properties")
            iface.GetAll("org.freedesktop.portal.Screenshot")
            return True
        except Exception:
            return False
    except ImportError:
        return False
    except Exception:
        return False


def capture_screenshot_portal() -> Optional[bytes]:
    """Capture a screenshot on Wayland (COSMIC/GNOME).

    Uses cosmic-screenshot CLI as primary method (most reliable on COSMIC),
    falls back to xdg-desktop-portal D-Bus if cosmic-screenshot is unavailable.

    Returns JPEG-compressed bytes, or None on failure.
    """
    if not IS_LINUX:
        return None

    # Method 1: cosmic-screenshot CLI (preferred)
    if is_command_available("cosmic-screenshot"):
        try:
            return _capture_via_cosmic_screenshot()
        except Exception:
            pass

    # Method 2: xdg-desktop-portal D-Bus (fallback)
    try:
        return _capture_via_dbus_portal()
    except Exception:
        return None


def _capture_via_cosmic_screenshot() -> Optional[bytes]:
    """Capture screenshot using cosmic-screenshot CLI tool."""
    import subprocess
    import tempfile
    import os as _os

    with tempfile.TemporaryDirectory() as tmpdir:
        result = subprocess.run(
            ["cosmic-screenshot", "--interactive=false", "--modal=false",
             "--notify=false", f"--save-dir={tmpdir}"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return None

        # Find the screenshot file
        png_files = [f for f in _os.listdir(tmpdir) if f.endswith(".png")]
        if not png_files:
            return None

        filepath = _os.path.join(tmpdir, png_files[0])
        from PIL import Image
        img = Image.open(filepath)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        if img.width > 1920:
            ratio = 1920 / img.width
            img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

        import io
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return buf.getvalue()


def _capture_via_dbus_portal() -> Optional[bytes]:
    """Capture screenshot via xdg-desktop-portal D-Bus Screenshot interface."""
    import dbus
    import dbus.mainloop.glib
    from gi.repository import GLib  # type: ignore
    import time as _time
    import threading
    import tempfile
    import os as _os

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    desktop = bus.get_object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")

    handle_token = f"nox_{int(_time.time() * 1000)}"
    loop = GLib.MainLoop()
    result_uri = [None]

    def response_handler(response, results):
        if response == 0 and results:
            uri = results.get("uri", "")
            if uri:
                result_uri[0] = str(uri)
        loop.quit()

    unique_name = bus.get_unique_name()
    sender_path = unique_name.replace(":", "").replace(".", "_")
    response_path = f"/org/freedesktop/portal/desktop/request/{sender_path}/{handle_token}"

    bus.add_signal_receiver(
        response_handler,
        dbus_interface="org.freedesktop.portal.Request",
        path=response_path,
    )

    desktop.Screenshot(
        "",
        {"interactive": dbus.Boolean(False), "handle_token": dbus.String(handle_token)},
        dbus_interface="org.freedesktop.portal.Screenshot",
    )

    timer = threading.Timer(5.0, loop.quit)
    timer.start()
    loop.run()
    timer.cancel()

    if not result_uri[0]:
        return None

    uri = result_uri[0]
    if uri.startswith("file://"):
        filepath = uri[7:]
    else:
        filepath = uri

    from PIL import Image
    img = Image.open(filepath)
    if img.width > 1920:
        ratio = 1920 / img.width
        img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()
