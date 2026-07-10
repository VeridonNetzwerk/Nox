"""Nox Backend – FastAPI Orchestrator

Entry point for the Nox backend server.
Provides health checks, Ollama status, WebSocket chat streaming,
and voice pipeline integration (wake word, STT, TTS).
"""

import asyncio
import json
import logging
import logging.handlers
import os
import re
from pathlib import Path
from typing import Any, Optional

import httpx
import uvicorn
import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from settings_manager import SettingsManager
from autostart import AutostartManager

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

LOG_DIR = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("nox.backend")
logger.setLevel(logging.DEBUG)

# Size-based rotation: 5MB, 3 backups
_file_handler = logging.handlers.RotatingFileHandler(
    LOG_DIR / "backend.log",
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)
logger.addHandler(_file_handler)

# Age-based rotation: daily, keep 7 days
_timed_handler = logging.handlers.TimedRotatingFileHandler(
    LOG_DIR / "nox.log",
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8",
)
_timed_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)
_timed_handler.setLevel(logging.INFO)
logger.addHandler(_timed_handler)

_console_handler = logging.StreamHandler()
_console_handler.setFormatter(
    logging.Formatter("[%(levelname)s] %(name)s: %(message)s")
)
logger.addHandler(_console_handler)

# ---------------------------------------------------------------------------
# Config loading – persistent in %APPDATA%\Nox\config.yaml
# ---------------------------------------------------------------------------

settings_mgr = SettingsManager()
config = settings_mgr.load()

# Merge config.local.yaml from backend dir (dev overrides)
LOCAL_CONFIG_PATH = Path(__file__).parent / "config.local.yaml"
if LOCAL_CONFIG_PATH.exists():
    with open(LOCAL_CONFIG_PATH, "r", encoding="utf-8") as f:
        local = yaml.safe_load(f)
    if local:
        config.update(local)
        logger.info("Merged config.local.yaml overrides")

# ---------------------------------------------------------------------------
# Connection manager – broadcasts events to all connected WebSocket clients
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages WebSocket connections and broadcasts messages."""

    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)
        logger.info("WebSocket client connected (%d total)", len(self._connections))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)
        logger.info("WebSocket client disconnected (%d total)", len(self._connections))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send a message to all connected clients."""
        dead = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Voice pipeline
# ---------------------------------------------------------------------------

from nox_voice import VoiceManager

voice_manager = VoiceManager(config)


async def on_voice_state_change(state: str) -> None:
    """Broadcast voice state changes to all UI clients."""
    await manager.broadcast({"type": "voice_event", "state": state})


async def on_voice_wake() -> None:
    """Handle wake word detection – notify UI to show window."""
    await manager.broadcast({"type": "voice_event", "state": "wake_detected"})


# ---------------------------------------------------------------------------
# Context capture (nox_eye)
# ---------------------------------------------------------------------------

from nox_eye import EyeManager

eye_manager = EyeManager(config)

# ---------------------------------------------------------------------------
# File search (nox_files)
# ---------------------------------------------------------------------------

from nox_files import FilesManager

files_manager = FilesManager(config)

# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

from orchestrator import Orchestrator

orchestrator = Orchestrator(
    config=config,
    eye_manager=eye_manager,
    voice_manager=voice_manager,
    files_manager=files_manager,
    broadcast=manager.broadcast,
)


async def on_voice_transcript(transcript: str) -> None:
    """Handle a voice transcript – send as chat message through the orchestrator."""
    await manager.broadcast({
        "type": "user_message",
        "content": transcript,
        "voice_input": True,
    })
    await orchestrator.process_message(transcript, voice_input=True)


voice_manager.set_callbacks(
    on_state_change=on_voice_state_change,
    on_transcript=on_voice_transcript,
    on_wake=on_voice_wake,
)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Nox Backend", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    """Start voice pipeline on server startup."""
    voice_manager.set_event_loop(asyncio.get_event_loop())
    voice_manager.start()
    eye_manager.start()
    files_manager.start()
    orchestrator.set_broadcast(manager.broadcast)

    # Auto-select best Ollama model if configured model is missing
    configured_model = config.get("ollama_model", "llama3.1")
    try:
        available = await orchestrator.get_available_models()
        if available and configured_model not in available:
            vram_mb = _get_gpu_vram()
            new_model = _select_model_by_vram(available, vram_mb)
            if new_model:
                logger.warning(
                    "Configured model '%s' not found in Ollama. Available: %s. VRAM: %dMB. Auto-selecting '%s'.",
                    configured_model, available, vram_mb, new_model,
                )
                config["ollama_model"] = new_model
                orchestrator.set_model(new_model)
                settings_mgr.save(config)
                logger.info("Switched active model to '%s'", new_model)
    except Exception as exc:
        logger.warning("Could not verify Ollama models at startup: %s", exc)

    logger.info("Backend startup complete")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Clean up voice pipeline on shutdown."""
    voice_manager.stop()
    eye_manager.stop()
    files_manager.stop()
    orchestrator.close()
    logger.info("Backend shutdown complete")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness check – always returns 200 if the process is alive."""
    return {"status": "ok", "service": "nox-backend", "version": "0.5.0"}


@app.get("/health/ollama")
async def health_ollama() -> dict[str, Any]:
    """Check Ollama reachability and report loaded model.

    Returns a structured response with a clear error message
    if Ollama is not running, instead of raising an exception.
    """
    ollama_host = config.get("ollama_host", "http://localhost:11434")
    ollama_model = config.get("ollama_model", "llama3.1")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{ollama_host}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            return {
                "status": "ok",
                "ollama_host": ollama_host,
                "configured_model": ollama_model,
                "available_models": models,
                "model_available": ollama_model in models,
            }
    except httpx.ConnectError:
        logger.warning("Ollama not reachable at %s", ollama_host)
        return {
            "status": "error",
            "ollama_host": ollama_host,
            "configured_model": ollama_model,
            "error": f"Ollama is not running or not reachable at {ollama_host}. Please start Ollama with 'ollama serve'.",
        }
    except httpx.TimeoutException:
        logger.warning("Ollama request timed out at %s", ollama_host)
        return {
            "status": "error",
            "ollama_host": ollama_host,
            "configured_model": ollama_model,
            "error": f"Ollama at {ollama_host} did not respond within 5 seconds.",
        }
    except Exception as exc:
        logger.error("Unexpected error checking Ollama: %s", exc, exc_info=True)
        return {
            "status": "error",
            "ollama_host": ollama_host,
            "configured_model": ollama_model,
            "error": f"Unexpected error: {exc}",
        }


@app.get("/health/voice")
async def health_voice() -> dict[str, Any]:
    """Check voice pipeline component status."""
    return voice_manager.health()


@app.get("/health/eye")
async def health_eye() -> dict[str, Any]:
    """Check context capture (nox_eye) component status."""
    return eye_manager.health()


@app.post("/eye/pause")
async def eye_pause() -> dict[str, Any]:
    """Pause context capture immediately."""
    eye_manager.pause()
    await manager.broadcast({"type": "eye_event", "state": "paused"})
    return {"status": "ok", "paused": True}


@app.post("/eye/resume")
async def eye_resume() -> dict[str, Any]:
    """Resume context capture."""
    eye_manager.resume()
    await manager.broadcast({"type": "eye_event", "state": "active"})
    return {"status": "ok", "paused": False}


# ---------------------------------------------------------------------------
# Files API (nox_files)
# ---------------------------------------------------------------------------


@app.get("/health/files")
async def health_files() -> dict[str, Any]:
    """Check file search component status."""
    return files_manager.health()


@app.post("/files/pause")
async def files_pause() -> dict[str, Any]:
    """Pause file indexing immediately."""
    files_manager.pause()
    await manager.broadcast({"type": "files_event", "state": "paused"})
    return {"status": "ok", "paused": True}


@app.post("/files/resume")
async def files_resume() -> dict[str, Any]:
    """Resume file indexing."""
    files_manager.resume()
    await manager.broadcast({"type": "files_event", "state": "active"})
    return {"status": "ok", "paused": False}


@app.post("/files/reindex")
async def files_reindex() -> dict[str, Any]:
    """Trigger an immediate re-index."""
    if files_manager.is_indexing:
        return {"status": "already_running"}
    files_manager.trigger_reindex()
    return {"status": "started"}


@app.get("/api/models")
async def get_models() -> dict[str, Any]:
    """List available Ollama models for the settings panel dropdown."""
    models = await orchestrator.get_available_models()
    return {
        "status": "ok",
        "current_model": config.get("ollama_model", "llama3.1"),
        "available_models": models,
    }


@app.post("/api/model")
async def set_model(body: dict[str, Any]) -> dict[str, Any]:
    """Change the active Ollama model at runtime."""
    model = body.get("model", "")
    if not model:
        return {"status": "error", "error": "No model specified"}
    orchestrator.set_model(model)
    config["ollama_model"] = model
    return {"status": "ok", "model": model}


@app.post("/api/conversation/new")
async def new_conversation() -> dict[str, Any]:
    """Start a new conversation session."""
    conv_id = orchestrator.new_conversation()
    return {"status": "ok", "conversation_id": conv_id}


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------

autostart_mgr = AutostartManager()


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    """Return all current settings for the settings panel."""
    return {
        "status": "ok",
        "settings": config,
        "config_path": settings_mgr.path,
    }


@app.post("/api/settings")
async def update_settings(body: dict[str, Any]) -> dict[str, Any]:
    """Update settings and persist to config.yaml.

    Accepts partial updates – only provided keys are modified.
    Some settings apply immediately (model, wake word threshold),
    others require restart (host, port).
    """
    updates = body.get("settings", body)

    # Persist to disk
    updated = settings_mgr.save(updates)
    config.update(updates)

    # Apply immediately where possible
    if "ollama_model" in updates:
        orchestrator.set_model(updates["ollama_model"])
    if "wake_word_threshold" in updates:
        voice_manager.wake_word.threshold = updates["wake_word_threshold"]
    if "wake_word_enabled" in updates:
        if updates["wake_word_enabled"]:
            voice_manager.start()
        else:
            voice_manager.stop()
    if "nox_eye_ttl_days" in updates:
        eye_manager.context_store.ttl_days = updates["nox_eye_ttl_days"]
    if "nox_eye_excluded_apps" in updates:
        eye_manager.window_monitor.excluded_apps = {
            a.lower() for a in updates["nox_eye_excluded_apps"]
        }
    if "tts_model" in updates:
        voice_manager.tts.model_name = updates["tts_model"]
        voice_manager.tts._voice = None  # force reload on next use

    # Audio device hot-reload
    if "audio_input_device" in updates or "audio_output_device" in updates:
        input_dev = updates.get("audio_input_device", config.get("audio_input_device", "default"))
        output_dev = updates.get("audio_output_device", config.get("audio_output_device", "default"))
        voice_manager.update_audio_devices(input_dev, output_dev)

    # VAD / end-of-turn settings hot-reload
    if "vad_silence_duration" in updates:
        voice_manager.recorder.silence_duration = updates["vad_silence_duration"]
    if "end_turn_silence_threshold" in updates:
        voice_manager.recorder.end_turn_silence_threshold = updates["end_turn_silence_threshold"]
    if "end_turn_max_silence" in updates:
        voice_manager.recorder.end_turn_max_silence = updates["end_turn_max_silence"]
    if "end_turn_fillword_extension" in updates:
        voice_manager.recorder.end_turn_fillword_extension = updates["end_turn_fillword_extension"]
    if "end_turn_incomplete_sentence_extension" in updates:
        voice_manager.recorder.end_turn_incomplete_sentence_extension = updates["end_turn_incomplete_sentence_extension"]
    if "end_turn_enabled" in updates:
        voice_manager.recorder.end_turn_enabled = updates["end_turn_enabled"]

    # Nox Files settings hot-reload
    files_keys = {"nox_files_enabled", "nox_files_full_drive", "nox_files_custom_folders",
                  "nox_files_excluded_dirs", "nox_files_ocr_gpu"}
    if files_keys & updates.keys():
        files_manager.update_settings(updates)

    await manager.broadcast({"type": "settings_changed", "settings": updates})

    return {"status": "ok", "settings": updated}


@app.get("/api/autostart")
async def get_autostart() -> dict[str, Any]:
    """Check autostart status."""
    return autostart_mgr.status()


@app.post("/api/autostart")
async def set_autostart(body: dict[str, Any]) -> dict[str, Any]:
    """Enable or disable autostart."""
    enable = body.get("enabled", False)
    if enable:
        success = autostart_mgr.enable()
    else:
        success = autostart_mgr.disable()
    return {"status": "ok" if success else "error", "enabled": autostart_mgr.is_enabled()}


# ---------------------------------------------------------------------------
# Audio device API
# ---------------------------------------------------------------------------


@app.get("/api/audio/devices")
async def get_audio_devices() -> dict[str, Any]:
    """List all available audio input and output devices."""
    from nox_voice.audio_devices import list_devices
    devices = list_devices()
    return {
        "status": "ok",
        "input": devices["input"],
        "output": devices["output"],
        "current": {
            "input": config.get("audio_input_device", "default"),
            "output": config.get("audio_output_device", "default"),
        },
    }


@app.post("/api/audio/test-input")
async def test_input_device(body: dict[str, Any]) -> dict[str, Any]:
    """Record a brief 1-second sample from the specified input device and return RMS level."""
    device = body.get("device", "default")
    try:
        import numpy as np
        import sounddevice as sd
        from nox_voice.audio_devices import resolve_input_device
        dev_idx = resolve_input_device(device)
        duration = 1.0
        sr = 16000
        recording = sd.rec(int(duration * sr), samplerate=sr, channels=1, dtype="float32", device=dev_idx)
        sd.wait()
        rms = float(np.sqrt(np.mean(recording ** 2)))
        peak = float(np.max(np.abs(recording)))
        return {"status": "ok", "rms": rms, "peak": peak, "device": device}
    except Exception as exc:
        logger.error("Input device test failed: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.post("/api/audio/test-output")
async def test_output_device(body: dict[str, Any]) -> dict[str, Any]:
    """Play a brief test tone on the specified output device."""
    device = body.get("device", "default")
    try:
        import numpy as np
        import sounddevice as sd
        from nox_voice.audio_devices import resolve_output_device
        dev_idx = resolve_output_device(device)
        sr = 22050
        duration = 0.5
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        tone = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        sd.play(tone, sr, device=dev_idx)
        sd.wait()
        return {"status": "ok", "device": device}
    except Exception as exc:
        logger.error("Output device test failed: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.post("/api/tts/speak")
async def tts_speak(body: dict[str, Any]) -> dict[str, Any]:
    """Speak the given text via Piper TTS.

    Returns immediately; audio plays in a background thread.
    """
    text = body.get("text", "").strip()
    if not text:
        return {"status": "error", "error": "No text provided"}

    if not voice_manager.tts.is_available:
        return {"status": "error", "error": "TTS not available (piper or sounddevice missing)"}

    voice_manager.speak_response(text)
    return {"status": "ok"}


@app.post("/api/tts/stop")
async def tts_stop() -> dict[str, Any]:
    """Stop any ongoing TTS playback."""
    voice_manager.tts.stop()
    return {"status": "ok"}


@app.get("/api/status")
async def system_status() -> dict[str, Any]:
    """Comprehensive system status for UI error states.

    Returns the health of all components in a single call so the UI
    can show appropriate error messages and disable unavailable features.
    """
    # Ollama
    ollama_status = "unknown"
    ollama_error = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{config.get('ollama_host', 'http://localhost:11434')}/api/tags")
            resp.raise_for_status()
            ollama_status = "ok"
    except Exception as exc:
        ollama_status = "error"
        ollama_error = str(exc)

    # Microphone
    mic_available = False
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        mic_available = any(d.get("max_input_channels", 0) > 0 for d in devices)
    except Exception:
        mic_available = False

    # Wake word model — check file path or built-in model name
    wake_model_name = config.get("wake_word_model", "hey_nox.onnx")
    env_models = os.environ.get("NOX_MODELS_DIR")
    if env_models:
        wake_model_path = Path(env_models) / wake_model_name
    else:
        wake_model_path = Path(__file__).parent.parent / "models" / wake_model_name
    # Built-in models (single name like "hey_jarvis") are always available
    is_builtin_model = os.path.basename(wake_model_name) == wake_model_name and "." not in wake_model_name
    wake_model_exists = wake_model_path.exists() or is_builtin_model

    # Voice pipeline
    voice_health = voice_manager.health()

    # Eye
    eye_health = eye_manager.health()

    return {
        "status": "ok",
        "ollama": {
            "status": ollama_status,
            "host": config.get("ollama_host", "http://localhost:11434"),
            "error": ollama_error,
        },
        "microphone": {
            "available": mic_available,
        },
        "wake_word": {
            "model_exists": wake_model_exists,
            "model_path": str(wake_model_path),
            "available": voice_health.get("wake_word", {}).get("available", False),
            "running": voice_health.get("wake_word", {}).get("running", False),
        },
        "voice": voice_health,
        "eye": eye_health,
        "autostart": autostart_mgr.status(),
    }


# ---------------------------------------------------------------------------
# Onboarding endpoints – install Ollama, download models, check GPU
# ---------------------------------------------------------------------------

import subprocess
import tempfile

OLLAMA_INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
ONBOARDING_STATE: dict[str, Any] = {}


def _get_gpu_vram() -> int:
    """Query GPU VRAM in MB via nvidia-smi. Returns 0 if unavailable."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip().splitlines()[0].strip())
    except Exception:
        pass
    return 0


def _select_model_by_vram(available_models: list[str], vram_mb: int) -> str | None:
    """Select the best Gemma model based on GPU VRAM.

    Preference order (Gemma first, then fallback):
      <8GB  VRAM -> 4b model
      <12GB VRAM -> 4b model (safe)
      <16GB VRAM -> 8b model
      <20GB VRAM -> 12b model
      >=20GB VRAM -> 16b model (or largest available)
    """
    if vram_mb <= 0:
        # No GPU info — pick smallest Gemma
        target_sizes = ["4b", "8b", "12b", "16b", "2b", "1b"]
    elif vram_mb < 8000:
        target_sizes = ["4b", "2b", "1b"]
    elif vram_mb < 12000:
        target_sizes = ["4b", "8b", "2b", "1b"]
    elif vram_mb < 16000:
        target_sizes = ["8b", "4b", "12b", "2b"]
    elif vram_mb < 20000:
        target_sizes = ["12b", "8b", "4b", "16b"]
    else:
        target_sizes = ["16b", "12b", "8b", "4b"]

    # Try Gemma variants first, then any model with the target size
    for size in target_sizes:
        # Prefer gemma3
        for m in available_models:
            if "gemma" in m.lower() and size in m.lower():
                return m
        # Then any gemma variant
        for m in available_models:
            if "gemma" in m.lower() and size in m.lower():
                return m

    # Fallback: any model with the target size
    for size in target_sizes:
        for m in available_models:
            if size in m.lower():
                return m

    # Last resort: first available model
    if available_models:
        return available_models[0]
    return None


@app.get("/api/onboarding/gpu-check")
async def gpu_check() -> dict[str, Any]:
    """Check if CUDA is actually available (not just if an NVIDIA card exists)."""
    cuda_available = False
    gpu_name = ""
    torch_version = ""
    vram_mb = 0

    try:
        import torch
        cuda_available = torch.cuda.is_available()
        torch_version = torch.__version__
        if cuda_available:
            gpu_name = torch.cuda.get_device_name(0)
    except ImportError:
        pass
    except Exception as exc:
        logger.debug("GPU check error: %s", exc)

    # Also check via nvidia-smi as fallback (includes VRAM)
    nvidia_smi = False
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            nvidia_smi = True
            parts = result.stdout.strip().splitlines()[0].split(",")
            if not gpu_name:
                gpu_name = parts[0].strip()
            if len(parts) > 1:
                vram_str = parts[1].strip().replace(" MiB", "").replace(" MiB", "")
                try:
                    vram_mb = int(vram_str)
                except ValueError:
                    pass
    except Exception:
        pass

    # If torch CUDA gave us a name but no VRAM, try nvidia-smi for VRAM only
    if cuda_available and vram_mb == 0:
        vram_mb = _get_gpu_vram()

    return {
        "status": "ok",
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "vram_mb": vram_mb,
        "torch_version": torch_version,
        "nvidia_driver_present": nvidia_smi,
        "mode": "gpu" if cuda_available else ("cpu_fallback" if nvidia_smi else "cpu"),
    }


@app.post("/api/onboarding/install-ollama")
async def install_ollama() -> dict[str, Any]:
    """Download and silently install Ollama.

    Returns immediately with a status. The frontend polls /health/ollama
    to check when installation is complete.
    """
    if ONBOARDING_STATE.get("ollama_installing"):
        return {"status": "already_running"}

    async def _do_install():
        ONBOARDING_STATE["ollama_installing"] = True
        ONBOARDING_STATE["ollama_install_error"] = None
        try:
            import httpx as _httpx
            tmp_dir = Path(tempfile.gettempdir())
            installer_path = tmp_dir / "OllamaSetup.exe"

            # Download
            logger.info("Downloading Ollama installer from %s", OLLAMA_INSTALLER_URL)
            async with _httpx.AsyncClient(follow_redirects=True, timeout=300.0) as client:
                async with client.stream("GET", OLLAMA_INSTALLER_URL) as resp:
                    resp.raise_for_status()
                    total = int(resp.headers.get("content-length", 0))
                    downloaded = 0
                    with open(installer_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(65536):
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total > 0:
                                ONBOARDING_STATE["ollama_install_progress"] = downloaded / total
                    ONBOARDING_STATE["ollama_install_progress"] = 1.0

            # Run installer with silent flags
            logger.info("Running Ollama installer: %s", installer_path)
            ONBOARDING_STATE["ollama_install_phase"] = "installing"
            process = await asyncio.create_subprocess_exec(
                str(installer_path),
                "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                await asyncio.wait_for(process.wait(), timeout=60.0)
            except asyncio.TimeoutError:
                logger.warning("Ollama installer timed out after 60s")
                ONBOARDING_STATE["ollama_install_error"] = "timeout"
                try:
                    process.kill()
                except Exception:
                    pass

            # Cleanup
            try:
                installer_path.unlink(missing_ok=True)
            except Exception:
                pass

            ONBOARDING_STATE["ollama_install_phase"] = "done"
            logger.info("Ollama installation complete")

        except Exception as exc:
            logger.error("Ollama install failed: %s", exc, exc_info=True)
            ONBOARDING_STATE["ollama_install_error"] = str(exc)
        finally:
            ONBOARDING_STATE["ollama_installing"] = False

    asyncio.create_task(_do_install())
    return {"status": "started"}


@app.get("/api/onboarding/install-status")
async def install_status() -> dict[str, Any]:
    """Poll installation progress."""
    return {
        "status": "ok",
        "installing": ONBOARDING_STATE.get("ollama_installing", False),
        "phase": ONBOARDING_STATE.get("ollama_install_phase", "idle"),
        "progress": ONBOARDING_STATE.get("ollama_install_progress", 0),
        "error": ONBOARDING_STATE.get("ollama_install_error"),
    }


@app.post("/api/onboarding/pull-ollama-model")
async def pull_ollama_model(body: dict[str, Any]) -> dict[str, Any]:
    """Pull an Ollama model and stream progress via the onboarding state.

    The frontend polls /api/onboarding/pull-status to track progress.
    """
    model = body.get("model", "llama3.1")
    if ONBOARDING_STATE.get("pull_running"):
        return {"status": "already_running"}

    async def _do_pull():
        ONBOARDING_STATE["pull_running"] = True
        ONBOARDING_STATE["pull_model"] = model
        ONBOARDING_STATE["pull_progress"] = 0
        ONBOARDING_STATE["pull_error"] = None
        try:
            ollama_host = config.get("ollama_host", "http://localhost:11434")
            async with httpx.AsyncClient(timeout=600.0) as client:
                async with client.stream(
                    "POST",
                    f"{ollama_host}/api/pull",
                    json={"name": model, "stream": True},
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        if data.get("total"):
                            ONBOARDING_STATE["pull_progress"] = data.get("completed", 0) / data["total"]
                        if data.get("status") == "success":
                            ONBOARDING_STATE["pull_progress"] = 1.0
                            break
            logger.info("Ollama model pull complete: %s", model)
        except Exception as exc:
            logger.error("Ollama pull failed: %s", exc, exc_info=True)
            ONBOARDING_STATE["pull_error"] = str(exc)
        finally:
            ONBOARDING_STATE["pull_running"] = False

    asyncio.create_task(_do_pull())
    return {"status": "started", "model": model}


@app.get("/api/onboarding/pull-status")
async def pull_status() -> dict[str, Any]:
    """Poll model pull progress."""
    return {
        "status": "ok",
        "running": ONBOARDING_STATE.get("pull_running", False),
        "model": ONBOARDING_STATE.get("pull_model", ""),
        "progress": ONBOARDING_STATE.get("pull_progress", 0),
        "error": ONBOARDING_STATE.get("pull_error"),
    }


@app.post("/api/onboarding/download-model")
async def download_model(body: dict[str, Any]) -> dict[str, Any]:
    """Download a model file (Whisper or Piper) with progress tracking.

    Expects: {"type": "whisper"|"piper"|"wakeword", "url": "...", "filename": "..."}
    """
    dl_type = body.get("type", "")
    url = body.get("url", "")
    filename = body.get("filename", "")
    if not url or not filename:
        return {"status": "error", "error": "Missing url or filename"}

    if ONBOARDING_STATE.get("download_running"):
        return {"status": "already_running"}

    # Use NOX_MODELS_DIR if set (production), otherwise project models dir
    env_models = os.environ.get("NOX_MODELS_DIR")
    if env_models:
        models_dir = Path(env_models)
    else:
        models_dir = Path(__file__).parent.parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    dest = models_dir / filename

    async def _do_download():
        ONBOARDING_STATE["download_running"] = True
        ONBOARDING_STATE["download_type"] = dl_type
        ONBOARDING_STATE["download_progress"] = 0
        ONBOARDING_STATE["download_error"] = None
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=600.0) as client:
                async with client.stream("GET", url) as resp:
                    resp.raise_for_status()
                    total = int(resp.headers.get("content-length", 0))
                    downloaded = 0
                    with open(dest, "wb") as f:
                        async for chunk in resp.aiter_bytes(65536):
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total > 0:
                                ONBOARDING_STATE["download_progress"] = downloaded / total
                    ONBOARDING_STATE["download_progress"] = 1.0
            logger.info("Download complete: %s -> %s", dl_type, dest)
        except Exception as exc:
            logger.error("Download failed: %s", exc, exc_info=True)
            ONBOARDING_STATE["download_error"] = str(exc)
        finally:
            ONBOARDING_STATE["download_running"] = False

    asyncio.create_task(_do_download())
    return {"status": "started", "type": dl_type, "filename": filename}


@app.get("/api/onboarding/download-status")
async def download_status() -> dict[str, Any]:
    """Poll model download progress."""
    return {
        "status": "ok",
        "running": ONBOARDING_STATE.get("download_running", False),
        "type": ONBOARDING_STATE.get("download_type", ""),
        "progress": ONBOARDING_STATE.get("download_progress", 0),
        "error": ONBOARDING_STATE.get("download_error"),
    }


@app.post("/api/onboarding/test-wake-word")
async def test_wake_word_start(body: dict[str, Any] = None) -> dict[str, Any]:
    """Start wake word listener for onboarding calibration test.

    Uses the current audio_input_device from settings or request body.
    Broadcasts 'wake_detected' via WebSocket when the wake word is detected.
    """
    if not voice_manager.wake_word.is_available:
        return {"status": "error", "error": "Wake word dependencies not available"}

    # Stop existing listener if running
    voice_manager.wake_word.stop()

    # Update input device if provided
    if body and "input_device" in body:
        voice_manager.wake_word.input_device = body["input_device"]

    # Set callback to broadcast wake detection via WebSocket
    async def _on_wake_test():
        await manager.broadcast({"type": "voice_event", "state": "wake_detected"})

    original_callback = voice_manager.wake_word.on_wake

    def _wake_sync():
        if voice_manager._loop:
            asyncio.run_coroutine_threadsafe(_on_wake_test(), voice_manager._loop)

    voice_manager.wake_word.on_wake = _wake_sync
    voice_manager.wake_word.start()

    if not voice_manager.wake_word.model_loaded:
        voice_manager.wake_word.on_wake = original_callback
        return {"status": "error", "error": "Failed to load wake word model"}

    return {"status": "ok", "model": config.get("wake_word_model", "hey_jarvis")}


@app.post("/api/onboarding/stop-wake-word-test")
async def test_wake_word_stop() -> dict[str, Any]:
    """Stop wake word listener after onboarding calibration test."""
    voice_manager.wake_word.stop()
    # Restore original callback
    voice_manager.wake_word.on_wake = voice_manager._on_wake_detected
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# WebSocket chat
# ---------------------------------------------------------------------------


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket) -> None:
    """WebSocket endpoint for streaming chat and voice events.

    Request schema (JSON from client):
        {
            "message": str,              # User message (text input)
            "context": Optional[str],    # Optional context string
            "voice_input": Optional[bool] # True if from voice pipeline
        }

    Response schema (JSON sent to client, multiple messages):
        {"type": "token", "content": str}          # Streamed LLM token
        {"type": "done", "content": str}           # Full response when complete
        {"type": "error", "content": str}          # Error message
        {"type": "voice_event", "state": str}      # Voice state: wake_detected|listening|transcribing|thinking|speaking|idle
        {"type": "user_message", "content": str, "voice_input": bool}  # Voice transcript shown as user message
    """
    await manager.connect(websocket)

    try:
        while True:
            data = await websocket.receive_json()

            # Manual voice trigger from UI mic button
            if data.get("type") == "voice_trigger":
                logger.info("Manual voice trigger received")
                # Run the wake callback path (record + transcribe)
                voice_manager._on_wake_detected()
                continue

            message: str = data.get("message", "")
            context: Optional[str] = data.get("context")
            voice_input: bool = data.get("voice_input", False)

            if not message:
                await websocket.send_json({"type": "error", "content": "Empty message"})
                continue

            await orchestrator.process_message(message, voice_input=voice_input, context_override=context)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        logger.error("WebSocket error: %s", exc, exc_info=True)
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8420,
        reload=True,
    )
