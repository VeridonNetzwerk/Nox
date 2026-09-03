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
except (ImportError, OSError) as exc:
    _SD_AVAILABLE = False
    logger.warning("sounddevice not available: %s", exc)


def _get_preferred_hostapi_indices() -> set[int]:
    """Return indices of host APIs we want to show devices from.

    On Windows, only WASAPI is used to avoid duplicate/phantom devices from
    MME, DirectSound, and WDM-KS. On other platforms, all host APIs are fine.
    """
    try:
        hostapis = sd.query_hostapis()
    except Exception:
        return set()

    from platform_utils import IS_WINDOWS

    if IS_WINDOWS:
        preferred = set()
        for idx, api in enumerate(hostapis):
            if api["name"] == "WASAPI":
                preferred.add(idx)
        # Fallback: if WASAPI not found, include all
        if not preferred:
            preferred = set(range(len(hostapis)))
        return preferred
    else:
        return set(range(len(hostapis)))


def _is_device_usable(dev: dict) -> bool:
    """Check if a device is likely real and usable.

    Filters out phantom/disabled devices that PortAudio sometimes lists:
    - Devices with 0 default samplerate
    - Devices with extremely high latency (indicates virtual/disabled)
    """
    try:
        sr = dev.get("default_samplerate", 0)
        if sr is None or sr <= 0:
            return False
    except Exception:
        return False
    return True


def list_devices() -> dict[str, list[dict[str, Any]]]:
    """List all audio input and output devices.

    Returns dict with 'input' and 'output' keys, each a list of device info dicts:
    {index, name, channels, is_default}

    On Windows, only WASAPI devices are listed to avoid duplicates from MME,
    DirectSound, and WDM-KS host APIs. Disabled/phantom devices are filtered out.
    """
    if not _SD_AVAILABLE:
        return {"input": [], "output": []}

    try:
        devices = sd.query_devices()
        default_input = sd.default.device[0] if sd.default.device else None
        default_output = sd.default.device[1] if sd.default.device else None

        preferred_apis = _get_preferred_hostapi_indices()

        input_devices = []
        output_devices = []
        seen_names = set()

        for i, dev in enumerate(devices):
            # Skip devices from non-preferred host APIs (e.g. MME/DirectSound on Windows)
            if preferred_apis and dev.get("hostapi", -1) not in preferred_apis:
                continue

            # Skip phantom/disabled devices
            if not _is_device_usable(dev):
                continue

            name = dev["name"].strip()

            # Skip duplicate device names (same physical device listed multiple times)
            if name in seen_names:
                continue

            if dev["max_input_channels"] > 0:
                seen_names.add(name)
                input_devices.append({
                    "index": i,
                    "name": name,
                    "channels": dev["max_input_channels"],
                    "is_default": (i == default_input),
                })

            if dev["max_output_channels"] > 0:
                seen_names.add(name)
                output_devices.append({
                    "index": i,
                    "name": name,
                    "channels": dev["max_output_channels"],
                    "is_default": (i == default_output),
                })

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

    # Match by name substring — prefer WASAPI devices on Windows
    try:
        devices = sd.query_devices()
        preferred_apis = _get_preferred_hostapi_indices()
        # First pass: only preferred host APIs
        for i, dev in enumerate(devices):
            if preferred_apis and dev.get("hostapi", -1) not in preferred_apis:
                continue
            if dev["max_input_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved input device '%s' -> index %d (%s)", config_value, i, dev["name"])
                return i
        # Second pass: any host API (fallback)
        for i, dev in enumerate(devices):
            if dev["max_input_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved input device '%s' -> index %d (%s) [non-preferred API]", config_value, i, dev["name"])
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
        preferred_apis = _get_preferred_hostapi_indices()
        # First pass: only preferred host APIs
        for i, dev in enumerate(devices):
            if preferred_apis and dev.get("hostapi", -1) not in preferred_apis:
                continue
            if dev["max_output_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved output device '%s' -> index %d (%s)", config_value, i, dev["name"])
                return i
        # Second pass: any host API (fallback)
        for i, dev in enumerate(devices):
            if dev["max_output_channels"] > 0 and config_value.lower() in dev["name"].lower():
                logger.info("Resolved output device '%s' -> index %d (%s) [non-preferred API]", config_value, i, dev["name"])
                return i
    except Exception:
        pass

    logger.warning("Output device '%s' not found, using default", config_value)
    return None
