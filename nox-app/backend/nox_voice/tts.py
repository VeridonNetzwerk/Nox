"""Text-to-Speech via Piper.

Synthesizes text to audio and plays it through the default audio device.
Supports sentence-by-sentence streaming for low-latency output.

Piper is called via its Python bindings (piper1-gpl) or falls back to
subprocess invocation of the piper executable.
"""

import logging
import os
import re
import threading
import time
import io
import wave
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger("nox.voice.tts")

# Conditional imports for audio playback
try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

# Conditional import for Piper
try:
    import piper
    _PIPER_AVAILABLE = True
except ImportError:
    _PIPER_AVAILABLE = False


class TTSEngine:
    """Piper-based text-to-speech engine with sentence streaming."""

    def __init__(
        self,
        model_path: str = "",
        model_name: str = "de_DE-thorsten-medium",
        sample_rate: int = 22050,
        models_dir: str = "",
        output_device: Optional[Union[str, int]] = None,
    ):
        self.model_path = model_path
        self.model_name = model_name
        self.sample_rate = sample_rate
        self.models_dir = models_dir
        self.output_device = output_device
        self._voice = None
        self._lock = threading.Lock()
        self._is_speaking = False
        self._device_index: Optional[int] = None

    def _resolve_device(self):
        """Resolve configured output device name/index to a sounddevice index."""
        from .audio_devices import resolve_output_device
        self._device_index = resolve_output_device(self.output_device)

    def update_output_device(self, device: Optional[Union[str, int]]) -> None:
        """Update the configured output device (takes effect on next playback)."""
        self.output_device = device

    @property
    def is_available(self) -> bool:
        return _PIPER_AVAILABLE and _SD_AVAILABLE

    def _resolve_model_path(self) -> Optional[str]:
        """Find the Piper .onnx voice model file."""
        if self.model_path and os.path.exists(self.model_path):
            return self.model_path

        # Search in models_dir (passed from VoiceManager, may be NOX_MODELS_DIR)
        if self.models_dir:
            candidate = Path(self.models_dir) / f"{self.model_name}.onnx"
            if candidate.exists():
                return str(candidate)

        # Search in NOX_MODELS_DIR env var (production)
        env_models = os.environ.get("NOX_MODELS_DIR")
        if env_models:
            candidate = Path(env_models) / "piper-models" / f"{self.model_name}.onnx"
            if candidate.exists():
                return str(candidate)

        # Search relative to project (dev mode)
        project_models = Path(__file__).parent.parent.parent / "models" / "piper-models"
        candidate = project_models / f"{self.model_name}.onnx"
        if candidate.exists():
            return str(candidate)

        logger.warning("Piper model not found: %s", self.model_name)
        return None

    def _ensure_voice(self):
        """Lazily load the Piper voice model."""
        if self._voice is not None:
            return

        model_path = self._resolve_model_path()
        if model_path is None:
            raise RuntimeError(f"Piper voice model not found: {self.model_name}")

        config_path = model_path.replace(".onnx", ".onnx.json")
        logger.info("Loading Piper voice: %s", model_path)

        self._voice = piper.PiperVoice.load(
            model_path,
            config_path=config_path if os.path.exists(config_path) else None,
        )
        logger.info("Piper voice loaded")

    @staticmethod
    def split_sentences(text: str) -> list[str]:
        """Split text into sentences for streaming TTS."""
        # Split on sentence-ending punctuation, keeping the delimiter
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return [s.strip() for s in sentences if s.strip()]

    def speak_text(self, text: str) -> None:
        """Synthesize and play a complete text string (blocking)."""
        if not text.strip():
            return

        if not self.is_available:
            logger.warning("TTS unavailable: piper=%s, sounddevice=%s",
                           _PIPER_AVAILABLE, _SD_AVAILABLE)
            return

        with self._lock:
            self._is_speaking = True
            try:
                self._ensure_voice()
                sentences = self.split_sentences(text)
                for sentence in sentences:
                    self._synthesize_and_play(sentence)
            except Exception as exc:
                logger.error("TTS error: %s", exc, exc_info=True)
            finally:
                self._is_speaking = False

    def speak_sentence(self, sentence: str) -> None:
        """Synthesize and play a single sentence (blocking, for streaming)."""
        if not sentence.strip():
            return

        if not self.is_available:
            return

        with self._lock:
            self._is_speaking = True
            try:
                self._ensure_voice()
                self._synthesize_and_play(sentence)
            except Exception as exc:
                logger.error("TTS sentence error: %s", exc, exc_info=True)
            finally:
                self._is_speaking = False

    def _synthesize_and_play(self, text: str) -> None:
        """Synthesize one sentence via Piper and play via sounddevice."""
        try:
            import numpy as np

            audio_chunks = []
            for chunk in self._voice.synthesize(text):
                audio_chunks.append(chunk.audio_float_array)

            if not audio_chunks:
                return

            audio = np.concatenate(audio_chunks)

            self._resolve_device()
            sd.play(audio, self.sample_rate, device=self._device_index)
            sd.wait()
        except Exception as exc:
            logger.error("Synthesis/playback error: %s", exc, exc_info=True)

    @property
    def is_speaking(self) -> bool:
        return self._is_speaking

    def stop(self) -> None:
        """Stop current playback."""
        if _SD_AVAILABLE:
            try:
                sd.stop()
            except Exception:
                pass
        self._is_speaking = False

    def synthesize_to_wav(self, text: str) -> Optional[bytes]:
        """Synthesize text and return WAV-encoded audio bytes.

        Uses the currently configured voice model.
        Returns None on error.
        """
        if not text.strip():
            return None

        if not _PIPER_AVAILABLE:
            logger.warning("Piper not available for synthesis")
            return None

        try:
            self._ensure_voice()
            import numpy as np

            audio_chunks = []
            for chunk in self._voice.synthesize(text):
                audio_chunks.append(chunk.audio_float_array)

            if not audio_chunks:
                return None

            audio = np.concatenate(audio_chunks)
            # Convert float32 to int16
            audio_int16 = (audio * 32767).astype(np.int16)

            # Write to WAV in-memory
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(self.sample_rate)
                wav.writeframes(audio_int16.tobytes())
            return buf.getvalue()

        except Exception as exc:
            logger.error("synthesize_to_wav error: %s", exc, exc_info=True)
            return None


def preview_voice_to_wav(model_name: str, text: str, models_dir: str = "") -> Optional[bytes]:
    """Synthesize text with a specific voice model and return WAV bytes.

    This loads a voice model temporarily (without changing the main TTSEngine)
    and is used for the voice preview/demo feature.

    Args:
        model_name: e.g. "de_DE-thorsten-medium"
        text: Text to synthesize
        models_dir: Optional models directory path

    Returns:
        WAV bytes or None on error.
    """
    if not _PIPER_AVAILABLE:
        logger.warning("Piper not available for preview")
        return None

    # Resolve model path
    model_path = None

    if models_dir:
        candidate = Path(models_dir) / f"{model_name}.onnx"
        if candidate.exists():
            model_path = str(candidate)

    if not model_path:
        env_models = os.environ.get("NOX_MODELS_DIR")
        if env_models:
            candidate = Path(env_models) / "piper-models" / f"{model_name}.onnx"
            if candidate.exists():
                model_path = str(candidate)

    if not model_path:
        project_models = Path(__file__).parent.parent.parent / "models" / "piper-models"
        candidate = project_models / f"{model_name}.onnx"
        if candidate.exists():
            model_path = str(candidate)

    if not model_path:
        logger.warning("Preview: model not found: %s", model_name)
        return None

    config_path = model_path.replace(".onnx", ".onnx.json")

    try:
        import numpy as np

        logger.info("Preview: loading voice %s", model_path)
        voice = piper.PiperVoice.load(
            model_path,
            config_path=config_path if os.path.exists(config_path) else None,
        )

        audio_chunks = []
        for chunk in voice.synthesize(text):
            audio_chunks.append(chunk.audio_float_array)

        if not audio_chunks:
            return None

        audio = np.concatenate(audio_chunks)
        audio_int16 = (audio * 32767).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(22050)
            wav.writeframes(audio_int16.tobytes())
        return buf.getvalue()

    except Exception as exc:
        logger.error("Preview synthesis error: %s", exc, exc_info=True)
        return None
