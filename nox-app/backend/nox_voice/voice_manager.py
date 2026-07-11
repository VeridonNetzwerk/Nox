"""Voice Manager – orchestrates wake word, STT, and TTS.

Coordinates the full voice pipeline:
1. Wake word listener runs continuously in a daemon thread
2. On wake detection → record audio via VAD → transcribe via Whisper
3. Transcription is sent to the orchestrator as a chat message
4. LLM response tokens are buffered into sentences and sent to Piper TTS
5. Microphone is paused during TTS playback to prevent echo

All operations are async-safe: wake word runs in a thread, STT runs in a
thread pool, TTS runs in a separate thread. None of these block the
FastAPI event loop.
"""

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from .wake_word import WakeWordListener
from .stt_wake_word import STTWakeWordListener, _SD_AVAILABLE
from .vad import VADRecorder
from .stt import STTEngine
from .tts import TTSEngine
from .tts_edge import _EDGE_AVAILABLE, edge_tts_to_wav
from .tts_kokoro import is_kokoro_available, kokoro_to_wav, get_kokoro_lang_code

logger = logging.getLogger("nox.voice.manager")

# State machine states
STATE_IDLE = "idle"
STATE_LISTENING = "listening"
STATE_TRANSCRIBING = "transcribing"
STATE_THINKING = "thinking"
STATE_SPEAKING = "speaking"


class VoiceManager:
    """Coordinates the complete voice pipeline with event callbacks."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._state = STATE_IDLE
        self._on_state_change: Optional[Callable[[str], None]] = None
        self._on_transcript: Optional[Callable[[str], None]] = None
        self._on_wake: Optional[Callable[[], None]] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Resolve model paths: prefer NOX_MODELS_DIR env var (production),
        # fall back to project root models/ (dev)
        import os as _os
        env_models = _os.environ.get("NOX_MODELS_DIR")
        if env_models:
            models_dir = Path(env_models)
        else:
            models_dir = Path(__file__).parent.parent.parent / "models"

        # Audio devices
        input_device = config.get("audio_input_device", "default")
        output_device = config.get("audio_output_device", "default")

        # Wake Word — try openWakeWord first, fall back to STT-based
        wake_model_path = str(models_dir / config.get("wake_word_model", "hey_nox.onnx"))
        oww_listener = WakeWordListener(
            model_path=wake_model_path,
            threshold=config.get("wake_word_threshold", 0.5),
            input_device=input_device,
        )

        # STT engine is needed for STT-based wake word fallback
        # STT is lazily loaded, so this is cheap
        stt_engine = STTEngine(
            model_size=config.get("stt_model", "small"),
            device=config.get("stt_device", "cuda"),
            compute_type=config.get("stt_compute_type", "float16"),
            language=config.get("stt_language", "de"),
        )

        stt_wake = STTWakeWordListener(
            stt_engine=stt_engine,
            threshold=config.get("wake_word_threshold", 0.5),
            input_device=input_device,
            wake_phrases=config.get("wake_word_phrases", ["hey nox", "hei nox", "hay nox"]),
        )

        # Decide which listener to use: prefer openWakeWord if available,
        # otherwise use STT-based
        if oww_listener.is_available:
            # Test if the model actually works by checking if it's a real custom model
            # (not a copy of hey_jarvis). We check file hash against known hey_jarvis hash.
            import hashlib
            try:
                import os as _os2
                if _os2.path.exists(wake_model_path):
                    h = hashlib.md5()
                    with open(wake_model_path, "rb") as f:
                        while True:
                            chunk = f.read(8192)
                            if not chunk:
                                break
                            h.update(chunk)
                    model_hash = h.hexdigest()
                    # Known hey_jarvis hash (openWakeWord built-in)
                    if model_hash == "de6abe00036ec10b675a679f45c5c643":
                        logger.warning(
                            "Wake word model is a copy of hey_jarvis — using STT-based wake word detection instead"
                        )
                        self.wake_word = stt_wake
                    else:
                        self.wake_word = oww_listener
                else:
                    logger.warning("Wake word model not found — using STT-based wake word detection")
                    self.wake_word = stt_wake
            except Exception as exc:
                logger.warning("Failed to check wake word model, using openWakeWord: %s", exc)
                self.wake_word = oww_listener
        else:
            logger.info("openWakeWord not available — using STT-based wake word detection")
            self.wake_word = stt_wake

        self.wake_word.on_wake = self._on_wake_detected

        # VAD Recorder with end-of-turn detection
        self.recorder = VADRecorder(
            silence_duration=config.get("vad_silence_duration", 1.0),
            timeout=config.get("vad_timeout", 15.0),
            initial_silence_timeout=config.get("vad_initial_silence_timeout", 3.0),
            aggressiveness=config.get("vad_aggressiveness", 3),
            input_device=input_device,
            speech_onset_frames=config.get("vad_speech_onset_frames", 3),
            end_turn_enabled=config.get("end_turn_enabled", True),
            end_turn_silence_threshold=config.get("end_turn_silence_threshold", 1.0),
            end_turn_max_silence=config.get("end_turn_max_silence", 2.5),
            end_turn_fillword_extension=config.get("end_turn_fillword_extension", 0.8),
            end_turn_incomplete_sentence_extension=config.get("end_turn_incomplete_sentence_extension", 1.0),
            on_partial_transcript=self._partial_transcribe,
        )

        # STT — reuse the engine created for wake word if it's the STT-based listener
        if isinstance(self.wake_word, STTWakeWordListener):
            self.stt = self.wake_word.stt
        else:
            self.stt = stt_engine

        # TTS — Piper is the fallback engine; Edge/Kokoro are used based on tts_engine setting
        tts_models_dir = str(models_dir / "piper-models")
        self.tts = TTSEngine(
            model_name=config.get("tts_model", "de_DE-thorsten-medium"),
            sample_rate=config.get("tts_sample_rate", 22050),
            models_dir=tts_models_dir,
            output_device=output_device,
        )
        # Multi-engine TTS settings
        self.tts_engine = config.get("tts_engine", "piper")
        self.tts_voice_id = config.get("tts_voice_id", "")
        # If tts_engine is edge/kokoro, tts_model holds the voice_id for that engine
        if self.tts_engine in ("edge", "kokoro") and config.get("tts_model"):
            self.tts_voice_id = config["tts_model"]

        self._enabled = config.get("wake_word_enabled", False)
        self._active_sentences = 0
        self._state_lock = threading.Lock()

    @property
    def state(self) -> str:
        return self._state

    @property
    def is_available(self) -> bool:
        """Check if the minimum required components are available."""
        return self.wake_word.is_available or (
            hasattr(self, 'stt') and self.stt.is_available and _SD_AVAILABLE
        )

    def set_callbacks(
        self,
        on_state_change: Optional[Callable[[str], None]] = None,
        on_transcript: Optional[Callable[[str], None]] = None,
        on_wake: Optional[Callable[[], None]] = None,
    ) -> None:
        self._on_state_change = on_state_change
        self._on_transcript = on_transcript
        self._on_wake = on_wake

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def _set_state(self, state: str) -> None:
        if self._state == state:
            return
        self._state = state
        logger.info("Voice state: %s", state)
        if self._on_state_change:
            try:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._async_state_change(state), self._loop
                    )
                elif callable(self._on_state_change):
                    self._on_state_change(state)
                else:
                    logger.warning("Cannot broadcast state change: no loop and no sync callback")
            except Exception as exc:
                logger.error("State change callback error: %s", exc, exc_info=True)

    async def _async_state_change(self, state: str) -> None:
        if self._on_state_change:
            result = self._on_state_change(state)
            if asyncio.iscoroutine(result):
                await result

    def start(self) -> None:
        """Start the wake word listener if enabled."""
        if not self._enabled:
            logger.info("Voice pipeline disabled in config")
            return
        if not self.is_available:
            logger.warning("Voice pipeline not available – missing dependencies")
            return
        self.wake_word.start()
        self._set_state(STATE_IDLE)

    def stop(self) -> None:
        """Stop all voice components."""
        self.wake_word.stop()
        self.tts.stop()
        self._set_state(STATE_IDLE)

    def pause_wake_word(self) -> None:
        """Pause wake word detection (e.g. during TTS playback)."""
        self.wake_word.pause()

    def resume_wake_word(self) -> None:
        """Resume wake word detection."""
        self.wake_word.resume()

    def _on_wake_detected(self) -> None:
        """Called by the wake word listener thread or manual voice_trigger."""
        logger.info("Wake word detected – starting recording")

        # Notify UI
        self._set_state(STATE_LISTENING)
        if self._on_wake:
            try:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._async_wake(), self._loop
                    )
                else:
                    logger.warning("No running event loop for wake callback")
            except Exception as exc:
                logger.error("Wake callback error: %s", exc, exc_info=True)

        # Pause wake word during recording
        self.wake_word.pause()

        # Record + transcribe in a separate thread
        threading.Thread(
            target=self._record_and_transcribe, daemon=True, name="stt-pipeline"
        ).start()

    async def _async_wake(self) -> None:
        if self._on_wake:
            result = self._on_wake()
            if asyncio.iscoroutine(result):
                await result

    def _partial_transcribe(self, audio: "np.ndarray") -> str:
        """Speculative transcription: get a partial transcript for end-of-turn heuristics.

        Called by VADRecorder during recording to check if the user's sentence
        appears complete or contains fill words. Uses a fast, lightweight
        Whisper call on the most recent audio chunk.
        """
        if not hasattr(self, 'stt') or not self.stt.is_available:
            return ""
        try:
            # Use a quick transcription with no language detection overhead
            import numpy as np
            if len(audio) < 1600:  # Less than 0.1s of audio
                return ""
            # Transcribe with beam_size=1 for speed (speculative, not final)
            text = self.stt.transcribe(audio, beam_size=1)
            logger.debug("Partial transcript: %s", text[:80] if text else "(empty)")
            return text or ""
        except Exception as exc:
            logger.debug("Partial transcription error: %s", exc)
            return ""

    def _record_and_transcribe(self) -> None:
        """Record audio via VAD and transcribe via Whisper (blocking thread).

        The VAD recorder uses end-of-turn detection (silence + heuristic)
        to decide when the user has finished speaking. Only after the
        recorder returns does the final transcription run and the
        transcript get committed to the orchestrator.
        """
        try:
            # Record (VAD + end-of-turn detection decides when to stop)
            audio = self.recorder.record()
            if len(audio) == 0:
                logger.warning("No audio recorded")
                self._set_state(STATE_IDLE)
                self.wake_word.resume()
                return

            # Final transcription (full quality, not the speculative partial)
            self._set_state(STATE_TRANSCRIBING)
            transcript = self.stt.transcribe(audio)

            if not transcript:
                logger.warning("No transcription produced")
                self._set_state(STATE_IDLE)
                self.wake_word.resume()
                return

            # Commit: only now do we transition to thinking and send to orchestrator
            self._set_state(STATE_THINKING)
            if self._on_transcript:
                try:
                    if self._loop and self._loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            self._async_transcript(transcript), self._loop
                        )
                except Exception as exc:
                    logger.error("Transcript callback error: %s", exc, exc_info=True)

        except Exception as exc:
            logger.error("STT pipeline error: %s", exc, exc_info=True)
            self._set_state(STATE_IDLE)
        finally:
            self.wake_word.resume()

    async def _async_transcript(self, transcript: str) -> None:
        if self._on_transcript:
            result = self._on_transcript(transcript)
            if asyncio.iscoroutine(result):
                await result

    def speak_response(self, text: str) -> None:
        """Speak a complete response text (non-blocking, runs in thread)."""
        threading.Thread(
            target=self._speak, args=(text,), daemon=True, name="tts-playback"
        ).start()

    def speak_sentence(self, sentence: str) -> None:
        """Speak a single sentence for streaming TTS (non-blocking)."""
        threading.Thread(
            target=self._speak_sentence, args=(sentence,), daemon=True, name="tts-sentence"
        ).start()

    def _speak(self, text: str) -> None:
        """Internal: speak full text (blocking thread)."""
        self._set_state(STATE_SPEAKING)
        self.wake_word.pause()
        try:
            if self.tts_engine == "edge" and self.tts_voice_id:
                self._speak_edge(text)
            elif self.tts_engine == "kokoro" and self.tts_voice_id:
                self._speak_kokoro(text)
            else:
                self.tts.speak_text(text)
        finally:
            self.wake_word.resume()
            self._set_state(STATE_IDLE)

    def _speak_sentence(self, sentence: str) -> None:
        """Internal: speak one sentence (blocking thread)."""
        with self._state_lock:
            self._active_sentences += 1
        if self._state != STATE_SPEAKING:
            self._set_state(STATE_SPEAKING)
        self.wake_word.pause()
        try:
            if self.tts_engine == "edge" and self.tts_voice_id:
                self._speak_edge(sentence)
            elif self.tts_engine == "kokoro" and self.tts_voice_id:
                self._speak_kokoro(sentence)
            else:
                self.tts.speak_sentence(sentence)
        finally:
            with self._state_lock:
                self._active_sentences -= 1
                is_last = self._active_sentences <= 0
            if is_last:
                self.wake_word.resume()
                if self._state == STATE_SPEAKING:
                    self._set_state(STATE_IDLE)

    def _speak_edge(self, text: str) -> None:
        """Synthesize via Edge TTS and play via sounddevice."""
        if not _EDGE_AVAILABLE or not text.strip():
            return
        with self.tts._lock:
            try:
                loop = asyncio.new_event_loop()
                try:
                    wav_bytes = loop.run_until_complete(edge_tts_to_wav(self.tts_voice_id, text))
                finally:
                    loop.close()
                if wav_bytes:
                    self._play_wav(wav_bytes)
            except Exception as exc:
                logger.error("Edge TTS speak error: %s", exc, exc_info=True)

    def _speak_kokoro(self, text: str) -> None:
        """Synthesize via Kokoro TTS and play via sounddevice."""
        if not is_kokoro_available() or not text.strip():
            return
        # Determine language code from voice_id prefix
        lang_code = self._infer_lang_from_voice(self.tts_voice_id)
        if lang_code is None or get_kokoro_lang_code(lang_code) is None:
            logger.warning("Kokoro: cannot determine language for voice '%s', falling back to Piper", self.tts_voice_id)
            self.tts.speak_sentence(text)
            return
        with self.tts._lock:
            try:
                wav_bytes = kokoro_to_wav(text, self.tts_voice_id, lang_code)
                if wav_bytes:
                    self._play_wav(wav_bytes)
            except Exception as exc:
                logger.error("Kokoro TTS speak error: %s", exc, exc_info=True)
                # Fallback to Piper
                try:
                    self.tts.speak_sentence(text)
                except Exception:
                    pass

    @staticmethod
    def _infer_lang_from_voice(voice_id: str) -> Optional[str]:
        """Infer language code from voice ID."""
        # Edge voice IDs: de-DE-SeraphinaNeural -> de_DE
        if "-" in voice_id and voice_id.count("-") >= 2:
            parts = voice_id.split("-")
            return f"{parts[0]}_{parts[1]}"
        # Kokoro voice IDs: af_sky -> en_US, zf_xiaoxiao -> zh_CN, etc.
        kokoro_voice_map = {
            "af_": "en_US", "am_": "en_US",
            "bf_": "en_GB", "bm_": "en_GB",
            "ff_": "fr_FR", "fm_": "fr_FR",
            "ef_": "es_ES", "em_": "es_ES",
            "if_": "it_IT", "im_": "it_IT",
            "pf_": "pt_BR", "pm_": "pt_BR",
            "jf_": "ja_JP", "jm_": "ja_JP",
            "zf_": "zh_CN", "zm_": "zh_CN",
        }
        for prefix, lang in kokoro_voice_map.items():
            if voice_id.startswith(prefix):
                return lang
        return None

    def _play_wav(self, wav_bytes: bytes) -> None:
        """Play WAV bytes through sounddevice."""
        try:
            import numpy as np
            import io as _io
            import wave
            with wave.open(_io.BytesIO(wav_bytes), "rb") as wf:
                frames = wf.readframes(wf.getnframes())
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                sample_rate = wf.getframerate()
            self.tts._resolve_device()
            import sounddevice as sd
            sd.play(audio, sample_rate, device=self.tts._device_index)
            sd.wait()
        except Exception as exc:
            logger.error("WAV playback error: %s", exc, exc_info=True)

    def update_audio_devices(self, input_device, output_device) -> None:
        """Hot-reload audio devices without full restart."""
        self.wake_word.update_input_device(input_device)
        self.recorder.update_input_device(input_device)
        self.tts.update_output_device(output_device)
        logger.info("Audio devices updated: input=%s, output=%s", input_device, output_device)

    def health(self) -> dict[str, Any]:
        """Return health status of all voice components."""
        wake_info = {
            "available": self.wake_word.is_available,
            "running": self.wake_word._running,
        }
        if hasattr(self.wake_word, "model_path"):
            wake_info["model"] = self.wake_word.model_path
        elif isinstance(self.wake_word, STTWakeWordListener):
            wake_info["model"] = "stt-based"
        return {
            "wake_word": wake_info,
            "stt": {
                "available": self.stt.is_available,
                "model": self.stt.model_size,
                "device": self.stt.device,
            },
            "tts": {
                "available": self.tts.is_available,
                "model": self.tts.model_name,
                "speaking": self.tts.is_speaking,
            },
            "vad": {
                "available": self.recorder.is_available,
                "silence_duration": self.recorder.silence_duration,
                "end_turn_enabled": self.recorder.end_turn_enabled,
            },
            "state": self._state,
            "enabled": self._enabled,
        }
