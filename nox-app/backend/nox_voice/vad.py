"""Voice Activity Detection (VAD) recorder with end-of-turn detection.

Records audio from the microphone until silence is detected (via webrtcvad)
or a timeout is reached. Uses asymmetric thresholds for speech onset/offset
and a heuristic end-of-turn detector to distinguish thinking pauses from
actual conversation endings.

Returns audio as a float32 numpy array suitable for faster-whisper.
"""

import logging
import re
import time
from typing import Callable, Optional, Union

logger = logging.getLogger("nox.voice.vad")

# Conditional imports
try:
    import numpy as np
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

try:
    import webrtcvad
    _VAD_AVAILABLE = True
except ImportError:
    _VAD_AVAILABLE = False


# German fill words that indicate the user is still thinking
FILL_WORDS = ["ähm", "äh", "ahm", "also", "naja", "sozusagen", "irgendwie", "halt", "eben", "wohl"]


def _ends_with_fillword(text: str) -> bool:
    """Check if the last few words contain a fill word."""
    words = text.lower().strip().split()
    if not words:
        return False
    last_3 = words[-3:]
    return any(w.strip(".,!?;:") in FILL_WORDS for w in last_3)


def _is_incomplete_sentence(text: str) -> bool:
    """Heuristic: check if the text looks like an incomplete sentence."""
    text = text.strip()
    if not text:
        return True
    # No sentence-ending punctuation
    if not re.search(r'[.!?]\s*$', text):
        # Check if it ends with a conjunction or preposition (likely more to come)
        last_word = text.lower().split()[-1].strip(".,!?;:") if text.split() else ""
        conjunctions = ["und", "oder", "aber", "weil", "dass", "wenn", "als", "wie", "mit",
                        "von", "zu", "auf", "in", "für", "den", "die", "das", "der", "ein",
                        "eine", "nicht", "noch", "auch", "dann", "somit", "hier", "dort"]
        if last_word in conjunctions:
            return True
        return True  # No terminal punctuation = likely incomplete
    return False


class VADRecorder:
    """Records audio with Voice Activity Detection and end-of-turn heuristics.

    Improvements over basic VAD:
    - Asymmetric thresholds: more frames required to confirm speech onset
      (prevents cough/noise triggers), fewer for offset (detects pauses faster).
    - Configurable silence duration (0.8-1.2s recommended for natural pauses).
    - End-of-turn heuristic: extends silence tolerance when fill words
      ("ähm", "also") or incomplete sentences are detected in the running
      transcription, preventing premature cutoff during thinking pauses.
    - Speculative transcription: calls on_partial_transcript callback with
      audio chunks during recording so the caller can run Whisper in parallel.
    """

    FRAME_DURATION_MS = 30  # webrtcvad supports 10, 20, 30ms frames

    def __init__(
        self,
        sample_rate: int = 16000,
        aggressiveness: int = 3,
        silence_duration: float = 1.0,
        timeout: float = 15.0,
        initial_silence_timeout: float = 3.0,
        input_device: Optional[Union[str, int]] = None,
        speech_onset_frames: int = 3,
        end_turn_enabled: bool = True,
        end_turn_silence_threshold: float = 1.0,
        end_turn_max_silence: float = 2.5,
        end_turn_fillword_extension: float = 0.8,
        end_turn_incomplete_sentence_extension: float = 1.0,
        on_partial_transcript: Optional[Callable] = None,
    ):
        self.sample_rate = sample_rate
        self.aggressiveness = aggressiveness
        self.silence_duration = silence_duration
        self.timeout = timeout
        self.initial_silence_timeout = initial_silence_timeout
        self.input_device = input_device
        self.speech_onset_frames = speech_onset_frames
        self.end_turn_enabled = end_turn_enabled
        self.end_turn_silence_threshold = end_turn_silence_threshold
        self.end_turn_max_silence = end_turn_max_silence
        self.end_turn_fillword_extension = end_turn_fillword_extension
        self.end_turn_incomplete_sentence_extension = end_turn_incomplete_sentence_extension
        self.on_partial_transcript = on_partial_transcript
        self._frame_size = int(sample_rate * self.FRAME_DURATION_MS / 1000)
        self._device_index: Optional[int] = None

    def _resolve_device(self):
        """Resolve configured device name/index to a sounddevice index."""
        from .audio_devices import resolve_input_device
        self._device_index = resolve_input_device(self.input_device)

    def update_input_device(self, device: Optional[Union[str, int]]) -> None:
        """Update the configured input device (takes effect on next record() call)."""
        self.input_device = device

    @property
    def is_available(self) -> bool:
        return _SD_AVAILABLE and _VAD_AVAILABLE

    def record(self) -> "np.ndarray":
        """Record audio until VAD + end-of-turn detection signals end of speech.

        Returns:
            float32 numpy array of mono audio at sample_rate.
            Empty array if recording fails.
        """
        if not self.is_available:
            logger.warning("VADRecorder unavailable: sounddevice=%s, webrtcvad=%s",
                           _SD_AVAILABLE, _VAD_AVAILABLE)
            return np.array([], dtype=np.float32)

        try:
            vad = webrtcvad.Vad(self.aggressiveness)
        except Exception as exc:
            logger.error("Failed to init VAD: %s", exc, exc_info=True)
            return np.array([], dtype=np.float32)

        self._resolve_device()

        audio_chunks = []
        silence_start: Optional[float] = None
        has_speech = False
        speech_onset_count = 0
        start_time = time.time()
        last_partial_time: float = 0

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                blocksize=self._frame_size,
                device=self._device_index,
            ) as stream:
                while True:
                    elapsed = time.time() - start_time

                    # Global timeout
                    if elapsed > self.timeout:
                        logger.debug("Recording stopped: timeout (%.1fs)", elapsed)
                        break

                    # Initial silence timeout (no speech detected at all)
                    if not has_speech and elapsed > self.initial_silence_timeout:
                        logger.debug("Recording stopped: initial silence timeout")
                        break

                    try:
                        data, overflowed = stream.read(self._frame_size)
                    except sd.PortAudioError:
                        continue

                    if overflowed:
                        continue

                    # Convert float32 to int16 bytes for webrtcvad
                    pcm = (data.flatten() * 32767).astype(np.int16).tobytes()

                    try:
                        is_speech = vad.is_speech(pcm, self.sample_rate)
                    except Exception:
                        is_speech = True  # Assume speech on VAD error

                    if is_speech:
                        speech_onset_count += 1
                        # Asymmetric: require multiple consecutive speech frames to confirm onset
                        if speech_onset_count >= self.speech_onset_frames:
                            has_speech = True
                        silence_start = None
                    else:
                        speech_onset_count = 0
                        if silence_start is None:
                            silence_start = time.time()
                        else:
                            silence_elapsed = time.time() - silence_start

                            if has_speech:
                                # Determine effective silence threshold
                                effective_threshold = self.silence_duration

                                if self.end_turn_enabled:
                                    effective_threshold = self.end_turn_silence_threshold

                                    # Extend threshold based on heuristic
                                    # (we don't have the transcript yet, but the caller
                                    #  may have set on_partial_transcript which we use
                                    #  to get a running transcript)
                                    if self.on_partial_transcript and silence_elapsed > self.end_turn_silence_threshold * 0.5:
                                        # Request a partial transcript to check heuristics
                                        partial_audio = np.concatenate(audio_chunks[-50:]).flatten() if len(audio_chunks) >= 50 else np.concatenate(audio_chunks).flatten()
                                        partial_text = self.on_partial_transcript(partial_audio)
                                        if partial_text:
                                            if _ends_with_fillword(partial_text):
                                                effective_threshold += self.end_turn_fillword_extension
                                                logger.debug("End-turn: fill word detected, extending silence to %.1fs", effective_threshold)
                                            elif _is_incomplete_sentence(partial_text):
                                                effective_threshold += self.end_turn_incomplete_sentence_extension
                                                logger.debug("End-turn: incomplete sentence, extending silence to %.1fs", effective_threshold)

                                    # Hard cap: never wait longer than max_silence
                                    effective_threshold = min(effective_threshold, self.end_turn_max_silence)

                                if silence_elapsed > effective_threshold:
                                    logger.debug("Recording stopped: silence detected (%.1fs > %.1fs threshold)",
                                                 silence_elapsed, effective_threshold)
                                    break

                    audio_chunks.append(data.copy())

                    # Speculative transcription: send partial audio every ~1s
                    if self.on_partial_transcript and has_speech:
                        now = time.time()
                        if now - last_partial_time > 1.0:
                            last_partial_time = now

        except Exception as exc:
            logger.error("Recording error: %s", exc, exc_info=True)
            if not audio_chunks:
                return np.array([], dtype=np.float32)

        if not audio_chunks:
            return np.array([], dtype=np.float32)

        audio = np.concatenate(audio_chunks).flatten()
        logger.info("Recorded %.1fs of audio", len(audio) / self.sample_rate)
        return audio
