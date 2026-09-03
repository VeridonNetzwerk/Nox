"""AT-SPI2 compatibility layer — works with both pyatspi and gi.repository.Atspi.

On systems where pyatspi is not installable (e.g. Pop!_OS COSMIC with newer
gir1.2-atspi-2.0 than python3-pyatspi supports), this module provides a
unified API by wrapping gi.repository.Atspi to match the pyatspi interface.

Usage:
    from atspi_compat import get_desktop, STATE_ACTIVE, ROLE_PASSWORD_TEXT, ...

Other modules should use this instead of `import pyatspi` directly.
"""

import logging
from typing import Optional

logger = logging.getLogger("nox.atspi")

# Try pyatspi first, then fall back to gi.repository.Atspi
_USE_GI = False

try:
    import pyatspi
    _AVAILABLE = True
    _BACKEND = "pyatspi"
except ImportError:
    try:
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi as _Atspi
        _AVAILABLE = True
        _USE_GI = True
        _BACKEND = "gi.Atspi"
    except Exception:
        _AVAILABLE = False
        _BACKEND = "none"


def is_available() -> bool:
    return _AVAILABLE


def get_backend() -> str:
    return _BACKEND


# ---------------------------------------------------------------------------
# Constants — normalized across both backends
# ---------------------------------------------------------------------------

if _AVAILABLE:
    if _USE_GI:
        STATE_ACTIVE = _Atspi.StateType.ACTIVE
        ROLE_PASSWORD_TEXT = _Atspi.Role.PASSWORD_TEXT
    else:
        STATE_ACTIVE = pyatspi.STATE_ACTIVE
        ROLE_PASSWORD_TEXT = pyatspi.ROLE_PASSWORD_TEXT
else:
    STATE_ACTIVE = None
    ROLE_PASSWORD_TEXT = None


# ---------------------------------------------------------------------------
# Desktop access
# ---------------------------------------------------------------------------

def get_desktop(index: int = 0):
    """Get the AT-SPI2 desktop root."""
    if not _AVAILABLE:
        return None
    if _USE_GI:
        return _Atspi.get_desktop(index)
    return pyatspi.Registry.getDesktop(index)


# ---------------------------------------------------------------------------
# Accessible helpers — normalize API differences
# ---------------------------------------------------------------------------

def get_child_count(accessible) -> int:
    """Get number of children of an accessible object."""
    if accessible is None:
        return 0
    if _USE_GI:
        return accessible.get_child_count()
    return accessible.childCount


def get_child_at_index(accessible, index: int):
    """Get child accessible at given index."""
    if accessible is None:
        return None
    if _USE_GI:
        return accessible.get_child_at_index(index)
    return accessible[index]


def get_name(accessible) -> str:
    """Get the name of an accessible object."""
    if accessible is None:
        return ""
    if _USE_GI:
        return accessible.get_name() or ""
    return accessible.name or ""


def get_state_set(accessible):
    """Get the state set of an accessible object."""
    if accessible is None:
        return None
    if _USE_GI:
        return accessible.get_state_set()
    return accessible.getState()


def state_contains(state_set, state) -> bool:
    """Check if a state set contains the given state."""
    if state_set is None:
        return False
    if _USE_GI:
        return state_set.contains(state)
    return state_set.contains(state)


def get_role(accessible):
    """Get the role of an accessible object."""
    if accessible is None:
        return None
    if _USE_GI:
        return accessible.get_role()
    return accessible.getRole()


def get_process_id(accessible) -> int:
    """Get the process ID of an accessible object."""
    if accessible is None:
        return 0
    if _USE_GI:
        try:
            return accessible.get_process_id()
        except Exception:
            return 0
    try:
        return accessible.getProcessId()
    except Exception:
        return 0


def query_text(accessible):
    """Query the Text interface of an accessible object. Returns interface or None."""
    if accessible is None:
        return None
    if _USE_GI:
        try:
            return accessible.get_text_iface()
        except Exception:
            return None
    try:
        return accessible.queryText()
    except Exception:
        return None


def get_text_content(text_iface, max_chars: int = 500) -> str:
    """Get text content from a Text interface."""
    if text_iface is None:
        return ""
    try:
        if _USE_GI:
            char_count = text_iface.character_count
        else:
            char_count = text_iface.characterCount
        if char_count > 0:
            return text_iface.get_text(0, min(char_count, max_chars))
    except Exception:
        return ""
    return ""
