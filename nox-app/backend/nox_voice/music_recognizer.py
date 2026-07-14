"""Music recognition via PC audio capture + Shazam (shazamio).

Captures system audio output (what the user hears) using `sounddevice`
with WASAPI virtual input devices on Windows (e.g. Voicemeeter outputs,
VB-Audio Virtual Cable), then sends a short clip to Shazam's
reverse-engineered API (via shazamio) to identify the currently
playing song.

Shazam is free and unlimited — no API token required.
"""

import io
import logging
import wave
from typing import Any, Optional

logger = logging.getLogger("nox.voice.music")

try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

try:
    import numpy as np
    _NP_AVAILABLE = True
except ImportError:
    _NP_AVAILABLE = False


# Seconds of audio to capture for recognition (Shazam works best with 10-15s)
RECORD_SECONDS = 10
SAMPLE_RATE = 48000


def _find_virtual_input_device(output_device_name: Optional[str] = None) -> Optional[int]:
    """Find a WASAPI input device index that carries system audio.

    On Windows with Voicemeeter or VB-Audio Virtual Cable, system audio
    appears on virtual input devices (e.g. "CABLE Output", "Voicemeeter Out B1").

    If output_device_name is given, tries to find a matching virtual input.
    Otherwise tries common virtual cable / Voicemeeter output names.
    """
    if not _SD_AVAILABLE:
        return None

    try:
        hostapis = sd.query_hostapis()
        wasapi_idx = None
        for i, api in enumerate(hostapis):
            if api["name"] == "Windows WASAPI":
                wasapi_idx = i
                break
        if wasapi_idx is None:
            logger.warning("WASAPI host API not found")
            return None

        wasapi = hostapis[wasapi_idx]
        wasapi_devices = wasapi["devices"]

        input_devs = []
        for idx in wasapi_devices:
            info = sd.query_devices(idx)
            if info["max_input_channels"] > 0:
                input_devs.append((idx, info["name"]))

        if not input_devs:
            logger.warning("No WASAPI input devices found")
            return None

        if output_device_name and output_device_name not in ("default", "", None):
            name_lower = output_device_name.lower()
            for idx, name in input_devs:
                if name_lower in name.lower():
                    logger.info("Matched virtual input device: %s (idx=%d)", name, idx)
                    return idx

        virtual_names = [
            "cable output",
            "voicemeeter out b1",
            "voicemeeter out a1",
            "voicemeeter out b2",
            "voicemeeter out a2",
            "voicemeeter out b3",
        ]
        for vname in virtual_names:
            for idx, name in input_devs:
                if vname in name.lower():
                    logger.info("Using virtual input device: %s (idx=%d)", name, idx)
                    return idx

        for idx, name in input_devs:
            if "mikrofon" not in name.lower() and "microphone" not in name.lower():
                logger.info("Using fallback input device: %s (idx=%d)", name, idx)
                return idx

        logger.warning("No suitable virtual input device found")
        return None

    except Exception as exc:
        logger.error("Failed to find virtual input device: %s", exc, exc_info=True)
        return None


def _capture_audio(duration_seconds: float = RECORD_SECONDS,
                   output_device: Optional[str] = None) -> Optional[bytes]:
    """Capture system audio as WAV bytes.

    Returns WAV-formatted bytes (PCM 16-bit, mono) ready for Shazam,
    or None if capture fails.
    """
    if not _SD_AVAILABLE or not _NP_AVAILABLE:
        logger.error("sounddevice or numpy not available")
        return None

    device_idx = _find_virtual_input_device(output_device)
    if device_idx is None:
        logger.error("No virtual input device available for audio capture")
        return None

    try:
        device_info = sd.query_devices(device_idx)
        channels = min(device_info["max_input_channels"], 2)
        logger.info("Recording %ss of audio from: %s (ch=%d)", duration_seconds, device_info["name"], channels)

        data = sd.rec(
            frames=int(SAMPLE_RATE * duration_seconds),
            samplerate=SAMPLE_RATE,
            channels=channels,
            dtype=np.int16,
            device=device_idx,
        )
        sd.wait()

        if data is None or len(data) == 0:
            logger.error("Audio recording returned no data")
            return None

        max_val = int(np.max(np.abs(data)))
        logger.info("Captured %d samples, max amplitude: %d (%.1f%%)", len(data), max_val, max_val / 32767 * 100)

        if max_val < 50:
            logger.warning("Audio is nearly silent — is music actually playing?")
            return None

        if data.ndim > 1:
            data = data.mean(axis=1).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(data.tobytes())

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
        output_device: Configured audio output device name (for matching virtual input).
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

        # Use shazamio to recognize — retry once if Shazam requests more data
        import asyncio
        from shazamio import Shazam

        async def _recognize(path):
            shazam = Shazam()
            return await shazam.recognize(path)

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_recognize(tmp_path))
        finally:
            loop.close()

        # If Shazam didn't find a track but suggests retry, try once more with fresh audio
        if not result or not result.get("track"):
            retry_ms = result.get("retryms", 0) if result else 0
            if retry_ms > 0:
                logger.info("Shazam suggests retry in %dms, capturing fresh audio...", retry_ms)
                import time as _time
                _time.sleep(min(retry_ms / 1000, 5))
                # Capture fresh audio
                wav_bytes2 = _capture_audio(duration, output_device)
                if wav_bytes2 is not None:
                    tmp2 = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                    tmp2.write(wav_bytes2)
                    tmp2.close()
                    tmp_path2 = tmp2.name
                    try:
                        loop2 = asyncio.new_event_loop()
                        try:
                            result = loop2.run_until_complete(_recognize(tmp_path2))
                        finally:
                            loop2.close()
                    finally:
                        if os.path.exists(tmp_path2):
                            os.unlink(tmp_path2)

        if not result:
            return {"error": "Keine Antwort von Shazam erhalten."}

        track = result.get("track")
        if not track:
            return {"error": "Kein Song erkannt. Vielleicht spielt gerade keine Musik."}

        # Extract cover image from track images (Shazam provides several sizes)
        cover_url = ""
        images = track.get("images", {})
        if isinstance(images, dict):
            for size in ("coverarthq", "coverart", "avatar", "background"):
                cover_url = images.get(size, "")
                if cover_url:
                    break

        info = {
            "artist": track.get("subtitle", ""),
            "title": track.get("title", ""),
            "album": "",
            "release_date": "",
            "song_link": track.get("share", {}).get("href", ""),
            "cover_url": cover_url,
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
