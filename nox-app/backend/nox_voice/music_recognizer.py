"""Music recognition via PC audio loopback + Shazam (shazamio).

Captures system audio output (what the user hears) using the `soundcard`
library's WASAPI loopback support on Windows, then sends a short clip to
Shazam's reverse-engineered API (via shazamio) to identify the currently
playing song.

Shazam is free and unlimited — no API token required.
"""

import io
import logging
import threading
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
RECORD_TIMEOUT = 30  # Hard timeout for recording in seconds


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
        numframes = int(SAMPLE_RATE * duration_seconds)
        result_container = {}

        def _do_record():
            try:
                result_container["data"] = mic.record(samplerate=SAMPLE_RATE, numframes=numframes)
            except Exception as exc:
                result_container["error"] = exc

        t = threading.Thread(target=_do_record, daemon=True)
        t.start()
        t.join(timeout=RECORD_TIMEOUT)

        if t.is_alive():
            logger.error("Audio recording timed out after %ss — loopback device may be silent or unavailable", RECORD_TIMEOUT)
            return None

        if "error" in result_container:
            raise result_container["error"]

        data = result_container.get("data")
        if data is None:
            logger.error("Audio recording returned no data")
            return None

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


def recognize_song(output_device: Optional[str] = None,
                   duration: float = RECORD_SECONDS) -> dict[str, Any]:
    """Recognize the currently playing song from system audio.

    Uses Shazam via shazamio — free and unlimited, no API token needed.

    Args:
        output_device: Configured audio output device name (for matching loopback).
        duration: Seconds of audio to capture (5-25 recommended).

    Returns:
        Dict with recognition result or error info.
    """
    wav_bytes = _capture_audio(duration, output_device)
    if wav_bytes is None:
        return {"error": "Konnte kein System-Audio aufnehmen. Ist ein Audio-Ausgabegerät aktiv?"}

    # Write WAV to a temp file (shazamio needs a file path)
    import tempfile
    import os

    tmp_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(wav_bytes)
        tmp.close()
        tmp_path = tmp.name

        # Use shazamio to recognize
        import asyncio
        from shazamio import Shazam

        async def _recognize():
            shazam = Shazam()
            return await shazam.recognize(tmp_path)

        # Run in a new event loop (we're in a sync thread via run_in_executor)
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_recognize())
        finally:
            loop.close()

        if not result:
            return {"error": "Keine Antwort von Shazam erhalten."}

        track = result.get("track")
        if not track:
            return {"error": "Kein Song erkannt. Vielleicht spielt gerade keine Musik."}

        info = {
            "artist": track.get("subtitle", ""),
            "title": track.get("title", ""),
            "album": "",
            "release_date": "",
            "song_link": track.get("share", {}).get("href", ""),
        }

        # Extract album and release date from sections
        sections = track.get("sections", [])
        for section in sections:
            if section.get("type") == "SONG":
                for meta in section.get("metadata", []):
                    if meta.get("title", "") == "Album":
                        info["album"] = meta.get("text", "")
                    elif meta.get("title", "") == "Released":
                        info["release_date"] = meta.get("text", "")

        # Extract streaming links from sharehref / apple / spotify
        # Shazam provides apple_music and spotify links in the share section
        share = track.get("share", {})
        if share.get("apple"):
            info["apple_music_url"] = share["apple"]
        if share.get("spotify"):
            info["spotify_url"] = share["spotify"]

        # YouTube fallback: search link
        artist_title = f"{info['artist']} {info['title']}".strip()
        if artist_title:
            info["youtube_url"] = f"https://www.youtube.com/results?search_query={artist_title.replace(' ', '+')}"

        logger.info("Recognized via Shazam: %s - %s", info["artist"], info["title"])
        return info

    except ImportError:
        logger.error("shazamio not installed — run: pip install shazamio")
        return {"error": "Musikerkennung nicht installiert. Bitte 'pip install shazamio' ausführen."}
    except Exception as exc:
        logger.error("Music recognition failed: %s", exc, exc_info=True)
        return {"error": f"Erkennung fehlgeschlagen: {exc}"}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
