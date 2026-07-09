"""Wake Word detection via openWakeWord (ONNX).

Continuously listens to the microphone and calls a callback when the
configured wake word model scores above a threshold.

Runs in a daemon thread so it never blocks the async event loop.
"""

import logging
import os
import threading
import time
from typing import Callable, Optional, Union

logger = logging.getLogger("nox.voice.wake_word")

# Conditional imports
try:
    import numpy as np
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

try:
    from openwakeword.model import Model as OWWModel
    _OWW_AVAILABLE = True
except ImportError:
    _OWW_AVAILABLE = False


def _ensure_oww_resources():
    """Ensure openWakeWord resource models (melspectrogram.onnx etc.) exist."""
    if not _OWW_AVAILABLE:
        return
    import os
    pkg_dir = os.path.dirname(__import__("openwakeword").__file__)
    resources_dir = os.path.join(pkg_dir, "resources", "models")
    if not os.path.exists(resources_dir) or not os.path.exists(os.path.join(resources_dir, "melspectrogram.onnx")):
        try:
            from openwakeword.utils import download_models
            logger.info("Downloading openWakeWord resource models...")
            download_models()
            logger.info("openWakeWord resource models downloaded")
        except Exception as exc:
            logger.error("Failed to download openWakeWord resources: %s", exc)


class WakeWordListener:
    """Continuous wake word listener using openWakeWord + sounddevice."""

    CHUNK_SIZE = 1280  # 80ms at 16kHz – required by openWakeWord ONNX models

    def __init__(
        self,
        model_path: str,
        threshold: float = 0.5,
        sample_rate: int = 16000,
        input_device: Optional[Union[str, int]] = None,
    ):
        self.model_path = model_path
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.input_device = input_device
        self.on_wake: Optional[Callable[[], None]] = None
        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._model = None
        self._model_name: Optional[str] = None
        self._device_index: Optional[int] = None

    def _resolve_device(self):
        """Resolve configured device name/index to a sounddevice index."""
        from .audio_devices import resolve_input_device
        self._device_index = resolve_input_device(self.input_device)

    def update_input_device(self, device: Optional[Union[str, int]]) -> None:
        """Hot-reload: update input device and restart stream."""
        was_running = self._running
        if was_running:
            self.stop()
        self.input_device = device
        if was_running:
            self.start()

    @property
    def is_available(self) -> bool:
        return _SD_AVAILABLE and _OWW_AVAILABLE

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def start(self) -> None:
        if not self.is_available:
            logger.warning(
                "WakeWordListener unavailable: sounddevice=%s, openwakeword=%s",
                _SD_AVAILABLE, _OWW_AVAILABLE,
            )
            return

        # Load model — support both file paths and built-in model names
        try:
            _ensure_oww_resources()
            if os.path.exists(self.model_path):
                self._model = OWWModel(wakeword_models=[self.model_path])
                self._model_name = os.path.splitext(os.path.basename(self.model_path))[0]
            else:
                # Try built-in model by name (e.g. "hey_jarvis")
                # If the basename has no file extension, treat it as a built-in model name
                basename = os.path.basename(self.model_path.rstrip("/\\"))
                if "." not in basename:
                    self._model = OWWModel(wakeword_models=[basename])
                    self._model_name = basename
                else:
                    logger.error(
                        "Wake word model not found at %s – cannot start wake word listener. "
                        "Run onboarding to download the wake word model.",
                        self.model_path,
                    )
                    return
            logger.info("Wake word model loaded: %s", self._model_name)
        except Exception as exc:
            logger.error("Failed to load wake word model: %s", exc, exc_info=True)
            return

        self._resolve_device()

        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True, name="wake-word")
        self._thread.start()
        logger.info("Wake word listener started (threshold=%.2f, device=%s)", self.threshold, self._device_index)

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        logger.info("Wake word listener stopped")

    def pause(self) -> None:
        self._paused = True
        logger.debug("Wake word listener paused")

    def resume(self) -> None:
        self._paused = False
        logger.debug("Wake word listener resumed")

    def _run(self) -> None:
        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
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
                    try:
                        scores = self._model.predict(audio_chunk)
                    except Exception:
                        continue

                    # Check all model scores
                    for name, score in scores.items():
                        if score >= self.threshold:
                            logger.info(
                                "Wake word detected: %s (score=%.3f)", name, score,
                            )
                            if self.on_wake:
                                try:
                                    self.on_wake()
                                except Exception as exc:
                                    logger.error("Wake callback error: %s", exc, exc_info=True)
                            # Brief cooldown to avoid double-trigger
                            time.sleep(0.5)
                            break

        except Exception as exc:
            logger.error("Wake word listener error: %s", exc, exc_info=True)
