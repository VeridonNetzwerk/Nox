"""Speech-to-Text via faster-whisper (CUDA).

Transcribes audio numpy arrays to text. Model is loaded lazily on first use
to keep startup fast and avoid GPU memory allocation when not needed.
"""

import logging
from typing import Optional

logger = logging.getLogger("nox.voice.stt")

# Conditional import
try:
    from faster_whisper import WhisperModel
    _WHISPER_AVAILABLE = True
except ImportError:
    _WHISPER_AVAILABLE = False


class STTEngine:
    """faster-whisper based speech-to-text engine."""

    def __init__(
        self,
        model_size: str = "small",
        device: str = "cuda",
        compute_type: str = "float16",
        language: str = "de",
    ):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self._model: Optional["WhisperModel"] = None

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
        logger.info("Whisper model loaded")

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
            # language=None enables auto-detect; we pass the configured language
            # as a hint but allow auto-detect for English fallback
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
