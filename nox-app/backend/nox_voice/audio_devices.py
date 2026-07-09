"""Audio device selection helper.

Resolves configured input/output device names or indices to sounddevice
device indices. Provides listing of available devices for the API.
"""

import logging
from typing import Any, Optional, Union

logger = logging.getLogger("nox.voice.audio_devices")

try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False


def list_devices() -> dict[str, list[dict[str, Any]]]:
    """List all audio input and output devices.

    Returns dict with 'input' and 'output' keys, each a list of device info dicts:
    {index, name, channels, is_default}
    """
    if not _SD_AVAILABLE:
        return {"input": [], "output": []}

    try:
        devices = sd.query_devices()
        default_input = sd.default.device[0] if sd.default.device else None
        default_output = sd.default.device[1] if sd.default.device else None

        input_devices = []
        output_devices = []

        for i, dev in enumerate(devices):
            info = {
                "index": i,
                "name": dev["name"],
                "channels": dev["max_input_channels"],
                "is_default": (i == default_input),
            }
            if dev["max_input_channels"] > 0:
                input_devices.append(info)

            info_out = {
                "index": i,
                "name": dev["name"],
                "channels": dev["max_output_channels"],
                "is_default": (i == default_output),
            }
            if dev["max_output_channels"] > 0:
                output_devices.append(info_out)

        return {"input": input_devices, "output": output_devices}
    except Exception as exc:
        logger.error("Failed to list audio devices: %s", exc, exc_info=True)
        return {"input": [], "output": []}


def resolve_input_device(config_value: Union[str, int] = "default") -> Optional[int]:
    """Resolve a config value to a sounddevice input device index.

    Accepts "default", an integer index, or a device name substring.
    Returns None for system default (sounddevice picks it).
    """
    if not _SD_AVAILABLE:
        return None

    if config_value in ("default", None, ""):
        return None

    if isinstance(config_value, int):
        return config_value

    try:
        idx = int(config_value)
        return idx
    except (ValueError, TypeError):
        pass

    # Match by name substring
    try:
        devices = sd.query_devices()
        for i, dev in enumerate(devices):
            if dev["max_input_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved input device '%s' -> index %d (%s)", config_value, i, dev["name"])
                return i
    except Exception:
        pass

    logger.warning("Input device '%s' not found, using default", config_value)
    return None


def resolve_output_device(config_value: Union[str, int] = "default") -> Optional[int]:
    """Resolve a config value to a sounddevice output device index."""
    if not _SD_AVAILABLE:
        return None

    if config_value in ("default", None, ""):
        return None

    if isinstance(config_value, int):
        return config_value

    try:
        idx = int(config_value)
        return idx
    except (ValueError, TypeError):
        pass

    try:
        devices = sd.query_devices()
        for i, dev in enumerate(devices):
            if dev["max_output_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved output device '%s' -> index %d (%s)", config_value, i, dev["name"])
                return i
    except Exception:
        pass

    logger.warning("Output device '%s' not found, using default", config_value)
    return None
