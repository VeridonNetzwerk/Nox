"""Speech-to-Text via faster-whisper.

Auto-detects CUDA and falls back to CPU with int8 for maximum compatibility.
Runs on any hardware — from high-end GPUs to potato laptops.
"""

import logging
from typing import Optional

logger = logging.getLogger("nox.voice.stt")

try:
    from faster_whisper import WhisperModel
    _WHISPER_AVAILABLE = True
except ImportError:
    _WHISPER_AVAILABLE = False


def _detect_device() -> tuple[str, str]:
    """Auto-detect best available device and compute type.

    Returns (device, compute_type):
      - CUDA available  → ("cuda", "float16")
      - CUDA not found   → ("cpu", "int8")
    """
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except ImportError:
        pass

    try:
        import ctypes
        if ctypes.windll.LoadLibrary("cudart64_12.dll"):
            return "cuda", "float16"
    except OSError:
        pass

    logger.info("No CUDA detected — using CPU with int8 (runs on any hardware)")
    return "cpu", "int8"


class STTEngine:
    """faster-whisper based speech-to-text engine with automatic device detection."""

    def __init__(
        self,
        model_size: str = "small",
        device: str = "auto",
        compute_type: str = "auto",
        language: str = "de",
    ):
        self.model_size = model_size
        self.language = language
        self._model: Optional["WhisperModel"] = None

        if device == "auto" or compute_type == "auto":
            self.device, self.compute_type = _detect_device()
        else:
            self.device = device
            self.compute_type = compute_type

    @property
    def is_available(self) -> bool:
        return _WHISPER_AVAILABLE

    def _ensure_model(self) -> None:
        """Lazily load the whisper model on first use."""
        if self._model is not None:
            return
        if not _WHISPER_AVAILABLE:
            raise RuntimeError("faster_whisper is not installed")
        logger.info(
            "Loading faster-whisper model: size=%s, device=%s, compute_type=%s",
            self.model_size, self.device, self.compute_type,
        )
        self._model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
        )
        logger.info("Whisper model loaded (%s/%s)", self.device, self.compute_type)

    def transcribe(self, audio, beam_size: int = 5) -> str:
        """Transcribe audio numpy array to text.

        Args:
            audio: float32 numpy array, mono, 16kHz.
            beam_size: Beam search width (1 for fast speculative, 5 for quality).

        Returns:
            Transcribed text string. Empty string on failure.
        """
        if not _WHISPER_AVAILABLE:
            logger.warning("faster_whisper not installed – cannot transcribe")
            return ""

        if audio is None or len(audio) == 0:
            logger.warning("Empty audio – nothing to transcribe")
            return ""

        try:
            self._ensure_model()
        except Exception as exc:
            logger.error("Failed to load whisper model: %s", exc, exc_info=True)
            return ""

        try:
            segments, _info = self._model.transcribe(
                audio,
                language=self.language,
                beam_size=beam_size,
                vad_filter=True,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            logger.info("Transcription: %s", text[:200])
            return text
        except Exception as exc:
            logger.error("Transcription error: %s", exc, exc_info=True)
            return ""
