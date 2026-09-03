"""Vision analyzer — uses local or cloud vision models to analyze screenshots.

Cascade (configurable via nox_eye_vision_provider):
1. Florence-2 (local, in-process, HuggingFace transformers) — primary
   - Microsoft Florence-2-large-ft (0.77B params, ~1.5GB VRAM at float16)
   - No Ollama or external server needed — runs directly in the Nox process
   - Uses <OCR> and <DETAILED_CAPTION> task prompts for screen analysis
2. OVHcloud AI Endpoints (Qwen2.5-VL-72B) — cloud fallback
3. Local Ollama vision model — offline fallback if enough free VRAM
4. Returns None if all fail — caller falls back to UIA/OCR

Threading: all methods are synchronous (called via run_in_executor).
The Florence-2 model is loaded lazily on first use and kept in VRAM.
A keep-alive timer auto-unloads it after configurable inactivity.
"""

import base64
import gc
import io
import logging
import subprocess
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger("nox.eye.vision")

# --- OVHcloud settings ---
_OVH_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"
_OVH_MODEL = "qwen2.5-vl-72b-instruct"
_OVH_TIMEOUT = 30.0
_OVH_MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 4 MiB limit

# --- Local Ollama settings ---
_DEFAULT_LOCAL_MODEL = "minicpm-v4.6"
_VRAM_THRESHOLD_MB = 4096  # need at least this much free VRAM for Ollama vision
_OLLAMA_TIMEOUT = 60.0

# --- Florence-2 settings ---
_FLORENCE2_MODEL = "microsoft/Florence-2-large-ft"
_FLORENCE2_VRAM_THRESHOLD_MB = 2048  # Florence-2-large needs ~1.5-2GB VRAM at float16
_FLORENCE2_KEEP_ALIVE_MINUTES = 5  # auto-unload after this many minutes idle
_FLORENCE2_MAX_IMAGE_DIM = 1920  # resize large screenshots to avoid excessive memory

# Prompt for cloud/local LLM-based vision (OVH, Ollama)
_SCREEN_ANALYSIS_PROMPT = (
    "Du siehst einen Screenshot eines Computer-Bildschirms. "
    "Beschreibe kurz was auf dem Bildschirm zu sehen ist. "
    "Falls ein Titel einer Serie, eines Films, eines Spiels oder einer Webseite erkennbar ist, "
    "nenne ihn deutlich. Falls Text erkennbar ist, gib die wichtigsten Texte wieder. "
    "Antworte auf Deutsch, kurz und prägnant (max. 5 Sätze)."
)


class _Florence2Model:
    """Florence-2 model holder with lazy loading, VRAM management, and auto-unload.

    Thread-safe. The model is loaded on first use and kept in VRAM.
    After keep_alive_minutes of inactivity, the model is unloaded to free VRAM.
    """

    def __init__(
        self,
        model_name: str = _FLORENCE2_MODEL,
        vram_threshold: int = _FLORENCE2_VRAM_THRESHOLD_MB,
        keep_alive_minutes: int = _FLORENCE2_KEEP_ALIVE_MINUTES,
    ):
        self.model_name = model_name
        self.vram_threshold = vram_threshold
        self.keep_alive_minutes = keep_alive_minutes
        self._model = None
        self._processor = None
        self._last_used: Optional[float] = None
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    def _has_enough_vram(self) -> bool:
        """Check if there's enough free VRAM for Florence-2."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                free_mb = int(result.stdout.strip().split("\n")[0].strip())
                logger.debug(
                    "Florence-2 VRAM check: %dMB free (threshold: %dMB)",
                    free_mb, self.vram_threshold,
                )
                return free_mb >= self.vram_threshold
        except Exception:
            pass
        return False

    def _load(self):
        """Load Florence-2 model and processor. Must be called within lock."""
        if self.is_loaded:
            return

        if not self._has_enough_vram():
            logger.info(
                "Not enough VRAM for Florence-2 (need %dMB free)",
                self.vram_threshold,
            )
            raise RuntimeError("not enough VRAM")

        import torch
        from transformers import AutoProcessor, AutoModelForCausalLM

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32

        logger.info("Loading Florence-2 model: %s on %s ...", self.model_name, device)
        self._model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            torch_dtype=dtype,
            trust_remote_code=True,
            attn_implementation="eager",
        ).to(device)
        self._model.eval()

        self._processor = AutoProcessor.from_pretrained(
            self.model_name,
            trust_remote_code=True,
        )

        self._last_used = time.time()
        logger.info("Florence-2 loaded successfully on %s", device)

    def _unload(self):
        """Unload model to free VRAM. Must be called within lock."""
        if not self.is_loaded:
            return

        logger.info("Unloading Florence-2 model to free VRAM")
        self._model = None
        self._processor = None

        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        logger.info("Florence-2 unloaded, VRAM freed")

    def _check_keep_alive(self):
        """Auto-unload if idle for too long. Must be called within lock."""
        if not self.is_loaded or self._last_used is None:
            return
        idle_minutes = (time.time() - self._last_used) / 60.0
        if idle_minutes > self.keep_alive_minutes:
            logger.debug(
                "Florence-2 idle for %.1f minutes (keep_alive=%d), unloading",
                idle_minutes, self.keep_alive_minutes,
            )
            self._unload()

    def _run_task(self, task_prompt: str, image, device: str, dtype) -> str:
        """Run a single Florence-2 task (OCR, caption, etc.) on the image."""
        import torch

        inputs = self._processor(
            text=task_prompt,
            images=image,
            return_tensors="pt",
        ).to(device, dtype)

        with torch.no_grad():
            generated_ids = self._model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                num_beams=3,
                do_sample=False,
                use_cache=False,
            )

        generated_text = self._processor.batch_decode(
            generated_ids, skip_special_tokens=False
        )[0]
        parsed = self._processor.post_process_generation(
            generated_text,
            task=task_prompt,
            image_size=(image.width, image.height),
        )
        return parsed.get(task_prompt, "").strip()

    def analyze(
        self,
        image_bytes: bytes,
        window_title: str = "",
        app_name: str = "",
    ) -> Optional[str]:
        """Analyze screenshot using Florence-2 OCR + detailed caption.

        Returns combined OCR text + caption, or None on failure.
        """
        with self._lock:
            try:
                self._check_keep_alive()
                self._load()

                import torch
                from PIL import Image

                image = Image.open(io.BytesIO(image_bytes))
                if image.mode != "RGB":
                    image = image.convert("RGB")

                # Resize if too large to avoid excessive memory usage
                max_dim = _FLORENCE2_MAX_IMAGE_DIM
                if max(image.width, image.height) > max_dim:
                    ratio = max_dim / max(image.width, image.height)
                    new_size = (int(image.width * ratio), int(image.height * ratio))
                    image = image.resize(new_size, Image.LANCZOS)
                    logger.debug(
                        "Resized image to %dx%d for Florence-2",
                        new_size[0], new_size[1],
                    )

                device = "cuda" if torch.cuda.is_available() else "cpu"
                dtype = torch.float16 if device == "cuda" else torch.float32

                results = []

                # Task 1: OCR — extract all visible text
                try:
                    ocr_text = self._run_task("<OCR>", image, device, dtype)
                    if ocr_text:
                        results.append(f"Erkannter Text:\n{ocr_text}")
                except Exception as exc:
                    logger.debug("Florence-2 OCR task failed: %s", exc)

                # Task 2: Detailed caption — describe what's on screen
                try:
                    caption = self._run_task("<DETAILED_CAPTION>", image, device, dtype)
                    if caption:
                        results.append(f"Bildbeschreibung:\n{caption}")
                except Exception as exc:
                    logger.debug("Florence-2 caption task failed: %s", exc)

                self._last_used = time.time()

                if results:
                    combined = "\n\n".join(results)
                    if window_title or app_name:
                        combined = (
                            f"Kontext: Fenster '{window_title}' (App: {app_name})\n"
                            f"{combined}"
                        )
                    return combined

            except ImportError as exc:
                logger.warning(
                    "Florence-2 dependencies missing (need torch + transformers): %s",
                    exc,
                )
            except RuntimeError as exc:
                if "VRAM" in str(exc):
                    logger.info("Florence-2 skipped: %s", exc)
                else:
                    logger.warning("Florence-2 runtime error: %s", exc)
            except Exception as exc:
                logger.warning("Florence-2 analysis failed: %s", exc, exc_info=True)

            return None

    def unload(self):
        """Explicitly unload the model (e.g., when VRAM is needed for text model)."""
        with self._lock:
            self._unload()


class VisionAnalyzer:
    """Analyzes screenshots using local or cloud vision models.

    Provider cascade (configurable via nox_eye_vision_provider):
    - 'florence2': Florence-2 first, then OVH fallback
    - 'ovh': OVH first, then Florence-2 fallback
    - 'local': Florence-2 first, then local Ollama fallback
    - 'auto': Florence-2 → OVH → local Ollama
    - 'off': disabled
    """

    # Shared Florence-2 model instance (singleton across all VisionAnalyzer instances)
    _florence2: Optional[_Florence2Model] = None
    _florence2_lock = threading.Lock()

    def __init__(self, config: dict):
        self.config = config
        self.provider = config.get("nox_eye_vision_provider", "auto")
        self.local_model = config.get("nox_eye_vision_local_model", _DEFAULT_LOCAL_MODEL)
        self.vram_threshold = config.get(
            "nox_eye_vision_local_vram_threshold", _VRAM_THRESHOLD_MB
        )
        self.ollama_host = config.get("ollama_host", "http://localhost:11434")
        self.ovh_token = config.get("nox_eye_vision_ovh_token", "")

        # Florence-2 config
        florence2_model = config.get(
            "nox_eye_vision_florence2_model", _FLORENCE2_MODEL
        )
        florence2_vram = config.get(
            "nox_eye_vision_florence2_vram_threshold",
            _FLORENCE2_VRAM_THRESHOLD_MB,
        )
        florence2_keep_alive = config.get(
            "nox_eye_vision_florence2_keep_alive",
            _FLORENCE2_KEEP_ALIVE_MINUTES,
        )

        # Initialize shared Florence-2 singleton
        with VisionAnalyzer._florence2_lock:
            if VisionAnalyzer._florence2 is None:
                VisionAnalyzer._florence2 = _Florence2Model(
                    model_name=florence2_model,
                    vram_threshold=florence2_vram,
                    keep_alive_minutes=florence2_keep_alive,
                )

    @property
    def is_enabled(self) -> bool:
        return self.provider != "off"

    def analyze_screenshot(
        self,
        image_bytes: bytes,
        window_title: str = "",
        app_name: str = "",
    ) -> Optional[str]:
        """Analyze a screenshot and return a text description.

        Args:
            image_bytes: JPEG-compressed screenshot bytes
            window_title: Title of the active window (for context)
            app_name: Name of the active app (for context)

        Returns:
            Text description of the screenshot, or None if all providers failed.
        """
        if not self.is_enabled:
            return None

        # Prepare a size-limited copy for OVH (Florence-2 handles large images fine)
        ovh_bytes = self._ensure_size_limit(image_bytes, _OVH_MAX_IMAGE_BYTES)

        # Provider cascade
        if self.provider == "florence2":
            return (
                self._try_florence2(image_bytes, window_title, app_name)
                or self._try_ovh(ovh_bytes, window_title, app_name)
            )

        if self.provider == "ovh":
            return (
                self._try_ovh(ovh_bytes, window_title, app_name)
                or self._try_florence2(image_bytes, window_title, app_name)
            )

        if self.provider == "local":
            return (
                self._try_florence2(image_bytes, window_title, app_name)
                or self._try_local_ollama(image_bytes, window_title, app_name)
            )

        # auto: Florence-2 first (fastest local, no Ollama needed), then OVH, then Ollama
        return (
            self._try_florence2(image_bytes, window_title, app_name)
            or self._try_ovh(ovh_bytes, window_title, app_name)
            or self._try_local_ollama(image_bytes, window_title, app_name)
        )

    def _try_florence2(
        self, image_bytes: bytes, window_title: str, app_name: str
    ) -> Optional[str]:
        """Try Florence-2 in-process vision analysis."""
        if not VisionAnalyzer._florence2:
            return None
        result = VisionAnalyzer._florence2.analyze(image_bytes, window_title, app_name)
        if result:
            logger.info("Vision analysis (Florence-2) succeeded: %d chars", len(result))
        else:
            logger.debug("Florence-2 analysis returned no result")
        return result

    def _try_ovh(
        self, image_bytes: bytes, window_title: str, app_name: str
    ) -> Optional[str]:
        """Try OVH cloud vision analysis."""
        result = self._analyze_with_ovh(image_bytes, window_title, app_name)
        if result:
            logger.info("Vision analysis (OVH) succeeded: %d chars", len(result))
        else:
            logger.debug("OVH vision analysis failed")
        return result

    def _try_local_ollama(
        self, image_bytes: bytes, window_title: str, app_name: str
    ) -> Optional[str]:
        """Try local Ollama vision model."""
        if self._has_enough_vram():
            result = self._analyze_with_local_ollama(
                image_bytes, window_title, app_name
            )
            if result:
                logger.info(
                    "Vision analysis (local Ollama) succeeded: %d chars",
                    len(result),
                )
            else:
                logger.debug("Local Ollama vision analysis failed")
            return result
        else:
            logger.debug("Not enough free VRAM for local Ollama vision model")
        return None

    def _ensure_size_limit(self, image_bytes: bytes, max_bytes: int) -> bytes:
        """Ensure image bytes are under the size limit by recompressing."""
        if len(image_bytes) <= max_bytes:
            return image_bytes
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(image_bytes))
            # Reduce quality progressively
            for quality in [60, 40, 20, 10]:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=quality)
                data = buf.getvalue()
                if len(data) <= max_bytes:
                    logger.debug("Recompressed image to %d bytes (quality=%d)", len(data), quality)
                    return data
            # If still too large, resize
            ratio = 0.5
            while True:
                new_w = int(img.width * ratio)
                new_h = int(img.height * ratio)
                if new_w < 100 or new_h < 100:
                    break
                small = img.resize((new_w, new_h), Image.LANCZOS)
                buf = io.BytesIO()
                small.save(buf, format="JPEG", quality=50)
                data = buf.getvalue()
                if len(data) <= max_bytes:
                    logger.debug("Resized image to %dx%d, %d bytes", new_w, new_h, len(data))
                    return data
                ratio *= 0.7
            return image_bytes  # give up, return original
        except Exception as exc:
            logger.debug("Image resize failed: %s", exc)
            return image_bytes

    def _analyze_with_ovh(self, image_bytes: bytes, window_title: str, app_name: str) -> Optional[str]:
        """Send screenshot to OVHcloud vision endpoint for analysis."""
        try:
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            data_url = f"data:image/jpeg;base64,{b64}"

            prompt = _SCREEN_ANALYSIS_PROMPT
            if window_title or app_name:
                prompt += f"\n\nKontext: Aktives Fenster ist '{window_title}' (App: {app_name})."

            payload = {
                "model": _OVH_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }
                ],
                "max_tokens": 512,
                "temperature": 0.3,
            }

            with httpx.Client(timeout=_OVH_TIMEOUT) as client:
                headers = {"Content-Type": "application/json"}
                if self.ovh_token:
                    headers["Authorization"] = f"Bearer {self.ovh_token}"
                resp = client.post(
                    f"{_OVH_BASE_URL}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if content and content.strip():
                    return content.strip()
        except httpx.HTTPStatusError as exc:
            logger.warning("OVH vision HTTP error: %s (status=%s)", exc, exc.response.status_code)
        except httpx.ConnectError:
            logger.debug("OVH vision: connection failed (offline?)")
        except Exception as exc:
            logger.debug("OVH vision error: %s", exc)
        return None

    def _has_enough_vram(self) -> bool:
        """Check if there's enough free VRAM for a local vision model."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                free_mb = int(result.stdout.strip().split("\n")[0].strip())
                logger.debug("Free VRAM: %dMB (threshold: %dMB)", free_mb, self.vram_threshold)
                return free_mb >= self.vram_threshold
        except Exception:
            pass
        # If nvidia-smi not available, assume no GPU → don't use local vision
        return False

    def _analyze_with_local_ollama(self, image_bytes: bytes, window_title: str, app_name: str) -> Optional[str]:
        """Send screenshot to local Ollama vision model for analysis."""
        try:
            b64 = base64.b64encode(image_bytes).decode("utf-8")

            prompt = _SCREEN_ANALYSIS_PROMPT
            if window_title or app_name:
                prompt += f"\n\nKontext: Aktives Fenster ist '{window_title}' (App: {app_name})."

            payload = {
                "model": self.local_model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [b64],
                    }
                ],
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 512,
                },
                # Unload model after 5 minutes to free VRAM
                "keep_alive": "5m",
            }

            with httpx.Client(timeout=_OLLAMA_TIMEOUT) as client:
                resp = client.post(
                    f"{self.ollama_host}/api/chat",
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data.get("message", {}).get("content", "")
                if content and content.strip():
                    self._local_model_loaded = time.time()
                    return content.strip()
        except httpx.ConnectError:
            logger.debug("Local Ollama not reachable for vision analysis")
        except httpx.HTTPStatusError as exc:
            logger.warning("Local Ollama vision HTTP error: %s", exc)
        except Exception as exc:
            logger.debug("Local vision error: %s", exc)
        return None
