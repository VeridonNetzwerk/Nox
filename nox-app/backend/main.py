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

# Size-based rotation: 10MB, 3 backups
# delay=True opens the file lazily on first write to avoid Windows file lock issues
_file_handler = logging.handlers.RotatingFileHandler(
    LOG_DIR / "nox_backend.log",
    maxBytes=10 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
    delay=True,
)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)
logger.addHandler(_file_handler)

# Age-based rotation: daily, keep 7 days
_timed_handler = logging.handlers.TimedRotatingFileHandler(
    LOG_DIR / "nox_timed.log",
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8",
    delay=True,
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

# Wire voice/orchestrator loggers to the same handlers
for _name in ("nox.voice", "nox.voice.manager", "nox.voice.wake_word", "nox.voice.stt", "nox.voice.tts", "nox.voice.vad", "nox.orchestrator", "nox.orchestrator.conversation", "nox.orchestrator.tools", "nox.orchestrator.system_prompt", "nox.eye", "nox.eye.manager", "nox.eye.window", "nox.eye.uia", "nox.eye.ocr", "nox.eye.store", "nox.eye.clipboard", "nox.files", "nox.files.manager", "nox.files.indexer", "nox.files.store", "nox.settings"):
    _l = logging.getLogger(_name)
    _l.setLevel(logging.DEBUG)
    _l.addHandler(_file_handler)
    _l.addHandler(_timed_handler)
    _l.addHandler(_console_handler)
    _l.propagate = False

# ---------------------------------------------------------------------------
# Config loading – persistent in %APPDATA%\Nox\config.yaml
# ---------------------------------------------------------------------------

# In dev mode, reset config to bundled defaults on every start
import sys as _sys
_is_dev_mode = (
    "--reload" in _sys.argv
    or any("--reload" in str(a) for a in _sys.argv)
    or not (Path(__file__).parent / ".prod").exists()  # source tree without .prod marker
)
if _is_dev_mode:
    import shutil as _shutil
    _bundled = Path(__file__).parent / "config.yaml"
    _user_config = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "config.yaml"
    if _bundled.exists():
        _user_config.parent.mkdir(parents=True, exist_ok=True)
        _shutil.copy2(_bundled, _user_config)
        logger.info("Dev mode: config reset to bundled defaults")
    # Also ensure onboarding_completed is false so onboarding shows every dev start
    if _user_config.exists():
        import yaml as _yaml_dev
        with open(_user_config, "r", encoding="utf-8") as _f:
            _dev_cfg = _yaml_dev.safe_load(_f) or {}
        _dev_cfg["onboarding_completed"] = False
        with open(_user_config, "w", encoding="utf-8") as _f:
            _yaml_dev.dump(_dev_cfg, _f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        logger.info("Dev mode: onboarding_completed reset to false")

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
    """Manages WebSocket connections for the single-user desktop app.

    Only keeps the most recent connection — old ones are closed on connect.
    """

    def __init__(self):
        self._connections: list[WebSocket] = []

    @property
    def latest(self) -> Optional[WebSocket]:
        """Return the most recent connection, or None."""
        return self._connections[-1] if self._connections else None

    async def connect(self, websocket: WebSocket) -> None:
        # Close any existing connections — single-user app, only one UI at a time
        for old_ws in self._connections:
            try:
                await old_ws.close()
            except Exception:
                pass
        self._connections.clear()
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

    async def send_to_latest(self, message: dict[str, Any]) -> None:
        """Send a message only to the most recent connection."""
        ws = self.latest
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
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
# Settings apply function – used by tool handler to hot-reload settings
# ---------------------------------------------------------------------------

def apply_settings_update(updates: dict[str, Any]) -> None:
    """Apply setting changes at runtime (called by einstellung_aendern tool)."""
    config.update(updates)
    if "ollama_model" in updates:
        orchestrator.set_model(updates["ollama_model"])
    if "wake_word_threshold" in updates:
        voice_manager.wake_word.threshold = updates["wake_word_threshold"]
    if "wake_word_enabled" in updates:
        voice_manager._enabled = updates["wake_word_enabled"]
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
    if "nox_eye_screenshot_interval" in updates:
        eye_manager.screenshot_history.update_interval(updates["nox_eye_screenshot_interval"])
    if "tts_model" in updates:
        voice_manager.tts.model_name = updates["tts_model"]
        voice_manager.tts._voice = None
    if "tts_engine" in updates:
        voice_manager.tts_engine = updates["tts_engine"]
        voice_manager.tts_voice_id = updates.get("tts_model", voice_manager.tts_voice_id)
    if "audio_input_device" in updates or "audio_output_device" in updates:
        input_dev = updates.get("audio_input_device", config.get("audio_input_device", "default"))
        output_dev = updates.get("audio_output_device", config.get("audio_output_device", "default"))
        voice_manager.update_audio_devices(input_dev, output_dev)
    if "vad_silence_duration" in updates:
        voice_manager.recorder.silence_duration = updates["vad_silence_duration"]
    if "end_turn_silence_threshold" in updates:
        voice_manager.recorder.end_turn_silence_threshold = updates["end_turn_silence_threshold"]
    if "end_turn_max_silence" in updates:
        voice_manager.recorder.end_turn_max_silence = updates["end_turn_max_silence"]
    if "end_turn_enabled" in updates:
        voice_manager.recorder.end_turn_enabled = updates["end_turn_enabled"]
    files_keys = {"nox_files_enabled", "nox_files_full_drive", "nox_files_custom_folders",
                  "nox_files_excluded_dirs", "nox_files_ocr_gpu"}
    if files_keys & updates.keys():
        files_manager.update_settings(updates)
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({"type": "settings_changed", "settings": updates}),
                loop,
            )
    except Exception:
        pass

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
    settings_manager=settings_mgr,
    apply_settings_fn=apply_settings_update,
)


async def on_voice_transcript(transcript: str) -> None:
    """Handle a voice transcript – send as chat message through the orchestrator."""
    await manager.send_to_latest({
        "type": "user_message",
        "content": transcript,
        "voice_input": True,
    })
    # Send tokens only to the latest connection, not broadcast to all
    async def _send_to_latest(msg):
        await manager.send_to_latest(msg)
    await orchestrator.process_message(transcript, voice_input=True, send=_send_to_latest)


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
    voice_manager.set_event_loop(asyncio.get_running_loop())
    voice_manager.start()
    eye_manager.start()
    files_manager.start()
    orchestrator.set_broadcast(manager.broadcast)

    # Auto-select best Ollama model if configured model is missing
    configured_model = config.get("ollama_model", "qwen3:14b")
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
        logger.warning("Could not verify Ollama models at startup: %s", exc, exc_info=True)

    # Preload model if enabled
    if config.get("ollama_preload", False):
        preload_mode = config.get("ollama_preload_mode", "vram")
        model = config.get("ollama_model", "qwen3:14b")
        ollama_host = config.get("ollama_host", "http://localhost:11434")
        logger.info("Preloading model '%s' (mode=%s)...", model, preload_mode)
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "model": model,
                    "prompt": "",
                    "keep_alive": -1,  # keep loaded indefinitely
                }
                if preload_mode == "ram":
                    payload["options"] = {"num_gpu": 0}
                resp = await client.post(f"{ollama_host}/api/generate", json=payload)
                if resp.status_code == 200:
                    logger.info("Model '%s' preloaded successfully (mode=%s)", model, preload_mode)
                else:
                    logger.warning("Model preload returned status %d: %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            logger.warning("Model preload failed: %s", exc, exc_info=True)

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
    ollama_model = config.get("ollama_model", "qwen3:14b")
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
        "current_model": config.get("ollama_model", "qwen3:14b"),
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
        voice_manager._enabled = updates["wake_word_enabled"]
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
    if "nox_eye_screenshot_interval" in updates:
        eye_manager.screenshot_history.update_interval(updates["nox_eye_screenshot_interval"])
    if "tts_model" in updates:
        voice_manager.tts.model_name = updates["tts_model"]
        voice_manager.tts._voice = None  # force reload on next use
    if "tts_engine" in updates:
        voice_manager.tts_engine = updates["tts_engine"]
        # tts_model holds the voice_id for edge/kokoro engines
        voice_manager.tts_voice_id = updates.get("tts_model", voice_manager.tts_voice_id)

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


@app.post("/api/log/ui-error")
async def log_ui_error(body: dict[str, Any]) -> dict[str, Any]:
    """Receive error reports from the UI and log them to nox_backend.log.

    This allows the backend to capture UI-side errors (React crashes,
    fetch failures, etc.) in the same log file for easier debugging
    and GitHub issue creation.
    """
    error = body.get("error", "Unknown UI error")
    stack = body.get("stack", "")
    component_stack = body.get("componentStack", "")
    url = body.get("url", "")
    timestamp = body.get("timestamp", "")

    logger.error(
        "[UI-ERROR] %s | url=%s | ts=%s\n  Stack: %s\n  ComponentStack: %s",
        error,
        url,
        timestamp,
        stack[:500],
        component_stack[:500],
    )

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
            "model_exists": wake_model_exists or voice_health.get("wake_word", {}).get("available", False),
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
            encoding="utf-8", errors="replace",
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip().splitlines()[0].strip())
    except Exception:
        pass
    return 0


def _select_model_by_vram(available_models: list[str], vram_mb: int) -> str | None:
    """Select the best Qwen3 model based on GPU VRAM.

    Preference order (Qwen3 first, then fallback):
      <8GB  VRAM -> 4b model
      <12GB VRAM -> 8b model
      <20GB VRAM -> 14b model
      >=20GB VRAM -> 14b or 32b model
    """
    if vram_mb <= 0:
        target_sizes = ["4b", "8b", "14b", "1.7b"]
    elif vram_mb < 8000:
        target_sizes = ["4b", "1.7b", "8b"]
    elif vram_mb < 12000:
        target_sizes = ["8b", "4b", "14b", "1.7b"]
    elif vram_mb < 20000:
        target_sizes = ["14b", "8b", "4b", "32b"]
    else:
        target_sizes = ["14b", "32b", "8b", "4b"]

    # Try Qwen3 variants first
    for size in target_sizes:
        for m in available_models:
            if "qwen3" in m.lower() and size in m.lower():
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
            encoding="utf-8", errors="replace",
        )
        if result.returncode == 0 and result.stdout.strip():
            nvidia_smi = True
            parts = result.stdout.strip().splitlines()[0].split(",")
            if not gpu_name:
                gpu_name = parts[0].strip()
            if len(parts) > 1:
                vram_str = parts[1].strip().replace(" MiB", "")
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
    model = body.get("model", "qwen3:14b")
    if ONBOARDING_STATE.get("pull_running"):
        return {"status": "already_running"}

    async def _do_pull():
        ONBOARDING_STATE["pull_running"] = True
        ONBOARDING_STATE["pull_model"] = model
        ONBOARDING_STATE["pull_progress"] = 0
        ONBOARDING_STATE["pull_completed"] = 0
        ONBOARDING_STATE["pull_total"] = 0
        ONBOARDING_STATE["pull_speed"] = 0
        ONBOARDING_STATE["pull_error"] = None
        ONBOARDING_STATE["pull_status_text"] = "starting"
        import time
        last_completed = 0
        last_time = time.monotonic()
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
                        if data.get("error"):
                            raise RuntimeError(data["error"])
                        status_text = data.get("status", "")
                        ONBOARDING_STATE["pull_status_text"] = status_text
                        if data.get("total"):
                            completed = data.get("completed", 0)
                            total = data["total"]
                            ONBOARDING_STATE["pull_progress"] = completed / total
                            ONBOARDING_STATE["pull_completed"] = completed
                            ONBOARDING_STATE["pull_total"] = total
                            now = time.monotonic()
                            elapsed = now - last_time
                            if elapsed >= 0.5:
                                speed = (completed - last_completed) / elapsed
                                ONBOARDING_STATE["pull_speed"] = speed
                                last_completed = completed
                                last_time = now
                        if status_text == "success":
                            ONBOARDING_STATE["pull_progress"] = 1.0
                            ONBOARDING_STATE["pull_speed"] = 0
                            ONBOARDING_STATE["pull_status_text"] = "done"
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
        "completed": ONBOARDING_STATE.get("pull_completed", 0),
        "total": ONBOARDING_STATE.get("pull_total", 0),
        "speed": ONBOARDING_STATE.get("pull_speed", 0),
        "error": ONBOARDING_STATE.get("pull_error"),
        "status_text": ONBOARDING_STATE.get("pull_status_text", ""),
    }


# ---------------------------------------------------------------------------
# Voice catalog endpoints – TTS engine selection (Kokoro, Edge)
# ---------------------------------------------------------------------------

from nox_voice.voice_catalog import (
    get_sample_sentence,
    detect_system_language,
    get_default_voice,
    get_default_male_voice,
    SAMPLE_SENTENCES,
)

from nox_voice.supported_languages import SUPPORTED_LANGUAGES, get_supported_languages

from nox_voice.tts_edge import (
    _EDGE_AVAILABLE,
    edge_tts_to_wav,
)
from nox_voice.tts_kokoro import (
    is_kokoro_available,
    get_kokoro_lang_code,
    get_kokoro_voices_for_lang,
    kokoro_to_wav,
    KOKORO_LANGUAGES,
)


@app.get("/api/voices/catalog")
async def voices_catalog() -> dict[str, Any]:
    """Return the full voice catalog (languages) for UI selection.
    Only languages supported by Kokoro or Edge TTS are listed."""
    return {"status": "ok", "catalog": get_supported_languages()}


@app.get("/api/voices/installed")
async def voices_installed() -> dict[str, Any]:
    """List installed voice models (Kokoro voices are built-in, no download needed)."""
    return {"status": "ok", "installed": []}


@app.get("/api/voices/system-language")
async def voices_system_language() -> dict[str, Any]:
    """Detect the system language for voice selection.

    Checks config system_language first, then falls back to OS detection.
    """
    try:
        config_lang = config.get("system_language", "")
        if config_lang:
            if config_lang in SUPPORTED_LANGUAGES:
                lang = config_lang
            else:
                lang = detect_system_language()
        else:
            lang = detect_system_language()
        info = SUPPORTED_LANGUAGES.get(lang, ("German", "Deutsch"))
        default = get_default_voice(lang)
        return {
            "status": "ok",
            "language_code": lang,
            "language_name": info[0],
            "language_native": info[1],
            "default_voice": default[0] if default else None,
            "default_engine": default[1] if default else None,
        }
    except Exception as exc:
        logger.error("voices_system_language error: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.get("/api/voices/default/{lang_code}")
async def voices_default_for_lang(lang_code: str) -> dict[str, Any]:
    """Get the default voice and engine for a specific language."""
    default = get_default_voice(lang_code)
    if default is None:
        return {"status": "error", "error": f"No default voice for {lang_code}"}
    return {
        "status": "ok",
        "language_code": lang_code,
        "default_voice": default[0],
        "default_engine": default[1],
    }


@app.get("/api/voices/engines")
async def voices_engines() -> dict[str, Any]:
    """List all available TTS engines and their status."""
    return {
        "status": "ok",
        "engines": {
            "kokoro": {
                "available": is_kokoro_available(),
                "name": "Kokoro-82M",
                "description": "Lokal, hohe Qualität, sehr schnell, Apache 2.0",
                "offline": True,
            },
            "edge": {
                "available": _EDGE_AVAILABLE,
                "name": "Edge TTS (Microsoft)",
                "description": "Cloud, exzellente Qualität, neuronale Stimmen",
                "offline": False,
            },
        },
    }


@app.get("/api/voices/edge/catalog")
async def voices_edge_catalog() -> dict[str, Any]:
    """Return Edge TTS voice catalog organized by language."""
    from nox_voice.tts_edge import EDGE_VOICES_BY_LANG

    result = {}
    for lang_code, voices in EDGE_VOICES_BY_LANG.items():
        result[lang_code] = {
            "voices": [
                {
                    "id": v[0],
                    "name": v[1],
                    "gender": v[2],
                    "description": v[3],
                }
                for v in voices
            ],
            "sample_sentence": SAMPLE_SENTENCES.get(lang_code, "Hello."),
        }
    return {"status": "ok", "catalog": result}


@app.get("/api/voices/kokoro/catalog")
async def voices_kokoro_catalog() -> dict[str, Any]:
    """Return Kokoro-82M voice catalog organized by language."""
    result = {}
    for lang_code, voices in KOKORO_LANGUAGES.items():
        voice_list = get_kokoro_voices_for_lang(lang_code)
        result[lang_code] = {
            "voices": [
                {
                    "id": v[0],
                    "name": v[1],
                    "gender": v[2],
                    "description": v[3],
                }
                for v in voice_list
            ],
            "sample_sentence": SAMPLE_SENTENCES.get(lang_code, "Hello."),
        }
    return {"status": "ok", "catalog": result}


@app.get("/api/voices/demo/edge/{lang_code}/{voice_id}")
async def voices_demo_edge(lang_code: str, voice_id: str, text: str = ""):
    """Generate a TTS demo using Edge TTS. Returns WAV audio."""
    from fastapi.responses import Response

    if not _EDGE_AVAILABLE:
        logger.error("Edge TTS: library not installed")
        return {"status": "error", "error": "edge-tts not installed. Run: pip install edge-tts"}

    if not text:
        text = get_sample_sentence(lang_code)

    logger.info("Edge TTS: synthesizing demo with voice '%s'", voice_id)
    try:
        wav_bytes = await edge_tts_to_wav(voice_id, text)
    except Exception as exc:
        logger.error("Edge TTS: demo failed for voice '%s': %s", voice_id, exc, exc_info=True)
        return {"status": "error", "error": f"Edge TTS Fehler: {exc}"}

    if wav_bytes is None:
        logger.error("Edge TTS: synthesis returned None for voice '%s'", voice_id)
        return {"status": "error", "error": "Edge TTS konnte keine Audio generieren. Pruefe Internetverbindung."}

    logger.info("Edge TTS: demo complete, %d bytes", len(wav_bytes))
    return Response(content=wav_bytes, media_type="audio/wav")


async def _edge_fallback_demo(lang_code: str, text: str):
    """Fall back to Edge TTS for languages not supported by local engines.
    Uses Katja (de-DE-KatjaNeural) for German, first available voice for other languages.
    """
    from fastapi.responses import Response
    from nox_voice.tts_edge import EDGE_VOICES_BY_LANG

    if not _EDGE_AVAILABLE:
        return {"status": "error", "error": "Edge TTS nicht verfügbar und lokale Engine fehlgeschlagen"}

    # Pick a default Edge voice for the language
    edge_voices = EDGE_VOICES_BY_LANG.get(lang_code, [])
    if not edge_voices:
        # Fall back to German Katja as ultimate default
        edge_voices = EDGE_VOICES_BY_LANG.get("de_DE", [])
    if not edge_voices:
        return {"status": "error", "error": "Keine Edge TTS Stimme verfügbar"}

    voice_id = edge_voices[0][0]  # First voice in the list
    logger.info("Edge TTS fallback: using voice '%s' for lang '%s'", voice_id, lang_code)

    if not text:
        text = get_sample_sentence(lang_code)

    try:
        wav_bytes = await edge_tts_to_wav(voice_id, text)
    except Exception as exc:
        logger.error("Edge TTS fallback failed: %s", exc, exc_info=True)
        return {"status": "error", "error": f"Edge TTS Fallback fehlgeschlagen: {exc}"}

    if wav_bytes is None:
        return {"status": "error", "error": "Edge TTS Fallback konnte keine Audio generieren"}

    logger.info("Edge TTS fallback complete, %d bytes", len(wav_bytes))
    return Response(content=wav_bytes, media_type="audio/wav")


@app.get("/api/voices/demo/kokoro/{lang_code}/{voice_id}")
async def voices_demo_kokoro(lang_code: str, voice_id: str, text: str = ""):
    """Generate a TTS demo using Kokoro-82M. Returns WAV audio.
    Falls back to Edge TTS (Katja for German) if language is not supported by Kokoro.
    """
    from fastapi.responses import Response

    if not text:
        text = get_sample_sentence(lang_code)

    # If Kokoro doesn't support this language, fall back to Edge TTS
    if not is_kokoro_available() or get_kokoro_lang_code(lang_code) is None:
        logger.info("Kokoro: language '%s' not supported, falling back to Edge TTS", lang_code)
        return await _edge_fallback_demo(lang_code, text)

    logger.info("Kokoro: synthesizing demo with voice '%s' in '%s'", voice_id, lang_code)
    loop = asyncio.get_event_loop()
    try:
        wav_bytes = await loop.run_in_executor(None, kokoro_to_wav, text, voice_id, lang_code)
    except Exception as exc:
        logger.error("Kokoro: demo failed: %s", exc, exc_info=True)
        return {"status": "error", "error": f"Kokoro Synthese-Fehler: {exc}"}

    if wav_bytes is None:
        logger.error("Kokoro: synthesis returned None, falling back to Edge TTS")
        return await _edge_fallback_demo(lang_code, text)

    logger.info("Kokoro: demo complete, %d bytes", len(wav_bytes))
    return Response(content=wav_bytes, media_type="audio/wav")


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
    Sets a pollable counter when wake word is detected.
    """
    if not voice_manager.wake_word.is_available:
        return {"status": "error", "error": "Wake word dependencies not available"}

    # Stop existing listener if running
    voice_manager.wake_word.stop()

    # Reset wake detection counter
    app.state.wake_detected_count = 0

    # Update input device if provided
    if body and "input_device" in body:
        voice_manager.wake_word.input_device = body["input_device"]

    original_callback = voice_manager.wake_word.on_wake

    def _wake_sync():
        app.state.wake_detected_count = getattr(app.state, "wake_detected_count", 0) + 1

    voice_manager.wake_word.on_wake = _wake_sync
    voice_manager.wake_word.start()

    if not voice_manager.wake_word.model_loaded:
        voice_manager.wake_word.on_wake = original_callback
        return {"status": "error", "error": "Failed to load wake word model"}

    return {"status": "ok", "model": config.get("wake_word_model", "hey_jarvis")}


@app.get("/api/onboarding/wake-status")
async def wake_status() -> dict[str, Any]:
    """Poll wake word detection count for onboarding."""
    return {"status": "ok", "count": getattr(app.state, "wake_detected_count", 0)}


@app.post("/api/onboarding/stop-wake-word-test")
async def test_wake_word_stop() -> dict[str, Any]:
    """Stop wake word listener after onboarding calibration test."""
    voice_manager.wake_word.stop()
    # Restore original callback
    voice_manager.wake_word.on_wake = voice_manager._on_wake_detected
    # Restart listener if wake word is enabled in config
    if config.get("wake_word_enabled", False) and voice_manager._enabled:
        voice_manager.start()
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
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception as json_exc:
                # Invalid JSON from client — log and skip, don't disconnect
                logger.warning("Invalid JSON from WebSocket client: %s", json_exc)
                continue

            # Manual voice trigger from UI mic button
            if data.get("type") == "voice_trigger":
                logger.info("Manual voice trigger received")
                # Broadcast listening state immediately so UI shows feedback
                await manager.broadcast({"type": "voice_event", "state": "listening"})
                # Run the wake callback path (record + transcribe)
                try:
                    voice_manager._on_wake_detected()
                except Exception as exc:
                    logger.error("voice_trigger failed: %s", exc, exc_info=True)
                    await manager.broadcast({"type": "voice_event", "state": "idle"})
                continue

            message: str = data.get("message", "")
            context: Optional[str] = data.get("context")
            voice_input: bool = data.get("voice_input", False)

            if not message:
                await websocket.send_json({"type": "error", "content": "Empty message"})
                continue

            try:
                async def _send_to_client(msg):
                    await websocket.send_json(msg)
                await orchestrator.process_message(message, voice_input=voice_input, context_override=context, send=_send_to_client)
            except Exception as exc:
                logger.error("Orchestrator error: %s", exc, exc_info=True)
                await websocket.send_json({"type": "error", "content": f"Interner Fehler: {exc}"})
                await websocket.send_json({"type": "done"})

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
