"""Music recognition via PC audio loopback + AudD API.

Captures system audio output (what the user hears) using the `soundcard`
library's WASAPI loopback support on Windows, then sends a short clip to
the AudD music recognition API to identify the currently playing song.
"""

import io
import logging
import wave
from typing import Any, Optional

logger = logging.getLogger("nox.voice.music")

try:
    import soundcard as sc
    _SC_AVAILABLE = True
except ImportError:
    _SC_AVAILABLE = False

try:
    import numpy as np
    _NP_AVAILABLE = True
except ImportError:
    _NP_AVAILABLE = False


# Seconds of audio to capture for recognition (AudD recommends 5-25s)
RECORD_SECONDS = 10
SAMPLE_RATE = 48000


def _find_loopback_device(output_device_name: Optional[str] = None) -> Optional[Any]:
    """Find a loopback microphone matching the configured output device.

    If output_device_name is given, tries to find a matching loopback.
    Otherwise falls back to the default loopback device.
    """
    if not _SC_AVAILABLE:
        return None

    try:
        loopbacks = sc.all_microphones(include_loopback=True)
        if not loopbacks:
            logger.warning("No loopback devices found")
            return None

        if output_device_name and output_device_name not in ("default", "", None):
            name_lower = output_device_name.lower()
            for lb in loopbacks:
                if name_lower in lb.name.lower():
                    logger.info("Matched loopback device: %s", lb.name)
                    return lb

        default_lb = sc.default_microphone()
        if default_lb:
            logger.info("Using default loopback device: %s", default_lb.name)
            return default_lb

        return loopbacks[0]
    except Exception as exc:
        logger.error("Failed to find loopback device: %s", exc, exc_info=True)
        return None


def _capture_audio(duration_seconds: float = RECORD_SECONDS,
                   output_device: Optional[str] = None) -> Optional[bytes]:
    """Capture system audio as WAV bytes.

    Returns WAV-formatted bytes (PCM 16-bit, mono) ready for API upload,
    or None if capture fails.
    """
    if not _SC_AVAILABLE or not _NP_AVAILABLE:
        logger.error("soundcard or numpy not available")
        return None

    mic = _find_loopback_device(output_device)
    if mic is None:
        logger.error("No loopback device available")
        return None

    try:
        logger.info("Recording %ss of system audio via loopback...", duration_seconds)
        data = mic.record(samplerate=SAMPLE_RATE, numframes=int(SAMPLE_RATE * duration_seconds))
        logger.info("Captured %d samples", len(data))

        # Convert to mono if stereo
        if data.ndim > 1:
            data = data.mean(axis=1)

        # Normalize and convert to 16-bit PCM
        audio_float = data.flatten()
        max_val = float(np.max(np.abs(audio_float))) if len(audio_float) > 0 else 0.0
        if max_val > 0:
            audio_float = audio_float / max_val
        audio_int16 = (audio_float * 32767).astype(np.int16)

        # Write to WAV in memory
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio_int16.tobytes())

        wav_bytes = buf.getvalue()
        logger.info("Encoded %d bytes of WAV audio", len(wav_bytes))
        return wav_bytes

    except Exception as exc:
        logger.error("Audio capture failed: %s", exc, exc_info=True)
        return None


def recognize_song(api_token: str, output_device: Optional[str] = None,
                   duration: float = RECORD_SECONDS) -> dict[str, Any]:
    """Recognize the currently playing song from system audio.

    Args:
        api_token: AudD API token.
        output_device: Configured audio output device name (for matching loopback).
        duration: Seconds of audio to capture (5-25 recommended).

    Returns:
        Dict with recognition result or error info.
    """
    if not api_token:
        return {"error": "Kein AudD API-Token konfiguriert. Setze 'audd_api_token' in den Einstellungen."}

    wav_bytes = _capture_audio(duration, output_device)
    if wav_bytes is None:
        return {"error": "Konnte kein System-Audio aufnehmen. Ist ein Audio-Ausgabegerät aktiv?"}

    try:
        import requests as req

        resp = req.post(
            "https://api.audd.io/",
            files={"file": ("clip.wav", wav_bytes, "audio/wav")},
            data={"api_token": api_token, "return": "apple_music,spotify"},
            timeout=15,
        )
        result = resp.json()

        if result.get("status") == "success" and result.get("result"):
            r = result["result"]
            info = {
                "artist": r.get("artist", ""),
                "title": r.get("title", ""),
                "album": r.get("album", ""),
                "release_date": r.get("release_date", ""),
                "song_link": r.get("song_link", ""),
            }
            # Add streaming links if available
            if r.get("spotify"):
                info["spotify_url"] = r["spotify"].get("external_urls", {}).get("spotify", "")
            if r.get("apple_music"):
                info["apple_music_url"] = r["apple_music"].get("url", "")
            # YouTube fallback: search link for the recognized song
            artist_title = f"{info['artist']} {info['title']}".strip()
            if artist_title:
                info["youtube_url"] = f"https://www.youtube.com/results?search_query={artist_title.replace(' ', '+')}"

            logger.info("Recognized: %s - %s", info["artist"], info["title"])
            return info
        elif result.get("status") == "success" and not result.get("result"):
            return {"error": "Kein Song erkannt. Vielleicht spielt gerade keine Musik."}
        else:
            err = result.get("error", {}).get("error_message", "Unbekannter Fehler")
            logger.error("AudD API error: %s", err)
            return {"error": f"AudD API Fehler: {err}"}

    except Exception as exc:
        logger.error("Music recognition failed: %s", exc, exc_info=True)
        return {"error": f"Erkennung fehlgeschlagen: {exc}"}
