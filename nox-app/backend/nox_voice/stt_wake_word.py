"""STT-based wake word detection — optimized for reliability.

Uses a two-stage audio gate to dramatically reduce false positives and false
negatives compared to the old single-energy-threshold approach:

1. **webrtcvad** (WebRTC Voice Activity Detection) — lightweight C library that
   uses frequency analysis to distinguish speech from noise/music/etc.  Far
   more accurate than a simple energy threshold.
2. **Adaptive RMS noise floor** — continuously estimates ambient noise level
   and requires speech RMS to be significantly above it.  Adapts to different
   environments (quiet room vs. noisy office).

Additional improvements:
- Multi-language wake phrases (de, en, fr, es, tr) with dialect variants
- Phonetic matching via Soundex for dialect/accent robustness
- Stricter fuzzy-match thresholds (0.78 full phrase, 0.85 word-level)
- Minimum speech duration filter (rejects coughs, clicks, short noises)
- Removed overly generic greeting words ("a", "eh", "he") that caused FPs
- Smart cooldown with recent-detection tracking

Runs in a daemon thread so it never blocks the async event loop.
"""

import difflib
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

try:
    import webrtcvad
    _VAD_AVAILABLE = True
except ImportError:
    _VAD_AVAILABLE = False


# ---------------------------------------------------------------------------
# Phonetic matching — simple Soundex for dialect/accent robustness
# ---------------------------------------------------------------------------

_SOUNDEX_MAP = {
    'b': '1', 'f': '1', 'p': '1', 'v': '1',
    'c': '2', 'g': '2', 'j': '2', 'k': '2', 'q': '2', 's': '2', 'x': '2', 'z': '2',
    'd': '3', 't': '3',
    'l': '4',
    'm': '5', 'n': '5',
    'r': '6',
}


def _soundex(word: str) -> str:
    """Compute Soundex code for a word (phonetic matching)."""
    word = word.lower().strip(".,!?;:'\"()[]{}")
    if not word:
        return "0000"
    result = word[0].upper()
    prev_code = _SOUNDEX_MAP.get(word[0], '0')
    for ch in word[1:]:
        code = _SOUNDEX_MAP.get(ch, '0')
        if code != '0' and code != prev_code:
            result += code
        if code != '0':
            prev_code = code
        elif ch in 'aeiouy':
            prev_code = '0'
    return (result + '000')[:4]


# Precompute Soundex for trigger words
_TRIGGER_SOUNDEX = {tw: _soundex(tw) for tw in [
    "nox", "nocks", "knocks", "noks", "knox", "nokx",
]}


class STTWakeWordListener:
    """Continuous wake word listener using webrtcvad + adaptive RMS + STT."""

    SAMPLE_RATE = 16000
    # webrtcvad requires 10/20/30ms frames — use 30ms for efficiency
    VAD_FRAME_SIZE = 480  # 30ms at 16kHz
    VAD_AGGRESSIVENESS = 2  # 0=least, 3=most aggressive. 2 = good balance
    # Max seconds to record for one wake-word check
    MAX_PHRASE_DURATION = 3.0
    # Silence threshold to stop recording (seconds of silence after speech)
    SILENCE_LIMIT = 0.6
    # Cooldown after a detection (seconds)
    COOLDOWN = 1.0
    # Minimum speech duration to trigger transcription (rejects short noises)
    MIN_SPEECH_DURATION = 0.35
    # Adaptive noise floor parameters
    NOISE_FLOOR_INIT = 0.003  # Initial noise floor RMS estimate
    NOISE_ADAPT_RATE = 0.02   # Slow adaptation (2% per chunk)
    RMS_SPEECH_MULTIPLIER = 2.5  # Speech RMS must be this * noise floor

    # Multi-language wake phrases
    WAKE_PHRASES_BY_LANG = {
        "de": [
            "hey nox", "hei nox", "hay nox", "hi nox", "hallo nox",
            "hey noks", "hey nocks", "hey knox", "hey nox's",
            "he nox", "ha nox",
        ],
        "en": [
            "hey nox", "hi nox", "hello nox", "hay nox",
            "hey noks", "hey nocks", "hey knox", "hey nox's",
            "he nox",
        ],
        "fr": [
            "hey nox", "salut nox", "bonjour nox",
            "hey noks", "hey nocks", "hey knox",
        ],
        "es": [
            "hey nox", "hola nox", "oye nox",
            "hey noks", "hey nocks", "hey knox",
        ],
        "tr": [
            "hey nox", "selam nox", "merhaba nox",
            "hey noks", "hey nocks", "hey knox",
        ],
    }

    # Trigger words — "nox" and close phonetic variants only
    TRIGGER_WORDS = ["nox", "nocks", "knocks", "noks", "knox", "nokx"]

    # Greeting words by language — only clear, unambiguous greetings
    GREETING_WORDS_BY_LANG = {
        "de": ["hey", "hei", "hay", "hi", "hallo", "hej", "hai"],
        "en": ["hey", "hi", "hello", "hay", "hej"],
        "fr": ["hey", "salut", "bonjour", "hei"],
        "es": ["hey", "hola", "oye", "hei"],
        "tr": ["hey", "selam", "merhaba", "hei"],
    }

    # Fuzzy match thresholds — stricter to reduce false positives
    FULL_PHRASE_FUZZY_THRESHOLD = 0.78
    WORD_FUZZY_THRESHOLD = 0.85
    PHONETIC_THRESHOLD = 0.75

    def __init__(
        self,
        stt_engine,
        threshold: float = 0.5,
        sample_rate: int = 16000,
        input_device: Optional[Union[str, int]] = None,
        wake_phrases: Optional[list[str]] = None,
        language: str = "de",
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
        self._language = language.lower()[:2] if language else "de"

        # Select wake phrases and greeting words for the configured language
        self.WAKE_PHRASES = (
            wake_phrases if wake_phrases
            else self.WAKE_PHRASES_BY_LANG.get(self._language, self.WAKE_PHRASES_BY_LANG["de"])
        )
        self.WAKE_PHRASES = [p.lower() for p in self.WAKE_PHRASES]
        self.GREETING_WORDS = self.GREETING_WORDS_BY_LANG.get(
            self._language, self.GREETING_WORDS_BY_LANG["de"]
        )

        # Adaptive noise floor state
        self._noise_floor = self.NOISE_FLOOR_INIT
        self._vad: Optional[object] = None

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

        # Initialize webrtcvad
        if _VAD_AVAILABLE:
            try:
                self._vad = webrtcvad.Vad(self.VAD_AGGRESSIVENESS)
                logger.info("webrtcvad initialized (aggressiveness=%d)", self.VAD_AGGRESSIVENESS)
            except Exception as exc:
                logger.warning("Failed to init webrtcvad: %s — falling back to RMS-only", exc)
                self._vad = None
        else:
            logger.warning("webrtcvad not available — using RMS-only detection")

        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True, name="stt-wake-word")
        self._thread.start()
        logger.info(
            "STT wake word listener started (device=%s, lang=%s, vad=%s, phrases=%d)",
            self._device_index, self._language, self._vad is not None, len(self.WAKE_PHRASES),
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

    # ------------------------------------------------------------------
    # Audio processing helpers
    # ------------------------------------------------------------------

    def _rms(self, audio: np.ndarray) -> float:
        """Compute RMS energy of an audio chunk."""
        if len(audio) == 0:
            return 0.0
        return float(np.sqrt(np.mean(audio ** 2)))

    def _is_speech_vad(self, audio: np.ndarray) -> bool:
        """Check if a 30ms audio frame contains speech using webrtcvad."""
        if self._vad is None:
            # Fallback: RMS-only detection
            rms = self._rms(audio)
            return rms > self._noise_floor * self.RMS_SPEECH_MULTIPLIER

        try:
            pcm = (audio * 32767).astype(np.int16).tobytes()
            return self._vad.is_speech(pcm, self.SAMPLE_RATE)
        except Exception:
            return False

    def _update_noise_floor(self, audio: np.ndarray) -> None:
        """Adapt noise floor estimate using non-speech audio."""
        rms = self._rms(audio)
        if rms < self._noise_floor * 1.5:
            # Likely non-speech — update noise floor
            self._noise_floor = (
                (1 - self.NOISE_ADAPT_RATE) * self._noise_floor
                + self.NOISE_ADAPT_RATE * rms
            )

    # ------------------------------------------------------------------
    # Wake phrase matching
    # ------------------------------------------------------------------

    def _matches_wake_phrase(self, text: str) -> bool:
        """Check if transcribed text matches a wake phrase.

        Uses three matching strategies:
        1. Direct substring match (exact)
        2. Word-level: greeting + trigger word (with phonetic fallback)
        3. Fuzzy full-phrase match (stricter threshold)
        """
        text_lower = text.lower().strip().strip(".,!?;:'\"()[]{}")
        if not text_lower:
            return False

        # 1. Direct substring match against full wake phrases
        for phrase in self.WAKE_PHRASES:
            if phrase in text_lower:
                return True

        # Compact match (no spaces): e.g. "heynox"
        compact_text = text_lower.replace(" ", "")
        for phrase in self.WAKE_PHRASES:
            compact = phrase.replace(" ", "")
            if compact in compact_text:
                return True

        # 2. Word-level match: greeting + trigger word
        words = text_lower.replace(",", " ").replace(".", " ").replace("!", " ").split()
        words_clean = [w.strip(".,!?;:'\"") for w in words]
        has_greeting = any(w in self.GREETING_WORDS for w in words_clean)

        # Check trigger words with fuzzy + phonetic matching
        has_trigger = False
        for w in words_clean:
            if len(w) < 2:
                continue
            # Exact trigger word match
            if w in self.TRIGGER_WORDS:
                has_trigger = True
                break
            # Fuzzy match against trigger words
            for trigger in self.TRIGGER_WORDS:
                ratio = difflib.SequenceMatcher(None, trigger, w).ratio()
                if ratio >= self.WORD_FUZZY_THRESHOLD:
                    logger.debug("Word fuzzy match: '%s' ~ '%s' ratio=%.2f", w, trigger, ratio)
                    has_trigger = True
                    break
            if has_trigger:
                break
            # Phonetic match via Soundex
            word_sx = _soundex(w)
            for trigger, trigger_sx in _TRIGGER_SOUNDEX.items():
                if word_sx == trigger_sx and len(w) >= 3:
                    logger.debug("Phonetic match: '%s' ~ '%s' (soundex=%s)", w, trigger, word_sx)
                    has_trigger = True
                    break
            if has_trigger:
                break

        if has_greeting and has_trigger:
            return True

        # 3. Fuzzy full-phrase match — stricter threshold
        for phrase in self.WAKE_PHRASES:
            ratio = difflib.SequenceMatcher(None, phrase, text_lower).ratio()
            if ratio >= self.FULL_PHRASE_FUZZY_THRESHOLD:
                logger.debug("Full-phrase fuzzy match: '%s' vs '%s' ratio=%.2f", text_lower, phrase, ratio)
                return True

        return False

    # ------------------------------------------------------------------
    # Main listening loop
    # ------------------------------------------------------------------

    def _run(self) -> None:
        chunk_size = self.VAD_FRAME_SIZE
        try:
            with sd.InputStream(
                samplerate=self.SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=chunk_size,
                device=self._device_index,
            ) as stream:
                while self._running:
                    if self._paused:
                        time.sleep(0.05)
                        continue

                    try:
                        data, overflowed = stream.read(chunk_size)
                    except sd.PortAudioError:
                        continue
                    if overflowed:
                        continue

                    audio_chunk = data.flatten()

                    # Two-stage speech detection
                    is_speech = self._is_speech_vad(audio_chunk)

                    if not is_speech:
                        # Update adaptive noise floor with non-speech audio
                        self._update_noise_floor(audio_chunk)
                        continue

                    # Secondary check: RMS must be above adaptive threshold
                    # (rejects sounds that VAD misclassifies as speech)
                    rms = self._rms(audio_chunk)
                    if rms < self._noise_floor * self.RMS_SPEECH_MULTIPLIER:
                        self._update_noise_floor(audio_chunk)
                        continue

                    # Speech detected — start recording a phrase
                    logger.debug(
                        "Speech detected (rms=%.4f, noise_floor=%.4f, threshold=%.4f)",
                        rms, self._noise_floor, self._noise_floor * self.RMS_SPEECH_MULTIPLIER,
                    )
                    phrase_audio = self._record_phrase(stream)

                    if phrase_audio is None:
                        continue
                    if len(phrase_audio) < self.SAMPLE_RATE * self.MIN_SPEECH_DURATION:
                        logger.debug("Phrase too short (%.1fs < %.1fs) — skipping",
                                     len(phrase_audio) / self.SAMPLE_RATE, self.MIN_SPEECH_DURATION)
                        continue

                    # Transcribe with moderate beam_size for accuracy/speed balance
                    try:
                        text = self.stt.transcribe(phrase_audio, beam_size=3)
                    except Exception as exc:
                        logger.debug("STT error in wake word: %s", exc)
                        continue

                    if not text:
                        continue

                    logger.debug("Wake word STT: '%s' (noise_floor=%.4f)", text[:100], self._noise_floor)
                    if self._matches_wake_phrase(text):
                        logger.info("Wake word detected via STT: '%s'", text[:100])
                        if self.on_wake:
                            try:
                                self.on_wake()
                            except Exception as exc:
                                logger.error("Wake callback error: %s", exc, exc_info=True)
                        time.sleep(self.COOLDOWN)
                    else:
                        # Brief cooldown even on non-match to avoid rapid re-triggering
                        time.sleep(0.2)

        except Exception as exc:
            logger.error("STT wake word listener error: %s", exc, exc_info=True)

    def _record_phrase(self, stream) -> Optional[np.ndarray]:
        """Record audio until silence is detected or max duration reached.

        Uses webrtcvad for silence detection (more accurate than energy threshold).
        Also uses adaptive RMS as secondary silence detector.
        """
        chunk_size = self.VAD_FRAME_SIZE
        collected = []
        silence_frames = 0
        silence_limit_frames = int(self.SILENCE_LIMIT * self.SAMPLE_RATE / chunk_size)
        max_frames = int(self.MAX_PHRASE_DURATION * self.SAMPLE_RATE / chunk_size)
        speech_frames = 0

        for i in range(max_frames):
            if not self._running or self._paused:
                break
            try:
                data, _ = stream.read(chunk_size)
            except sd.PortAudioError:
                continue
            chunk = data.flatten()
            collected.append(chunk)

            # Use VAD + RMS for speech/silence detection
            is_speech = self._is_speech_vad(chunk)
            rms = self._rms(chunk)

            if is_speech and rms > self._noise_floor * self.RMS_SPEECH_MULTIPLIER:
                silence_frames = 0
                speech_frames += 1
            else:
                silence_frames += 1
                # Update noise floor during silence in phrase
                self._update_noise_floor(chunk)

            if silence_frames >= silence_limit_frames and len(collected) > 3:
                break

        if not collected:
            return None

        logger.debug("Recorded %d frames (%.1fs), %d speech frames",
                     len(collected), len(collected) * chunk_size / self.SAMPLE_RATE, speech_frames)
        return np.concatenate(collected)
