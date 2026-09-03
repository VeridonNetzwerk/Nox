"""Nox Backend – FastAPI Orchestrator

Entry point for the Nox backend server.
Provides health checks, LLM backend status, WebSocket chat streaming,
and voice pipeline integration (wake word, STT, TTS).
"""

import asyncio
import json
import logging
import logging.handlers
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import uvicorn
import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add backend root to sys.path so package imports (voice, eye, files, etc.) work
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Also add subpackage directories for flat imports (settings_manager, platform_utils, etc.)
for _sub in ("core", "voice", "eye", "files", "llm", "analytics", "system"):
    _p = _BACKEND_DIR / _sub
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from settings_manager import SettingsManager
from autostart import AutostartManager
from user_profile import UserProfile

# All Nox sub-loggers that should share the same handlers and log level
_NOX_LOGGERS = (
    "nox.voice", "nox.voice.manager", "nox.voice.wake_word", "nox.voice.stt",
    "nox.voice.tts", "nox.voice.vad", "nox.orchestrator", "nox.orchestrator.conversation",
    "nox.orchestrator.tools", "nox.orchestrator.system_prompt", "nox.eye",
    "nox.eye.manager", "nox.eye.window", "nox.eye.uia", "nox.eye.ocr", "nox.eye.store",
    "nox.files", "nox.files.manager", "nox.files.indexer", "nox.files.store", "nox.settings",
)

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

from platform_utils import get_logs_dir  # noqa: E402 — after sys.path insert
LOG_DIR = get_logs_dir()
LOG_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("nox.backend")
# Log level set later based on dev/prod mode
_log_level = logging.INFO

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
for _name in _NOX_LOGGERS:
    _l = logging.getLogger(_name)
    _l.setLevel(_log_level)
    _l.addHandler(_file_handler)
    _l.addHandler(_timed_handler)
    _l.addHandler(_console_handler)
    _l.propagate = False

# ---------------------------------------------------------------------------
# Config loading – persistent in %APPDATA%\Nox\config.yaml
# ---------------------------------------------------------------------------

# In dev mode, keep config persistent (don't reset on every reload)
_is_dev_mode = (
    "--reload" in sys.argv
    or any("--reload" in str(a) for a in sys.argv)
    or not (Path(__file__).parent / ".prod").exists()  # source tree without .prod marker
)
# Set log level based on mode
if _is_dev_mode:
    _log_level = logging.DEBUG
    logger.setLevel(logging.DEBUG)
    for _name in _NOX_LOGGERS:
        logging.getLogger(_name).setLevel(logging.DEBUG)
else:
    logger.setLevel(logging.INFO)

settings_mgr = SettingsManager()
config = settings_mgr.load()
user_profile = UserProfile(settings_mgr)

# Merge config.local.yaml from backend dir (dev overrides)
LOCAL_CONFIG_PATH = Path(__file__).parent / "config.local.yaml"
if LOCAL_CONFIG_PATH.exists():
    with open(LOCAL_CONFIG_PATH, "r", encoding="utf-8") as f:
        local = yaml.safe_load(f)
    if local:
        config.update(local)
        logger.info("Merged config.local.yaml overrides")

# Analytics — fire-and-forget, respects analytics_enabled setting
try:
    from analytics import track_app_start as _track_app_start  # analytics/ subdir on sys.path
    _track_app_start(config)
except Exception:
    pass

# ---------------------------------------------------------------------------
# Connection manager – broadcasts events to all connected WebSocket clients
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages WebSocket connections for the single-user desktop app.

    Supports multiple simultaneous connections (main window + overlay).
    Broadcasts events to all connected clients.
    """

    def __init__(self):
        self._connections: list[WebSocket] = []

    @property
    def latest(self) -> Optional[WebSocket]:
        """Return the most recent connection, or None."""
        return self._connections[-1] if self._connections else None

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

    async def send_to_latest(self, message: dict[str, Any]) -> None:
        """Send a message to all connected clients (was: latest only)."""
        await self.broadcast(message)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Voice pipeline
# ---------------------------------------------------------------------------

try:
    from voice import VoiceManager
    voice_manager = VoiceManager(config)
except Exception as exc:
    logger.warning("Voice pipeline unavailable: %s", exc)
    voice_manager = None


async def on_voice_state_change(state: str) -> None:
    """Broadcast voice state changes to all UI clients."""
    await manager.broadcast({"type": "voice_event", "state": state})


async def on_voice_wake() -> None:
    """Handle wake word detection – notify UI to show window."""
    # Ignore wake word during onboarding
    if not config.get("onboarding_completed", False):
        logger.info("Wake word ignored – onboarding not completed")
        return
    # Abort any ongoing response
    orchestrator.abort()
    if voice_manager:
        voice_manager.stop_speaking()
    await manager.broadcast({"type": "voice_event", "state": "wake_detected"})


# ---------------------------------------------------------------------------
# Context capture (nox_eye)
# ---------------------------------------------------------------------------

from eye import EyeManager

eye_manager = EyeManager(config)

# ---------------------------------------------------------------------------
# File search (nox_files)
# ---------------------------------------------------------------------------

from files import FilesManager

files_manager = FilesManager(config)

# ---------------------------------------------------------------------------
# Settings apply function – used by tool handler to hot-reload settings
# ---------------------------------------------------------------------------

def apply_settings_update(updates: dict[str, Any]) -> None:
    """Apply setting changes at runtime (called by einstellung_aendern tool).

    This is the single source of truth for hot-reloading settings.
    Also called by the /api/settings endpoint.
    """
    config.update(updates)
    if "ollama_model" in updates:
        orchestrator.set_model(updates["ollama_model"])
    if "ollama_model_mode" in updates:
        config["_vram_user_mode"] = updates["ollama_model_mode"]
    if "llm_speed_mode" in updates:
        if orchestrator.backend and hasattr(orchestrator.backend, "set_speed_mode"):
            orchestrator.backend.set_speed_mode(updates["llm_speed_mode"])
    # Voice-related settings require voice_manager to be available
    voice_keys = {"wake_word_threshold", "wake_word_enabled", "tts_model", "tts_engine",
                  "audio_input_device", "audio_output_device", "vad_silence_duration",
                  "end_turn_silence_threshold", "end_turn_max_silence",
                  "end_turn_fillword_extension", "end_turn_incomplete_sentence_extension",
                  "end_turn_enabled"}
    if voice_keys & updates.keys() and voice_manager is None:
        logger.warning("Voice settings ignored — voice pipeline not available")
    if voice_manager:
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
    if voice_manager:
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
        if "end_turn_fillword_extension" in updates:
            voice_manager.recorder.end_turn_fillword_extension = updates["end_turn_fillword_extension"]
        if "end_turn_incomplete_sentence_extension" in updates:
            voice_manager.recorder.end_turn_incomplete_sentence_extension = updates["end_turn_incomplete_sentence_extension"]
        if "end_turn_enabled" in updates:
            voice_manager.recorder.end_turn_enabled = updates["end_turn_enabled"]
    files_keys = {"nox_files_enabled", "nox_files_full_drive", "nox_files_custom_folders",
                  "nox_files_excluded_dirs", "nox_files_ocr_gpu"}
    if files_keys & updates.keys():
        files_manager.update_settings(updates)
    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
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


async def on_voice_transcript(transcript: str, from_wake_word: bool = True) -> None:
    """Handle a voice transcript.

    For wake word triggers, send directly as a chat message.
    For manual mic button clicks, send to the input field for review/editing.
    """
    if from_wake_word:
        await manager.send_to_latest({
            "type": "user_message",
            "content": transcript,
            "voice_input": True,
        })
        async def _send_to_latest(msg):
            await manager.send_to_latest(msg)
        await orchestrator.process_message(transcript, voice_input=True, send=_send_to_latest)
    else:
        # Manual mic button: put transcript in input field, don't send yet
        await manager.send_to_latest({
            "type": "voice_transcript",
            "content": transcript,
        })


if voice_manager:
    voice_manager.set_callbacks(
        on_state_change=on_voice_state_change,
        on_transcript=on_voice_transcript,
        on_wake=on_voice_wake,
)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Nox Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8420", "http://127.0.0.1:8420"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.on_event("startup")
async def startup_event() -> None:
    """Start voice pipeline on server startup."""
    if voice_manager:
        voice_manager.set_event_loop(asyncio.get_running_loop())
        voice_manager.start()
    eye_manager.start()
    files_manager.start()
    orchestrator.set_broadcast(manager.broadcast)

    # Initialize LLM backend (auto-detect Ollama, OpenAI-compatible, llama.cpp)
    backend_ok = False
    try:
        backend_ok = await orchestrator.init_backend()
        if backend_ok:
            bt = orchestrator.backend.backend_type
            logger.info("LLM backend ready: %s", bt)
        else:
            logger.warning("No LLM backend available – chat will not work until one is started")
    except Exception as exc:
        logger.warning("LLM backend init failed: %s", exc, exc_info=True)

    # Auto-select best model if configured model is missing (only after onboarding)
    configured_model = config.get("ollama_model", "")
    onboarding_done = config.get("onboarding_completed", False)
    try:
        available = await orchestrator.get_available_models()
        if available and configured_model and onboarding_done:
            # Use fuzzy matching to check if the configured model exists
            matched = _match_model(configured_model, available)
            if not matched:
                vram_mb = _get_gpu_vram()
                model_mode = config.get("ollama_model_mode", "balance")
                new_model = _select_model_by_vram(available, vram_mb, mode=model_mode)
                if new_model:
                    logger.warning(
                        "Configured model '%s' not found. Available: %s. VRAM: %dMB. Mode: %s. Auto-selecting '%s'.",
                        configured_model, available, vram_mb, model_mode, new_model,
                    )
                    config["ollama_model"] = new_model
                    orchestrator.set_model(new_model)
                    settings_mgr.save(config)
                    logger.info("Switched active model to '%s'", new_model)
                else:
                    logger.warning(
                        "Configured model '%s' not found and no suitable alternative. Available: %s",
                        configured_model, available,
                    )
            elif matched != configured_model:
                # Model exists with a slightly different name (e.g. different quantization)
                logger.info("Model '%s' matched as '%s'", configured_model, matched)
                config["ollama_model"] = matched
                orchestrator.set_model(matched)
                settings_mgr.save(config)
    except Exception as exc:
        logger.warning("Could not verify models at startup: %s", exc, exc_info=True)

    # Preload model only if onboarding is completed and user has selected a model
    onboarding_done = config.get("onboarding_completed", False)
    vram_mode_startup = config.get("ollama_vram_mode", "auto")
    should_preload = onboarding_done and (config.get("ollama_preload", False) or vram_mode_startup == "auto")
    if should_preload and orchestrator.backend and orchestrator.backend.backend_type == "ollama":
        preload_mode = config.get("ollama_preload_mode", "vram")
        model = config.get("ollama_model", "qwen3:14b")
        ollama_host = config.get("ollama_host", "http://localhost:11434")
        logger.info("Preloading model '%s' (mode=%s, vram_mode=%s)...", model, preload_mode, vram_mode_startup)
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "model": model,
                    "prompt": "",
                    "keep_alive": -1,
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

    # Start VRAM monitor if auto mode is enabled and onboarding is done
    vram_mode = config.get("ollama_vram_mode", "auto")
    if vram_mode == "auto" and onboarding_done and orchestrator.backend and orchestrator.backend.backend_type == "ollama":
        # Store user's preferred mode for recovery after downgrade
        config["_vram_user_mode"] = config.get("ollama_model_mode", "balance")
        asyncio.create_task(_vram_monitor_loop())


async def _vram_monitor_loop() -> None:
    """Background task: monitor free VRAM and adaptively manage model loading.

    - When VRAM is plentiful: keep model loaded (keep_alive=-1)
    - When VRAM gets low: downgrade to smaller model tier
    - When VRAM is critical: unload model completely
    - When VRAM frees up again: upgrade back to user's preferred mode
    """
    CHECK_INTERVAL = 15  # seconds
    VRAM_LOW_THRESHOLD_MB = 2048  # free VRAM below this = downgrade
    VRAM_CRITICAL_MB = 512  # free VRAM below this = unload
    VRAM_RECOVERY_MB = 4096  # free VRAM above this = try upgrading

    logger.info("VRAM monitor started (interval=%ds)", CHECK_INTERVAL)
    _vram_unloaded = False

    while True:
        try:
            await asyncio.sleep(CHECK_INTERVAL)
            mode = config.get("ollama_vram_mode", "auto")
            if mode != "auto":
                continue
            if not orchestrator.backend:
                continue
            bt = orchestrator.backend.backend_type
            if bt not in ("ollama", "llama_cpp"):
                continue

            free_vram = _get_gpu_vram_free()
            if free_vram == 0:
                continue  # no GPU or nvidia-smi unavailable

            current_model = config.get("ollama_model", "")
            user_mode = config.get("ollama_model_mode", "balance")

            if free_vram < VRAM_CRITICAL_MB:
                # Critical: unload model completely
                if not _vram_unloaded:
                    logger.warning("VRAM critical (%dMB free) — unloading model '%s'", free_vram, current_model)
                    if bt == "llama_cpp" and hasattr(orchestrator.backend, "unload_model"):
                        orchestrator.backend.unload_model()
                    else:
                        try:
                            async with httpx.AsyncClient(timeout=10.0) as client:
                                await client.post(
                                    f"{config.get('ollama_host', 'http://localhost:11434')}/api/generate",
                                    json={"model": current_model, "prompt": "", "keep_alive": 0},
                                )
                        except Exception:
                            pass
                    _vram_unloaded = True
                    if orchestrator._broadcast:
                        await orchestrator._broadcast({"type": "vram_status", "action": "unloaded", "free_vram_mb": free_vram})

            elif free_vram < VRAM_LOW_THRESHOLD_MB:
                # Low: downgrade model tier
                if _vram_unloaded:
                    if bt == "llama_cpp":
                        # For llama_cpp, model auto-reloads on next use (lazy loading).
                        # Just restore speed mode to superschnell to minimize memory.
                        if hasattr(orchestrator.backend, "set_speed_mode"):
                            orchestrator.backend.set_speed_mode("superschnell")
                            config["llm_speed_mode"] = "superschnell"
                            settings_mgr.save(config)
                        _vram_unloaded = False
                        if orchestrator._broadcast:
                            await orchestrator._broadcast({"type": "vram_status", "action": "downgraded", "mode": "superschnell", "free_vram_mb": free_vram})
                    else:
                        # Model is unloaded, try loading the smallest tier
                        available = await orchestrator.get_available_models()
                        vram_total = _get_gpu_vram()
                        new_model = _select_model_by_vram(available, vram_total, mode="superschnell")
                        if new_model and new_model != current_model:
                            logger.info("VRAM low (%dMB) — loading smallest model '%s'", free_vram, new_model)
                            orchestrator.set_model(new_model)
                            config["ollama_model"] = new_model
                            settings_mgr.save(config)
                            _vram_unloaded = False
                            if orchestrator._broadcast:
                                await orchestrator._broadcast({"type": "vram_status", "action": "downgraded", "model": new_model, "mode": "superschnell", "free_vram_mb": free_vram})
                else:
                    if bt == "llama_cpp":
                        # Downgrade speed mode one step to reduce memory/tokens
                        llm_mode = config.get("llm_speed_mode", "balance")
                        current_mode_idx = _MODE_DOWNGRADE_ORDER.index(llm_mode) if llm_mode in _MODE_DOWNGRADE_ORDER else 1
                        if current_mode_idx < len(_MODE_DOWNGRADE_ORDER) - 1:
                            downgrade_mode = _MODE_DOWNGRADE_ORDER[current_mode_idx + 1]
                            if hasattr(orchestrator.backend, "set_speed_mode"):
                                orchestrator.backend.set_speed_mode(downgrade_mode)
                                config["llm_speed_mode"] = downgrade_mode
                                settings_mgr.save(config)
                                logger.info("VRAM low (%dMB) — downgrading llama_cpp speed mode to '%s'", free_vram, downgrade_mode)
                                if orchestrator._broadcast:
                                    await orchestrator._broadcast({"type": "vram_status", "action": "downgraded", "mode": downgrade_mode, "free_vram_mb": free_vram})
                    else:
                        # Try downgrading one tier
                        current_mode_idx = _MODE_DOWNGRADE_ORDER.index(user_mode) if user_mode in _MODE_DOWNGRADE_ORDER else 1
                        if current_mode_idx < len(_MODE_DOWNGRADE_ORDER) - 1:
                            downgrade_mode = _MODE_DOWNGRADE_ORDER[current_mode_idx + 1]
                            available = await orchestrator.get_available_models()
                            vram_total = _get_gpu_vram()
                            new_model = _select_model_by_vram(available, vram_total, mode=downgrade_mode)
                            if new_model and new_model != current_model:
                                logger.info("VRAM low (%dMB) — downgrading from '%s' to '%s' (mode: %s)", free_vram, current_model, new_model, downgrade_mode)
                                # Unload old model first
                                try:
                                    async with httpx.AsyncClient(timeout=10.0) as client:
                                        await client.post(
                                            f"{config.get('ollama_host', 'http://localhost:11434')}/api/generate",
                                            json={"model": current_model, "prompt": "", "keep_alive": 0},
                                        )
                                except Exception:
                                    pass
                                orchestrator.set_model(new_model)
                                config["ollama_model"] = new_model
                                config["ollama_model_mode"] = downgrade_mode
                                settings_mgr.save(config)
                                if orchestrator._broadcast:
                                    await orchestrator._broadcast({"type": "vram_status", "action": "downgraded", "model": new_model, "mode": downgrade_mode, "free_vram_mb": free_vram})

            elif free_vram >= VRAM_RECOVERY_MB and _vram_unloaded:
                # Recovery: only reload if model was fully unloaded (critical VRAM).
                # Do NOT auto-upgrade if user manually chose a smaller model — respect their choice.
                _vram_unloaded = False
                if bt == "llama_cpp":
                    # For llama_cpp, model auto-reloads on next use (lazy loading).
                    # Restore the user's speed mode.
                    stored_speed_mode = config.get("llm_speed_mode", "balance")
                    if hasattr(orchestrator.backend, "set_speed_mode"):
                        orchestrator.backend.set_speed_mode(stored_speed_mode)
                        logger.info("VRAM recovered (%dMB) — restored llama_cpp speed mode '%s'", free_vram, stored_speed_mode)
                    if orchestrator._broadcast:
                        await orchestrator._broadcast({"type": "vram_status", "action": "upgraded", "mode": stored_speed_mode, "free_vram_mb": free_vram})
                else:
                    stored_user_mode = config.get("_vram_user_mode", user_mode)
                    available = await orchestrator.get_available_models()
                    vram_total = _get_gpu_vram()
                    new_model = _select_model_by_vram(available, vram_total, mode=stored_user_mode)
                    if new_model and new_model != current_model:
                        logger.info("VRAM recovered (%dMB) — reloading user's model '%s' (mode: %s)", free_vram, new_model, stored_user_mode)
                        orchestrator.set_model(new_model)
                        config["ollama_model"] = new_model
                        config["ollama_model_mode"] = stored_user_mode
                        settings_mgr.save(config)
                        if orchestrator._broadcast:
                            await orchestrator._broadcast({"type": "vram_status", "action": "upgraded", "model": new_model, "mode": stored_user_mode, "free_vram_mb": free_vram})

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("VRAM monitor error: %s", exc)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Clean up voice pipeline on shutdown."""
    if voice_manager:
        voice_manager.stop()
    eye_manager.stop()
    files_manager.stop()
    await orchestrator.close()
    logger.info("Backend shutdown complete")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness check – always returns 200 if the process is alive."""
    return {"status": "ok", "service": "nox-backend", "version": "0.1.0"}


@app.get("/api/username")
async def get_username() -> dict[str, Any]:
    """Return the current OS username for personalized greetings."""
    try:
        import os
        username = os.getlogin() or os.environ.get("USERNAME") or os.environ.get("USER") or ""
        # Clean up Windows DOMAIN\\user format
        if "\\" in username:
            username = username.split("\\")[-1]
        return {"status": "ok", "username": username}
    except Exception:
        return {"status": "ok", "username": ""}


@app.get("/health/ollama")
async def health_ollama() -> dict[str, Any]:
    """Check LLM backend reachability and report loaded model.

    Works with any backend (Ollama, OpenAI-compatible, llama.cpp).
    If no backend is initialized, attempts to re-detect (Ollama may have
    started after Nox).
    """
    ollama_model = config.get("ollama_model", "qwen3:14b")
    if orchestrator.backend is None:
        # Try to re-initialize — Ollama may have started after Nox
        try:
            backend_ok = await orchestrator.init_backend()
            if backend_ok:
                bt = orchestrator.backend.backend_type
                logger.info("LLM backend re-detected during health check: %s", bt)
            else:
                return {
                    "status": "error",
                    "backend_type": "none",
                    "configured_model": ollama_model,
                    "error": "No LLM backend available. Start Ollama, LM Studio, or another OpenAI-compatible server.",
                }
        except Exception as exc:
            logger.warning("Re-detect backend failed: %s", exc, exc_info=True)
            return {
                "status": "error",
                "backend_type": "none",
                "configured_model": ollama_model,
                "error": f"Backend detection failed: {exc}",
            }
    bt = orchestrator.backend.backend_type
    endpoint = orchestrator.backend.endpoint or "in-process"
    try:
        available = await orchestrator.get_available_models()
        return {
            "status": "ok",
            "backend_type": bt,
            "endpoint": endpoint,
            "configured_model": ollama_model,
            "available_models": available,
            "model_available": ollama_model in available,
        }
    except httpx.ConnectError:
        return {
            "status": "error",
            "backend_type": bt,
            "endpoint": endpoint,
            "configured_model": ollama_model,
            "error": f"Backend ({bt}) not reachable at {endpoint}.",
        }
    except httpx.TimeoutException:
        return {
            "status": "error",
            "backend_type": bt,
            "endpoint": endpoint,
            "configured_model": ollama_model,
            "error": f"Backend ({bt}) at {endpoint} did not respond within 5 seconds.",
        }
    except Exception as exc:
        logger.error("Unexpected error checking backend: %s", exc, exc_info=True)
        return {
            "status": "error",
            "backend_type": bt,
            "endpoint": endpoint,
            "configured_model": ollama_model,
            "error": f"Unexpected error: {exc}",
        }


@app.get("/health/voice")
async def health_voice() -> dict[str, Any]:
    """Check voice pipeline component status."""
    if voice_manager:
        return voice_manager.health()
    return {"available": False, "reason": "Voice pipeline not loaded"}


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


@app.get("/api/files/search")
async def files_search(query: str, k: int = 10, folder: str = "") -> dict[str, Any]:
    """Search indexed files by query."""
    results = files_manager.search(query, k=k, folder=folder or None)
    return {"status": "ok", "query": query, "count": len(results), "results": results}


@app.get("/api/files/read")
async def files_read(pfad: str, suche: str = "", zeile: int = 0) -> dict[str, Any]:
    """Read a file or search within it."""
    content = files_manager.read_file(pfad)
    if content is None:
        return {"status": "error", "error": f"Datei nicht gefunden: {pfad}"}
    lines = content.split("\n")
    total = len(lines)
    if suche:
        matches = [{"line": i+1, "text": line} for i, line in enumerate(lines) if suche.lower() in line.lower()]
        return {"status": "ok", "file": pfad, "total_lines": total, "matches": matches}
    if zeile > 0:
        idx = zeile - 1
        if 0 <= idx < total:
            return {"status": "ok", "file": pfad, "line": zeile, "text": lines[idx]}
        return {"status": "error", "error": f"Zeile {zeile} existiert nicht ({total} Zeilen)"}
    numbered = [{"line": i+1, "text": line} for i, line in enumerate(lines)]
    return {"status": "ok", "file": pfad, "total_lines": total, "lines": numbered[:500]}


@app.get("/api/models")
async def get_models() -> dict[str, Any]:
    """List available models for the settings panel dropdown."""
    models = await orchestrator.get_available_models()
    bt = orchestrator.backend.backend_type if orchestrator.backend else "none"
    endpoint = orchestrator.backend.endpoint if orchestrator.backend else ""
    return {
        "status": "ok",
        "current_model": config.get("ollama_model", "qwen3:14b"),
        "available_models": models,
        "model_mode": config.get("ollama_model_mode", "balance"),
        "vram_mb": _get_gpu_vram(),
        "vram_free_mb": _get_gpu_vram_free(),
        "vram_mode": config.get("ollama_vram_mode", "auto"),
        "backend_type": bt,
        "endpoint": endpoint,
    }


@app.post("/api/model")
async def set_model(body: dict[str, Any]) -> dict[str, Any]:
    """Change the active model at runtime.

    Accepts either:
    - {"model": "model_name"} to set a specific model
    - {"mode": "balance"} to auto-select by VRAM and mode
    - {"reconnect": true} to re-detect LLM backend
    """
    # Re-detect backend
    if body.get("reconnect"):
        ok = await orchestrator.init_backend()
        if not ok:
            return {"status": "error", "error": "No LLM backend found. Start Ollama, LM Studio, or another server."}
        bt = orchestrator.backend.backend_type
        return {"status": "ok", "backend_type": bt, "model": orchestrator.llm_model}

    mode = body.get("mode", "")
    if mode:
        vram_mb = _get_gpu_vram()
        available = await orchestrator.get_available_models()
        new_model = _select_model_by_vram(available, vram_mb, mode=mode)
        if not new_model:
            return {"status": "error", "error": f"No model found for mode '{mode}' (VRAM: {vram_mb}MB)"}
        orchestrator.set_model(new_model)
        config["ollama_model"] = new_model
        config["ollama_model_mode"] = mode
        config["_vram_user_mode"] = mode
        settings_mgr.save(config)
        logger.info("Model switched via mode: %s -> %s (vram=%dMB)", mode, new_model, vram_mb)
        return {"status": "ok", "model": new_model, "mode": mode}

    model = body.get("model", "")
    if not model:
        return {"status": "error", "error": "No model, mode, or reconnect specified"}
    orchestrator.set_model(model)
    config["ollama_model"] = model
    return {"status": "ok", "model": model}


@app.post("/api/conversation/new")
async def new_conversation() -> dict[str, Any]:
    """Start a new conversation session."""
    conv_id = orchestrator.new_conversation()
    return {"status": "ok", "conversation_id": conv_id}


@app.get("/api/conversation/list")
async def list_conversations(limit: int = 30) -> dict[str, Any]:
    """List recent conversations grouped by conversation_id, using AI-generated
    titles when available, falling back to the first user message."""
    try:
        import sqlite3
        db_path = orchestrator.conversation_store.db_path
        conn = sqlite3.connect(db_path, check_same_thread=False)
        # Get distinct conversation_ids with their first user message
        rows = conn.execute(
            "SELECT c.conversation_id, c.content, c.timestamp "
            "FROM conversations c "
            "INNER JOIN ("
            "  SELECT conversation_id, MIN(id) as min_id "
            "  FROM conversations WHERE role='user' "
            "  GROUP BY conversation_id"
            ") first ON c.id = first.min_id "
            "ORDER BY first.min_id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        # Fetch AI-generated titles
        title_rows = conn.execute(
            "SELECT conversation_id, title FROM conversation_titles"
        ).fetchall()
        title_map = {r[0]: r[1] for r in title_rows}
        conn.close()
        conversations = [
            {
                "id": r[0],
                "title": title_map.get(r[0]) or (r[1][:80] if r[1] else "Unbenannte Unterhaltung"),
                "timestamp": r[2],
            }
            for r in rows
        ]
        return {"status": "ok", "conversations": conversations}
    except Exception as exc:
        logger.error("Failed to list conversations: %s", exc, exc_info=True)
        return {"status": "ok", "conversations": []}


@app.post("/api/conversation/generate-title")
async def generate_conversation_title() -> dict[str, Any]:
    """Generate a short (max 2 words) title for the current conversation using the LLM."""
    try:
        conv_id = orchestrator.conversation_id
        turns = orchestrator.conversation_store.get_recent_turns(conv_id, n=10)
        if not turns:
            return {"status": "ok", "title": None}

        # Build a compact summary of the conversation for the LLM
        snippet = ""
        for t in turns:
            role = t.get("role", "")
            content = t.get("content", "")[:200]
            if role in ("user", "assistant"):
                snippet += f"{role}: {content}\n"

        if not snippet.strip():
            return {"status": "ok", "title": None}

        prompt = (
            f"Fasse das Thema dieses Gesprächs in MAXIMAL ZWEI Wörtern zusammen. "
            f"Antworte NUR mit diesen Wörtern, ohne Satzzeichen, ohne Erklärung.\n\n"
            f"Gespräch:\n{snippet[:1500]}"
        )

        # Use the LLM backend to generate a title
        if not orchestrator.backend:
            return {"status": "ok", "title": None}

        title = None
        async for item in orchestrator.backend.stream_chat(
            messages=[{"role": "user", "content": prompt}],
            num_ctx=2048,
        ):
            if isinstance(item, str):
                if title is None:
                    title = ""
                title += item
            elif isinstance(item, dict) and "stats" in item:
                break

        if not title:
            return {"status": "ok", "title": None}

        title = title.strip()
        # Clean up: remove quotes, punctuation, newlines
        title = title.strip('"\'`.,!? \n\t')
        # Enforce max 2 words
        words = title.split()
        if len(words) > 2:
            title = " ".join(words[:2])
        if not title:
            return {"status": "ok", "title": None}

        # Save title
        orchestrator.conversation_store.set_title(conv_id, title)
        return {"status": "ok", "title": title, "conversation_id": conv_id}
    except Exception as exc:
        logger.error("Failed to generate title: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.get("/api/brief")
async def daily_brief() -> dict[str, Any]:
    """Generate a daily brief: date, recent conversation topics, and a short AI summary."""
    try:
        from datetime import datetime
        now = datetime.now()
        date_str = now.strftime("%A, %d. %B %Y")
        time_str = now.strftime("%H:%M")

        # Gather recent conversation topics
        import sqlite3
        db_path = orchestrator.conversation_store.db_path
        conn = sqlite3.connect(db_path, check_same_thread=False)
        rows = conn.execute(
            "SELECT content, timestamp FROM conversations "
            "WHERE role='user' ORDER BY id DESC LIMIT 5",
        ).fetchall()
        conn.close()
        recent_topics = [r[0][:60] for r in rows if r[0]]

        # Build a brief prompt
        topics_str = "\n".join(f"- {t}" for t in recent_topics) if recent_topics else "Keine bisherigen Gespräche."
        brief_prompt = (
            f"Du bist Nox, ein persönlicher KI-Assistent. Erstelle ein kurzes Morgen-Briefing für den Nutzer.\n"
            f"Heute ist {date_str}, es ist {time_str} Uhr.\n"
            f"Letzte Gesprächsthemen des Nutzers:\n{topics_str}\n\n"
            f"Erstelle ein kurzes, persönliches Briefing (max. 5 Sätze) auf Deutsch, das:\n"
            f"1. Den Nutzer begrüßt und Datum/Uhrzeit nennt\n"
            f"2. Kurz auf die letzten Themen eingeht (falls vorhanden)\n"
            f"3. Einen motivierenden oder nützlichen Tipp für den Tag gibt\n"
            f"Halte es kurz und natürlich, wie ein guter Freund am Morgen."
        )

        # Use the LLM to generate the brief
        brief_text = ""
        if orchestrator.backend:
            messages = [{"role": "user", "content": brief_prompt}]
            async for token in orchestrator.backend.stream_chat(messages, think=False, num_ctx=2048):
                if isinstance(token, str):
                    brief_text += token
        else:
            brief_text = f"Guten Morgen! Heute ist {date_str}, {time_str} Uhr. Dein Nox-Backend ist bereit."

        return {
            "status": "ok",
            "date": date_str,
            "time": time_str,
            "recent_topics": recent_topics,
            "brief": brief_text.strip(),
        }
    except Exception as exc:
        logger.error("Failed to generate daily brief: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.get("/api/conversation/{conversation_id}")
async def get_conversation(conversation_id: str) -> dict[str, Any]:
    """Load all turns of a specific conversation."""
    try:
        turns = orchestrator.conversation_store.get_recent_turns(conversation_id, n=500)
        title = orchestrator.conversation_store.get_title(conversation_id)
        return {"status": "ok", "conversation_id": conversation_id, "turns": turns, "title": title}
    except Exception as exc:
        logger.error("Failed to load conversation: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.get("/api/conversation/{conversation_id}/export")
async def export_conversation(conversation_id: str, format: str = "markdown") -> Response:
    """Export a conversation as Markdown, JSON, or plain text."""
    try:
        turns = orchestrator.conversation_store.get_recent_turns(conversation_id, n=500)
        turns = list(reversed(turns))

        if format == "json":
            import json as _json
            content = _json.dumps({"conversation_id": conversation_id, "turns": turns}, ensure_ascii=False, indent=2)
            return Response(content=content, media_type="application/json",
                            headers={"Content-Disposition": f"attachment; filename=nox-chat-{conversation_id[:8]}.json"})

        if format == "text":
            lines = []
            for t in turns:
                prefix = "Du" if t["role"] == "user" else "Nox"
                lines.append(f"[{t.get('timestamp', '')}] {prefix}:")
                lines.append(t["content"])
                lines.append("")
            content = "\n".join(lines)
            return Response(content=content, media_type="text/plain; charset=utf-8",
                            headers={"Content-Disposition": f"attachment; filename=nox-chat-{conversation_id[:8]}.txt"})

        # Default: markdown
        lines = [f"# Nox Chat Export", f"*Konversation ID: {conversation_id}*", ""]
        for t in turns:
            prefix = "**Du**" if t["role"] == "user" else "**Nox**"
            ts = t.get("timestamp", "")
            lines.append(f"### {prefix} ({ts})")
            lines.append("")
            lines.append(t["content"])
            lines.append("")
            lines.append("---")
            lines.append("")
        content = "\n".join(lines)
        return Response(content=content, media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=nox-chat-{conversation_id[:8]}.md"})
    except Exception as exc:
        logger.error("Failed to export conversation: %s", exc, exc_info=True)
        return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)


@app.post("/api/feedback")
async def submit_feedback(body: dict[str, Any]) -> dict[str, Any]:
    """Store user feedback (like/dislike) on an assistant response.

    Stored in SQLite for potential future model fine-tuning or preference learning.
    """
    try:
        import sqlite3
        conv_id = body.get("conversation_id", "")
        message = body.get("message", "")
        response = body.get("response", "")
        rating = body.get("rating", "")  # "like" | "dislike"
        if rating not in ("like", "dislike"):
            return {"status": "error", "error": "rating must be 'like' or 'dislike'"}

        db_path = orchestrator.conversation_store.db_path
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS feedback ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  conversation_id TEXT,"
            "  message TEXT,"
            "  response TEXT,"
            "  rating TEXT,"
            "  timestamp TEXT"
            ")"
        )
        from datetime import datetime
        conn.execute(
            "INSERT INTO feedback (conversation_id, message, response, rating, timestamp) VALUES (?, ?, ?, ?, ?)",
            (conv_id, message, response, rating, datetime.now().isoformat()),
        )
        conn.commit()
        conn.close()
        logger.info("Feedback stored: rating=%s, conv=%s", rating, conv_id)
        return {"status": "ok"}
    except Exception as exc:
        logger.error("Failed to store feedback: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


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
    updated = settings_mgr.save(updates)
    apply_settings_update(updates)
    return {"status": "ok", "settings": updated}


@app.get("/api/profile")
async def get_profile() -> dict[str, Any]:
    """Return the user profile (location, name, timezone, etc.)."""
    return {"status": "ok", "profile": user_profile.get_all()}


@app.post("/api/profile")
async def update_profile(body: dict[str, Any]) -> dict[str, Any]:
    """Update one or more profile fields."""
    updated = user_profile.update(body)
    return {"status": "ok", "profile": updated}


@app.post("/api/profile/auto-detect")
async def auto_detect_profile() -> dict[str, Any]:
    """Auto-detect location, timezone, and language from system + IP."""
    detected = user_profile.auto_detect()
    return {"status": "ok", "detected": detected, "profile": user_profile.get_all()}


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
    from voice.audio_devices import list_devices
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


@app.post("/api/execute")
async def execute_code(body: dict[str, Any]) -> dict[str, Any]:
    """Execute a Python or shell code snippet and return the output.

    Limited to 10 seconds timeout. Python uses the embedded interpreter.
    Shell uses the system shell (cmd on Windows, bash on Linux).
    """
    code = body.get("code", "")
    lang = body.get("lang", "python").lower()
    if not code.strip():
        return {"status": "error", "error": "Leerer Code"}

    if len(code) > 5000:
        return {"status": "error", "error": "Code zu lang (max. 5000 Zeichen)"}

    try:
        if lang in ("python", "py"):
            result = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True, text=True, timeout=10,
            )
        elif lang in ("shell", "sh", "bash", "cmd", "powershell"):
            shell_cmd = ["cmd", "/c", code] if sys.platform == "win32" else ["bash", "-c", code]
            result = subprocess.run(
                shell_cmd,
                capture_output=True, text=True, timeout=10,
            )
        else:
            return {"status": "error", "error": f"Sprache '{lang}' nicht unterstützt"}

        output = result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr
        return {
            "status": "ok",
            "output": output[:10000] if output else "(keine Ausgabe)",
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "Zeitüberschreitung (10s)"}
    except Exception as exc:
        logger.error("Code execution failed: %s", exc, exc_info=True)
        return {"status": "error", "error": str(exc)}


@app.post("/api/audio/test-input")
async def test_input_device(body: dict[str, Any]) -> dict[str, Any]:
    """Record a brief 1-second sample from the specified input device and return RMS level."""
    device = body.get("device", "default")
    try:
        import numpy as np
        import sounddevice as sd
        from voice.audio_devices import resolve_input_device
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
        from voice.audio_devices import resolve_output_device
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

    if not voice_manager or not voice_manager._is_tts_available():
        return {"status": "error", "error": "TTS not available (configured engine or sounddevice missing)"}

    voice_manager.speak_response(text)
    return {"status": "ok"}


@app.post("/api/tts/stop")
async def tts_stop() -> dict[str, Any]:
    """Stop any ongoing TTS playback."""
    if voice_manager:
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
    # LLM backend
    llm_status = "unknown"
    llm_error = None
    llm_backend_type = "none"
    llm_endpoint = ""
    if orchestrator.backend:
        llm_backend_type = orchestrator.backend.backend_type
        llm_endpoint = orchestrator.backend.endpoint or "in-process"
        try:
            if await orchestrator.backend.check_available():
                llm_status = "ok"
            else:
                llm_status = "error"
                llm_error = "Backend not reachable"
        except Exception as exc:
            llm_status = "error"
            llm_error = str(exc)
    else:
        llm_status = "error"
        llm_error = "No LLM backend detected"

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
    voice_health = voice_manager.health() if voice_manager else {"available": False}

    # Eye
    eye_health = eye_manager.health()

    return {
        "status": "ok",
        "ollama": {
            "status": llm_status,
            "host": llm_endpoint,
            "backend_type": llm_backend_type,
            "error": llm_error,
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

OLLAMA_INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
OLLAMA_LINUX_TGZ_URL = "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst"
ONBOARDING_STATE: dict[str, Any] = {}

IS_LINUX = sys.platform.startswith("linux")


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


def _get_gpu_vram_free() -> int:
    """Query free GPU VRAM in MB via nvidia-smi. Returns 0 if unavailable."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
            encoding="utf-8", errors="replace",
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip().splitlines()[0].strip())
    except Exception:
        pass
    return 0


# Downgrade order: from highest quality to lowest, then unload
_MODE_DOWNGRADE_ORDER = ["qualitaet", "balance", "schnell", "superschnell"]


# Model selection table: (vram_min_mb, vram_max_mb) -> {mode: ollama_model_name}
# Modes: "superschnell", "schnell", "balance", "qualitaet"
_MODEL_TABLE = [
    (0,      4096,  {"superschnell": "phi4-mini:3.8b",              "schnell": "phi4-mini:3.8b",            "balance": "phi4-mini:3.8b",              "qualitaet": "phi4-mini:3.8b"}),
    (4096,   8192,  {"superschnell": "phi4-mini:3.8b",              "schnell": "gemma4:e4b",                "balance": "gemma4:e4b",                  "qualitaet": "qwen3.5:4b"}),
    (8192,   12288, {"superschnell": "phi4-mini:3.8b",              "schnell": "gemma4:e4b",                "balance": "gemma4:e4b",                  "qualitaet": "qwen3.5:9b"}),
    (12288,  16384, {"superschnell": "gemma4:e4b",                  "schnell": "gemma4:e4b",                "balance": "qwen3.5:9b",                  "qualitaet": "deepseek-r1:14b-qwen-distill"}),
    (16384,  20480, {"superschnell": "gemma4:e4b",                  "schnell": "qwen3.5:9b",                "balance": "qwen3.5:9b-q6_K",             "qualitaet": "gpt-oss:20b"}),
    (20480,  24576, {"superschnell": "gemma4:e4b",                  "schnell": "qwen3.5:9b",                "balance": "deepseek-r1:14b-qwen-distill", "qualitaet": "mistral-small3.2:24b"}),
    (24576,  32768, {"superschnell": "qwen3.5:9b",                  "schnell": "deepseek-r1:14b-qwen-distill", "balance": "gpt-oss:20b",              "qualitaet": "qwen3.8:27b"}),
    (32768,  40960, {"superschnell": "qwen3.5:9b",                  "schnell": "mistral-small3.2:24b",      "balance": "qwen3.8:27b",                 "qualitaet": "qwen3.6:35b-a3b"}),
    (40960,  999999,{"superschnell": "qwen3.5:9b-q6_K",             "schnell": "qwen3.8:27b",               "balance": "qwen3.6:35b-a3b",             "qualitaet": "llama3.3:70b-q3_K"}),
]

_MODE_FALLBACK_ORDER = ["balance", "schnell", "qualitaet", "superschnell"]


def _match_model(target: str, available_models: list[str]) -> str | None:
    """Try to match a target model name against available Ollama models.

    Tries exact match, then prefix match (ignoring quantization tags).
    """
    target_lower = target.lower()
    # Exact match
    for m in available_models:
        if m.lower() == target_lower:
            return m
    # Prefix match: available model starts with target (e.g. "deepseek-r1:14b-qwen-distill-q4_K_M"
    # matches target "deepseek-r1:14b-qwen-distill")
    for m in available_models:
        m_lower = m.lower()
        if m_lower.startswith(target_lower):
            return m
    # Reverse prefix: target starts with available (e.g. target "qwen3.8:27b"
    # matches available "qwen3.8:27b-mtp-q4_K_M")
    for m in available_models:
        m_lower = m.lower()
        if target_lower.startswith(m_lower):
            return m
    # Fuzzy: match base name (before ':') and size
    target_base = target_lower.split(":")[0]
    target_size = target_lower.split(":")[1] if ":" in target_lower else ""
    for m in available_models:
        m_lower = m.lower()
        m_base = m_lower.split(":")[0]
        m_size = m_lower.split(":")[1] if ":" in m_lower else ""
        if m_base == target_base and target_size and m_size.startswith(target_size):
            return m
    return None


def _select_model_by_vram(
    available_models: list[str],
    vram_mb: int,
    mode: str = "balance",
) -> str | None:
    """Select the best Ollama model based on GPU VRAM and speed/quality mode.

    Args:
        available_models: List of model names available in Ollama.
        vram_mb: GPU VRAM in MB (0 if no GPU).
        mode: One of "superschnell", "schnell", "balance", "qualitaet".

    Returns:
        Best matching model name from available_models, or None.
    """
    # Find the VRAM bracket
    bracket = None
    for lo, hi, modes in _MODEL_TABLE:
        if lo <= vram_mb < hi:
            bracket = modes
            break
    if bracket is None:
        bracket = _MODEL_TABLE[-1][2]  # Fall back to largest bracket

    # Try the requested mode, then fallback to other modes
    modes_to_try = [mode] + [m for m in _MODE_FALLBACK_ORDER if m != mode]
    for try_mode in modes_to_try:
        target = bracket.get(try_mode)
        if not target:
            continue
        matched = _match_model(target, available_models)
        if matched:
            logger.info("Model selected: %s (mode=%s, vram=%dMB, target=%s)", matched, try_mode, vram_mb, target)
            return matched

    # Last resort: first available model
    if available_models:
        logger.warning("No table match found – using first available: %s", available_models[0])
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

    On Windows: downloads OllamaSetup.exe and runs it silently.
    On Linux: downloads the ollama binary from GitHub releases to ~/.local/bin/
    and starts `ollama serve` in the background.

    Returns immediately. The frontend polls /api/onboarding/install-status.
    """
    if ONBOARDING_STATE.get("ollama_installing"):
        return {"status": "already_running"}

    async def _do_install_linux():
        """Install Ollama on Linux by downloading and extracting the tar.zst to ~/.local/."""
        ONBOARDING_STATE["ollama_installing"] = True
        ONBOARDING_STATE["ollama_install_error"] = None
        ONBOARDING_STATE["ollama_install_phase"] = "downloading"
        ONBOARDING_STATE["ollama_install_progress"] = 0
        try:
            # Target: ~/.local/ (no sudo needed, mirrors official install layout)
            local_dir = Path.home() / ".local"
            local_dir.mkdir(parents=True, exist_ok=True)
            tmp_archive = local_dir / "ollama-linux-amd64.tar.zst"

            # Download tar.zst with progress
            logger.info("Downloading Ollama tar.zst from %s", OLLAMA_LINUX_TGZ_URL)
            async with httpx.AsyncClient(follow_redirects=True, timeout=600.0) as client:
                async with client.stream("GET", OLLAMA_LINUX_TGZ_URL) as resp:
                    resp.raise_for_status()
                    total = int(resp.headers.get("content-length", 0))
                    downloaded = 0
                    with open(tmp_archive, "wb") as f:
                        async for chunk in resp.aiter_bytes(65536):
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total > 0:
                                ONBOARDING_STATE["ollama_install_progress"] = downloaded / total
                    ONBOARDING_STATE["ollama_install_progress"] = 1.0

            # Extract tar.zst
            ONBOARDING_STATE["ollama_install_phase"] = "installing"
            ONBOARDING_STATE["ollama_install_progress"] = 0.92
            logger.info("Extracting Ollama archive to %s", local_dir)
            process = await asyncio.create_subprocess_exec(
                "tar", "--zstd", "-xf", str(tmp_archive), "-C", str(local_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(process.wait(), timeout=120.0)

            # Cleanup archive
            try:
                tmp_archive.unlink(missing_ok=True)
            except Exception:
                pass

            ollama_bin = local_dir / "bin" / "ollama"
            if not ollama_bin.exists():
                raise FileNotFoundError(f"Ollama binary not found at {ollama_bin} after extraction")
            ollama_bin.chmod(0o755)
            logger.info("Ollama binary installed to %s", ollama_bin)

            # Build LD_LIBRARY_PATH for CUDA support
            ollama_lib = local_dir / "lib" / "ollama"
            cuda_v12 = ollama_lib / "cuda_v12"
            cuda_v13 = ollama_lib / "cuda_v13"
            ld_paths = []
            if cuda_v12.exists():
                ld_paths.append(str(cuda_v12))
            if cuda_v13.exists():
                ld_paths.append(str(cuda_v13))
            ld_paths.append(str(ollama_lib))
            ld_library_path = ":".join(ld_paths)

            # Start ollama serve in background with CUDA libs
            ONBOARDING_STATE["ollama_install_progress"] = 0.97

            # Check if ollama is already running
            ollama_running = False
            try:
                check = await httpx.AsyncClient().aget("http://127.0.0.1:11434/api/tags")
                if check.status_code == 200:
                    logger.info("Ollama already running")
                    ollama_running = True
            except Exception:
                pass

            if not ollama_running:
                logger.info("Starting ollama serve in background")
                env = os.environ.copy()
                env["LD_LIBRARY_PATH"] = ld_library_path + ":" + env.get("LD_LIBRARY_PATH", "")
                subprocess.Popen(
                    [str(ollama_bin), "serve"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                    env=env,
                )
                # Wait for ollama to be ready
                for _ in range(30):
                    await asyncio.sleep(1)
                    try:
                        check = await httpx.AsyncClient().aget("http://127.0.0.1:11434/api/tags")
                        if check.status_code == 200:
                            logger.info("Ollama is now running")
                            ollama_running = True
                            break
                    except Exception:
                        continue

            # Save LD_LIBRARY_PATH to a file so the backend can use it for model pulls
            env_file = Path.home() / ".config" / "Nox" / "ollama_env.sh"
            env_file.parent.mkdir(parents=True, exist_ok=True)
            env_file.write_text(f'export LD_LIBRARY_PATH="{ld_library_path}:$LD_LIBRARY_PATH"\nexport PATH="{local_dir}/bin:$PATH"\n')

            ONBOARDING_STATE["ollama_install_progress"] = 1.0
            ONBOARDING_STATE["ollama_install_phase"] = "done"
            logger.info("Ollama installation complete")

        except Exception as exc:
            logger.error("Ollama install failed: %s", exc, exc_info=True)
            ONBOARDING_STATE["ollama_install_error"] = str(exc)
        finally:
            ONBOARDING_STATE["ollama_installing"] = False

    async def _do_install_windows():
        """Install Ollama on Windows via OllamaSetup.exe."""
        ONBOARDING_STATE["ollama_installing"] = True
        ONBOARDING_STATE["ollama_install_error"] = None
        ONBOARDING_STATE["ollama_install_phase"] = "downloading"
        ONBOARDING_STATE["ollama_install_progress"] = 0
        try:
            tmp_dir = Path(tempfile.gettempdir())
            installer_path = tmp_dir / "OllamaSetup.exe"

            # Download
            logger.info("Downloading Ollama installer from %s", OLLAMA_INSTALLER_URL)
            async with httpx.AsyncClient(follow_redirects=True, timeout=300.0) as client:
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
                await asyncio.wait_for(process.wait(), timeout=120.0)
            except asyncio.TimeoutError:
                logger.warning("Ollama installer timed out after 120s")
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

    install_fn = _do_install_linux if IS_LINUX else _do_install_windows
    asyncio.create_task(install_fn())
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
# Heavy dependency installation (torch, easyocr, sentence-transformers)
# ---------------------------------------------------------------------------

def _get_embedded_python_exe() -> str:
    """Get the path to the embedded Python executable."""
    # In packaged mode: resources/backend/python/python.exe
    # In dev mode: system python
    base = Path(__file__).parent.parent
    candidates = [
        base / "python" / "python.exe",
        base / "dist-backend" / "python" / "python.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return sys.executable


def _get_embedded_python_dir() -> Path:
    """Get the directory of the embedded Python."""
    return Path(_get_embedded_python_exe()).parent


@app.post("/api/onboarding/install-deps")
async def install_heavy_deps(body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Install heavy Python dependencies (torch, easyocr, sentence-transformers).

    Body params:
      - cuda: bool — install CUDA torch instead of CPU torch

    Returns immediately. Frontend polls /api/onboarding/deps-status for progress.
    """
    if ONBOARDING_STATE.get("deps_installing"):
        return {"status": "already_running"}

    body = body or {}
    use_cuda = body.get("cuda", False)

    async def _do_install_deps():
        ONBOARDING_STATE["deps_installing"] = True
        ONBOARDING_STATE["deps_phase"] = "starting"
        ONBOARDING_STATE["deps_progress"] = 0
        ONBOARDING_STATE["deps_current_package"] = ""
        ONBOARDING_STATE["deps_error"] = None
        ONBOARDING_STATE["deps_log"] = []
        try:
            python_exe = _get_embedded_python_exe()
            python_dir = _get_embedded_python_dir()

            # Determine if CUDA should be used
            if not use_cuda:
                # Auto-detect NVIDIA GPU
                try:
                    result = subprocess.run(
                        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                        capture_output=True, text=True, timeout=5,
                    )
                    use_cuda_auto = result.returncode == 0 and result.stdout.strip()
                except Exception:
                    use_cuda_auto = False
            else:
                use_cuda_auto = True

            # Build command
            cmd = [python_exe, str(Path(__file__).parent / "install_heavy_deps.py")]
            if use_cuda_auto:
                cmd.append("--cuda")

            ONBOARDING_STATE["deps_phase"] = "installing"
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "PYTHONPATH": str(Path(__file__).parent)},
            )

            # Read stdout line by line (JSON progress lines)
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line_str = line.decode("utf-8", errors="replace").strip()
                if not line_str:
                    continue
                try:
                    data = json.loads(line_str)
                    phase = data.get("phase", "")
                    pkg = data.get("package", "")
                    if phase == "installing":
                        ONBOARDING_STATE["deps_current_package"] = pkg
                        ONBOARDING_STATE["deps_log"].append(f"Installing {pkg}...")
                    elif phase == "installed":
                        ONBOARDING_STATE["deps_log"].append(f"Installed {pkg}")
                    elif phase == "skip":
                        ONBOARDING_STATE["deps_log"].append(f"Skipped {pkg} (already installed)")
                    elif phase == "warning":
                        ONBOARDING_STATE["deps_log"].append(f"Warning: {data.get('message', '')}")
                    elif phase == "error":
                        ONBOARDING_STATE["deps_log"].append(f"Error: {data.get('message', '')}")
                    elif phase == "done":
                        ONBOARDING_STATE["deps_progress"] = 1.0
                except json.JSONDecodeError:
                    # Non-JSON output, add to log
                    ONBOARDING_STATE["deps_log"].append(line_str)

            await process.wait()
            if process.returncode == 0:
                ONBOARDING_STATE["deps_phase"] = "done"
                ONBOARDING_STATE["deps_progress"] = 1.0
                logger.info("Heavy deps installation complete")
            else:
                ONBOARDING_STATE["deps_phase"] = "error"
                stderr_data = await process.stderr.read()
                ONBOARDING_STATE["deps_error"] = stderr_data.decode("utf-8", errors="replace")[-500:]
                logger.error("Heavy deps installation failed: %s", ONBOARDING_STATE["deps_error"])

        except Exception as exc:
            logger.error("Heavy deps install failed: %s", exc, exc_info=True)
            ONBOARDING_STATE["deps_error"] = str(exc)
            ONBOARDING_STATE["deps_phase"] = "error"
        finally:
            ONBOARDING_STATE["deps_installing"] = False

    asyncio.create_task(_do_install_deps())
    return {"status": "started"}


@app.get("/api/onboarding/deps-status")
async def deps_status() -> dict[str, Any]:
    """Poll heavy dependency installation progress."""
    return {
        "status": "ok",
        "installing": ONBOARDING_STATE.get("deps_installing", False),
        "phase": ONBOARDING_STATE.get("deps_phase", "idle"),
        "progress": ONBOARDING_STATE.get("deps_progress", 0),
        "current_package": ONBOARDING_STATE.get("deps_current_package", ""),
        "error": ONBOARDING_STATE.get("deps_error"),
        "log": ONBOARDING_STATE.get("deps_log", []),
    }


@app.get("/api/onboarding/deps-check")
async def deps_check() -> dict[str, Any]:
    """Check which heavy dependencies are already installed."""
    python_exe = _get_embedded_python_exe()
    result = {}
    for pkg_name, import_name in [
        ("torch", "torch"),
        ("easyocr", "easyocr"),
        ("sentence-transformers", "sentence_transformers"),
    ]:
        try:
            r = subprocess.run(
                [python_exe, "-c", f"import {import_name}; print('ok')"],
                capture_output=True, text=True, timeout=10,
            )
            result[pkg_name] = r.returncode == 0 and "ok" in r.stdout
        except Exception:
            result[pkg_name] = False

    # Check NVIDIA GPU
    has_nvidia = False
    gpu_name = ""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            has_nvidia = True
            gpu_name = r.stdout.strip().splitlines()[0]
    except Exception:
        pass

    return {
        "status": "ok",
        "installed": result,
        "has_nvidia": has_nvidia,
        "gpu_name": gpu_name,
    }


# ---------------------------------------------------------------------------
# Voice catalog endpoints – TTS engine selection (Kokoro, Edge)
# ---------------------------------------------------------------------------

try:
    from voice.voice_catalog import (
        get_sample_sentence,
        detect_system_language,
        get_default_voice,
        get_default_male_voice,
        SAMPLE_SENTENCES,
    )
    from voice.supported_languages import SUPPORTED_LANGUAGES, get_supported_languages
    from voice.tts_edge import (
        _EDGE_AVAILABLE,
        edge_tts_to_wav,
    )
    _VOICE_CATALOG_AVAILABLE = True
except Exception as exc:
    logger.warning("Voice catalog unavailable: %s", exc)
    _VOICE_CATALOG_AVAILABLE = False
    get_sample_sentence = lambda lang="en": "Hello, this is a test."
    detect_system_language = lambda: "en"
    get_default_voice = lambda lang="en": "default"
    get_default_male_voice = lambda lang="en": "default"
    SAMPLE_SENTENCES = {"en": "Hello, this is a test."}
    SUPPORTED_LANGUAGES = {}
    get_supported_languages = lambda: []
    _EDGE_AVAILABLE = False
    edge_tts_to_wav = None
try:
    from voice.tts_kokoro import (
        is_kokoro_available,
        get_kokoro_lang_code,
        get_kokoro_voices_for_lang,
        kokoro_to_wav,
        KOKORO_LANGUAGES,
    )
except Exception:
    is_kokoro_available = lambda: False
    get_kokoro_lang_code = lambda lang: "en"
    get_kokoro_voices_for_lang = lambda lang: []
    kokoro_to_wav = None
    KOKORO_LANGUAGES = {}


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
    from voice.tts_edge import EDGE_VOICES_BY_LANG

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
    from voice.tts_edge import EDGE_VOICES_BY_LANG

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
    loop = asyncio.get_running_loop()
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
async def test_wake_word_start(body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Start wake word listener for onboarding calibration test.

    Uses the current audio_input_device from settings or request body.
    Sets a pollable counter when wake word is detected.
    """
    if not voice_manager or not voice_manager.wake_word.is_available:
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

    return {"status": "ok", "model": config.get("wake_word_model", "hey_nox.onnx")}


@app.get("/api/onboarding/wake-status")
async def wake_status() -> dict[str, Any]:
    """Poll wake word detection count for onboarding."""
    return {"status": "ok", "count": getattr(app.state, "wake_detected_count", 0)}


@app.post("/api/onboarding/stop-wake-word-test")
async def test_wake_word_stop() -> dict[str, Any]:
    """Stop wake word listener after onboarding calibration test."""
    if voice_manager:
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
            except RuntimeError as runtime_exc:
                # WebSocket is not connected anymore — stop the loop
                logger.info("WebSocket disconnected: %s", runtime_exc)
                break
            except Exception as json_exc:
                # Invalid JSON from client — log and skip, don't disconnect
                logger.warning("Invalid JSON from WebSocket client: %s", json_exc)
                continue

            # Manual voice trigger from UI mic button
            if data.get("type") == "voice_trigger":
                logger.info("Manual voice trigger received")
                # Run the wake callback path (record + transcribe)
                try:
                    if voice_manager:
                        voice_manager._on_wake_detected(from_wake_word=False)
                except Exception as exc:
                    logger.error("voice_trigger failed: %s", exc, exc_info=True)
                    await manager.broadcast({"type": "voice_event", "state": "idle"})
                continue

            # Abort / stop generation
            if data.get("type") == "abort":
                logger.info("Abort requested by client")
                orchestrator.abort()
                if voice_manager:
                    voice_manager.stop_speaking()
                await manager.broadcast({"type": "aborted"})
                continue

            message: str = data.get("message", "")
            context: Optional[str] = data.get("context")
            voice_input: bool = data.get("voice_input", False)
            think_override: Optional[bool] = data.get("think")

            if not message:
                await websocket.send_json({"type": "error", "content": "Empty message"})
                continue

            try:
                async def _send_to_client(msg):
                    await manager.broadcast(msg)
                await orchestrator.process_message(
                    message,
                    voice_input=voice_input,
                    context_override=context,
                    send=_send_to_client,
                    think_override=think_override,
                )
            except Exception as exc:
                logger.error("Orchestrator error: %s", exc, exc_info=True)
                await manager.broadcast({"type": "error", "content": f"Interner Fehler: {exc}"})
                await manager.broadcast({"type": "done"})

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
