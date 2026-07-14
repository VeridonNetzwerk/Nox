"""STT-based wake word detection.

Continuously listens to the microphone, uses energy-based VAD to detect
speech segments, transcribes them with faster-whisper, and triggers the
wake callback if the transcription contains the target phrase (e.g. "hey nox").

This is a fallback for systems where openWakeWord ONNX models don't work
or no custom model is available for the desired wake phrase.

Runs in a daemon thread so it never blocks the async event loop.
"""

import logging
import threading
import time
from typing import Callable, Optional, Union

import numpy as np

logger = logging.getLogger("nox.voice.wake_word")

try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False


class STTWakeWordListener:
    """Continuous wake word listener using energy VAD + STT."""

    SAMPLE_RATE = 16000
    CHUNK_SIZE = 1600  # 100ms chunks
    # Energy threshold for voice activity — low to catch quiet speech
    ENERGY_THRESHOLD = 0.005
    # Max seconds to record for one wake-word check
    MAX_PHRASE_DURATION = 2.5
    # Silence threshold to stop recording (seconds of silence after speech)
    SILENCE_LIMIT = 0.5
    # Cooldown after a detection or false positive (seconds)
    COOLDOWN = 0.5
    # Wake phrases to match (lowercase, will be fuzzy-matched)
    WAKE_PHRASES = [
        "hey nox", "hei nox", "hay nox", "hey nocks", "hey knocks", "hey noks",
        "hey nots", "hey nach", "hey nox.", "hey nox,",
        "a nox", "ae nox", "eh nox", "e nox",
        "hi nox", "hallo nox", "hey nox!",
        "hey knox", "hey nox's",
    ]
    # Standalone trigger words — only clear Nox variants, NOT common words like
    # "no", "knows", "nach" etc. to avoid false positives.
    TRIGGER_WORDS = [
        "nox", "nocks", "knocks", "noks", "nokx", "nox's", "knox",
    ]
    # Greeting words that can precede the trigger word
    GREETING_WORDS = [
        "hey", "hei", "hay", "hi", "hallo", "eh", "ae", "a", "he",
        "heyh", "heyy", "hhey", "hey,", "hej", "hai",
    ]

    def __init__(
        self,
        stt_engine,
        threshold: float = 0.5,
        sample_rate: int = 16000,
        input_device: Optional[Union[str, int]] = None,
        wake_phrases: Optional[list[str]] = None,
    ):
        self.stt = stt_engine
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.input_device = input_device
        self.on_wake: Optional[Callable[[], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._device_index: Optional[int] = None

        if wake_phrases:
            self.WAKE_PHRASES = [p.lower() for p in wake_phrases]

    def _resolve_device(self):
        from .audio_devices import resolve_input_device
        self._device_index = resolve_input_device(self.input_device)

    def update_input_device(self, device: Optional[Union[str, int]]) -> None:
        was_running = self._running
        if was_running:
            self.stop()
        self.input_device = device
        if was_running:
            self.start()

    @property
    def is_available(self) -> bool:
        return _SD_AVAILABLE and self.stt is not None and self.stt.is_available

    @property
    def model_loaded(self) -> bool:
        return self.stt is not None

    def start(self) -> None:
        if not self.is_available:
            logger.warning(
                "STTWakeWordListener unavailable: sounddevice=%s, stt=%s",
                _SD_AVAILABLE, self.stt is not None,
            )
            return

        self._resolve_device()
        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True, name="stt-wake-word")
        self._thread.start()
        logger.info(
            "STT wake word listener started (device=%s, phrases=%s)",
            self._device_index, self.WAKE_PHRASES,
        )

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        logger.info("STT wake word listener stopped")

    def pause(self) -> None:
        self._paused = True
        logger.debug("STT wake word listener paused")

    def resume(self) -> None:
        self._paused = False
        logger.debug("STT wake word listener resumed")

    def _matches_wake_phrase(self, text: str) -> bool:
        text_lower = text.lower().strip().strip(".,!?;:'\"()[]{}")
        if not text_lower:
            return False

        # Direct substring match against full wake phrases
        for phrase in self.WAKE_PHRASES:
            if phrase in text_lower:
                return True

        # Compact match (no spaces): e.g. "heynox"
        compact_text = text_lower.replace(" ", "")
        for phrase in self.WAKE_PHRASES:
            compact = phrase.replace(" ", "")
            if compact in compact_text:
                return True

        # Word-level match: greeting + trigger word
        words = text_lower.replace(",", " ").replace(".", " ").split()
        has_greeting = any(w.strip(".,!?") in self.GREETING_WORDS for w in words)
        has_trigger = any(w.strip(".,!?") in self.TRIGGER_WORDS for w in words)
        if has_greeting and has_trigger:
            return True

        # Fuzzy match: check if the full text is close to a wake phrase
        import difflib
        for phrase in self.WAKE_PHRASES:
            ratio = difflib.SequenceMatcher(None, phrase, text_lower).ratio()
            if ratio > 0.65:
                logger.debug("Wake word fuzzy match: '%s' vs '%s' ratio=%.2f", text_lower, phrase, ratio)
                return True

        # Partial fuzzy: check if any trigger word is close to any word in text
        for w in words:
            w_clean = w.strip(".,!?")
            if len(w_clean) < 3:
                continue
            for trigger in self.TRIGGER_WORDS:
                if len(trigger) < 3:
                    continue
                ratio = difflib.SequenceMatcher(None, trigger, w_clean).ratio()
                if ratio > 0.8:
                    logger.debug("Wake word partial match: '%s' ~ '%s' ratio=%.2f", w_clean, trigger, ratio)
                    return True

        return False

    def _run(self) -> None:
        try:
            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=self.CHUNK_SIZE,
                device=self._device_index,
            ) as stream:
                while self._running:
                    if self._paused:
                        time.sleep(0.05)
                        continue

                    try:
                        data, overflowed = stream.read(self.CHUNK_SIZE)
                    except sd.PortAudioError:
                        continue
                    if overflowed:
                        continue

                    audio_chunk = data.flatten()
                    energy = float(np.abs(audio_chunk).max())

                    if energy < self.ENERGY_THRESHOLD:
                        continue

                    # Speech detected — start recording a phrase
                    logger.debug("Speech detected (energy=%.4f), recording phrase...", energy)
                    phrase_audio = self._record_phrase(stream)
                    if phrase_audio is None or len(phrase_audio) < self.SAMPLE_RATE * 0.3:
                        continue

                    # Transcribe with higher beam_size for better accuracy
                    try:
                        text = self.stt.transcribe(phrase_audio, beam_size=3)
                    except Exception as exc:
                        logger.debug("STT error in wake word: %s", exc)
                        continue

                    if not text:
                        continue

                    logger.debug("Wake word STT: '%s'", text[:100])
                    if self._matches_wake_phrase(text):
                        logger.info("Wake word detected via STT: '%s'", text[:100])
                        if self.on_wake:
                            try:
                                self.on_wake()
                            except Exception as exc:
                                logger.error("Wake callback error: %s", exc, exc_info=True)
                        time.sleep(self.COOLDOWN)

        except Exception as exc:
            logger.error("STT wake word listener error: %s", exc, exc_info=True)

    def _record_phrase(self, stream) -> Optional[np.ndarray]:
        """Record audio until silence is detected or max duration reached."""
        chunks = [None]  # will be filled
        collected = []
        silence_frames = 0
        silence_limit_frames = int(self.SILENCE_LIMIT * self.SAMPLE_RATE / self.CHUNK_SIZE)
        max_frames = int(self.MAX_PHRASE_DURATION * self.SAMPLE_RATE / self.CHUNK_SIZE)

        for i in range(max_frames):
            if not self._running or self._paused:
                break
            try:
                data, _ = stream.read(self.CHUNK_SIZE)
            except sd.PortAudioError:
                continue
            chunk = data.flatten()
            collected.append(chunk)
            energy = float(np.abs(chunk).max())
            if energy < self.ENERGY_THRESHOLD:
                silence_frames += 1
            else:
                silence_frames = 0
            if silence_frames >= silence_limit_frames and len(collected) > 3:
                break

        if not collected:
            return None
        return np.concatenate(collected)
