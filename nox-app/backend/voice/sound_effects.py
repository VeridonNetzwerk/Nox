"""Short sound effects for wake word and end-of-input feedback.

Generates simple tones programmatically and plays them via sounddevice.
No external audio files needed.
"""

import logging
import threading
from typing import Optional, Union

import numpy as np

logger = logging.getLogger("nox.voice.sound_effects")

try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

_SAMPLE_RATE = 44100


def _generate_tone(
    frequencies: list[float],
    duration: float,
    sr: int = _SAMPLE_RATE,
    volume: float = 0.3,
    fade: float = 0.01,
) -> np.ndarray:
    """Generate a short tone with multiple frequencies and fade in/out."""
    n = int(duration * sr)
    t = np.arange(n) / sr
    audio = np.zeros(n, dtype=np.float32)
    for freq in frequencies:
        audio += np.sin(2 * np.pi * freq * t)
    audio = audio / len(frequencies) * volume

    # Fade in/out to avoid clicks
    fade_n = int(fade * sr)
    if fade_n > 0 and fade_n * 2 < n:
        fade_in = np.linspace(0, 1, fade_n, dtype=np.float32)
        fade_out = np.linspace(1, 0, fade_n, dtype=np.float32)
        audio[:fade_n] *= fade_in
        audio[-fade_n:] *= fade_out

    return audio


def _generate_chime(
    sr: int = _SAMPLE_RATE,
    volume: float = 0.25,
) -> np.ndarray:
    """Generate a pleasant two-note ascending chime (C5 -> E5)."""
    note1 = _generate_tone([523.25], 0.08, sr=sr, volume=volume)
    silence = np.zeros(int(0.03 * sr), dtype=np.float32)
    note2 = _generate_tone([659.25], 0.12, sr=sr, volume=volume)
    return np.concatenate([note1, silence, note2])


def _generate_end_chime(
    sr: int = _SAMPLE_RATE,
    volume: float = 0.25,
) -> np.ndarray:
    """Generate a gentle descending chime (E5 -> C5) for end-of-input."""
    note1 = _generate_tone([659.25], 0.08, sr=sr, volume=volume)
    silence = np.zeros(int(0.03 * sr), dtype=np.float32)
    note2 = _generate_tone([523.25], 0.12, sr=sr, volume=volume)
    return np.concatenate([note1, silence, note2])


def play_wake_sound(output_device: Optional[Union[str, int]] = None) -> None:
    """Play the wake word detected sound in a non-blocking thread."""
    if not _SD_AVAILABLE:
        return
    threading.Thread(target=_play_wake, args=(output_device,), daemon=True, name="sfx-wake").start()


def play_end_sound(output_device: Optional[Union[str, int]] = None) -> None:
    """Play the end-of-input sound in a non-blocking thread."""
    if not _SD_AVAILABLE:
        return
    threading.Thread(target=_play_end, args=(output_device,), daemon=True, name="sfx-end").start()


def _resolve_device(device: Optional[Union[str, int]]) -> Optional[int]:
    if device is None or device == "default":
        return None
    from .audio_devices import resolve_output_device
    return resolve_output_device(device)


def _play_wake(output_device: Optional[Union[str, int]] = None) -> None:
    try:
        audio = _generate_chime()
        dev = _resolve_device(output_device)
        sd.play(audio, _SAMPLE_RATE, device=dev)
        sd.wait()
    except Exception as exc:
        logger.debug("Wake sound playback error: %s", exc)


def _play_end(output_device: Optional[Union[str, int]] = None) -> None:
    try:
        audio = _generate_end_chime()
        dev = _resolve_device(output_device)
        sd.play(audio, _SAMPLE_RATE, device=dev)
        sd.wait()
    except Exception as exc:
        logger.debug("End sound playback error: %s", exc)
