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
from .vad import VADRecorder
from .stt import STTEngine
from .tts import TTSEngine

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

        # Wake Word
        wake_model_path = str(models_dir / config.get("wake_word_model", "hey_nox.onnx"))
        self.wake_word = WakeWordListener(
            model_path=wake_model_path,
            threshold=config.get("wake_word_threshold", 0.5),
            input_device=input_device,
        )
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

        # STT
        self.stt = STTEngine(
            model_size=config.get("stt_model", "small"),
            device=config.get("stt_device", "cuda"),
            compute_type=config.get("stt_compute_type", "float16"),
            language=config.get("stt_language", "de"),
        )

        # TTS
        tts_models_dir = str(models_dir / "piper-models")
        self.tts = TTSEngine(
            model_name=config.get("tts_model", "de_DE-thorsten-medium"),
            sample_rate=config.get("tts_sample_rate", 22050),
            models_dir=tts_models_dir,
            output_device=output_device,
        )

        self._enabled = config.get("wake_word_enabled", False)

    @property
    def state(self) -> str:
        return self._state

    @property
    def is_available(self) -> bool:
        """Check if the minimum required components are available."""
        return self.wake_word.is_available

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
            except Exception as exc:
                logger.error("State change callback error: %s", exc, exc_info=True)

    async def _async_state_change(self, state: str) -> None:
        if self._on_state_change:
            self._on_state_change(state)

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
        """Called by the wake word listener thread."""
        logger.info("Wake word detected – starting recording")

        # Notify UI
        self._set_state(STATE_LISTENING)
        if self._on_wake:
            try:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._async_wake(), self._loop
                    )
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
            self._on_wake()

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
            self._on_transcript(transcript)

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
            self.tts.speak_text(text)
        finally:
            self.wake_word.resume()
            self._set_state(STATE_IDLE)

    def _speak_sentence(self, sentence: str) -> None:
        """Internal: speak one sentence (blocking thread)."""
        if self._state != STATE_SPEAKING:
            self._set_state(STATE_SPEAKING)
        self.wake_word.pause()
        try:
            self.tts.speak_sentence(sentence)
        finally:
            self.wake_word.resume()
            if self._state == STATE_SPEAKING:
                self._set_state(STATE_IDLE)

    def update_audio_devices(self, input_device, output_device) -> None:
        """Hot-reload audio devices without full restart."""
        self.wake_word.update_input_device(input_device)
        self.recorder.update_input_device(input_device)
        self.tts.update_output_device(output_device)
        logger.info("Audio devices updated: input=%s, output=%s", input_device, output_device)

    def health(self) -> dict[str, Any]:
        """Return health status of all voice components."""
        return {
            "wake_word": {
                "available": self.wake_word.is_available,
                "running": self.wake_word._running,
                "model": self.wake_word.model_path,
            },
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
