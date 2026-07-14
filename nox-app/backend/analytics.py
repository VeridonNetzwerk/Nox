"""Analytics module — sends anonymous usage events to Supabase.

Events are sent fire-and-forget in a background thread via a secure RPC
function that validates a secret token. Direct table inserts are blocked
by Row Level Security — only the RPC can insert.

No user content, no IP addresses, no personally identifiable information.
Only metadata: event type, app version, OS, locale (-> country), session ID, error code.
"""

import logging
import os
import platform
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger("nox.analytics")

_APP_VERSION = "0.5.0"
_SESSION_ID = str(uuid.uuid4())


def _get_install_id() -> str:
    """Load or create a persistent installation ID.

    This ID is generated once and stored in %APPDATA%/Nox/data/install_id.txt.
    It survives restarts so the same machine is always counted as the same user.
    """
    data_dir = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Nox" / "data"
    id_file = data_dir / "install_id.txt"
    try:
        if id_file.exists():
            existing = id_file.read_text(encoding="utf-8").strip()
            if existing:
                return existing
        data_dir.mkdir(parents=True, exist_ok=True)
        new_id = str(uuid.uuid4())
        id_file.write_text(new_id, encoding="utf-8")
        logger.info("Generated new install_id: %s", new_id)
        return new_id
    except Exception as exc:
        logger.warning("Failed to persist install_id: %s", exc)
        return str(uuid.uuid4())


_INSTALL_ID = _get_install_id()

# Hardcoded analytics defaults — shipped with every build so all users
# automatically send anonymous analytics without configuring anything.
# The anon key is safe to expose (can only call the RPC, not read data).
# config.yaml values override these if explicitly set.
_DEFAULT_SUPABASE_URL = "https://acugloniykbnitkkgujw.supabase.co"
_DEFAULT_SUPABASE_KEY = "sb_publishable_VhLz5VeRXKiWJBUu5eMUBg_PwyM6wEs"
_DEFAULT_ANALYTICS_TOKEN = "vuj2-cxexKlGQnrQs-LUpa1f4s7XNosizx4N21eqmW4"

# Event queue — processed in background
_event_queue: list[dict[str, Any]] = []
_lock = threading.Lock()
_worker_started = False
_supabase_url = ""
_supabase_key = ""
_analytics_token = ""


def _worker():
    """Background worker that sends events to Supabase via RPC."""
    while True:
        batch = []
        with _lock:
            while _event_queue:
                batch.append(_event_queue.pop(0))
        if not batch:
            time.sleep(5)
            continue
        try:
            url = f"{_supabase_url}/rest/v1/rpc/insert_nox_events"
            headers = {
                "apikey": _supabase_key,
                "Authorization": f"Bearer {_supabase_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "p_token": _analytics_token,
                "p_events": batch,
            }
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            if resp.status_code not in (200, 201):
                logger.debug("Analytics RPC failed: %s %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            logger.debug("Analytics send error: %s", exc)
        time.sleep(1)


def _ensure_worker(config: dict[str, Any]):
    """Start the background worker if not already running."""
    global _worker_started, _supabase_url, _supabase_key, _analytics_token
    if _worker_started:
        return
    url = config.get("analytics_supabase_url", "") or _DEFAULT_SUPABASE_URL
    key = config.get("analytics_supabase_key", "") or _DEFAULT_SUPABASE_KEY
    token = config.get("analytics_token", "") or _DEFAULT_ANALYTICS_TOKEN
    _supabase_url = url
    _supabase_key = key
    _analytics_token = token
    _worker_started = True
    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def _enqueue(
    event_type: str,
    config: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    error_code: str | None = None,
):
    """Queue an event for sending."""
    if not config.get("analytics_enabled", False):
        return
    _ensure_worker(config)
    event = {
        "event_type": event_type,
        "app_version": _APP_VERSION,
        "os": platform.system() + " " + platform.release(),
        "locale": config.get("system_language", ""),
        "session_id": _SESSION_ID,
        "install_id": _INSTALL_ID,
        "error_code": error_code,
        "metadata": metadata or {},
    }
    with _lock:
        _event_queue.append(event)


# ---------------------------------------------------------------------------
# Public API — call these from the app
# ---------------------------------------------------------------------------

def track_app_start(config: dict[str, Any]):
    _enqueue("app_start", config, {
        "tts_engine": config.get("tts_engine", ""),
        "stt_model": config.get("stt_model", ""),
        "ollama_model": config.get("ollama_model", ""),
        "wake_word_enabled": config.get("wake_word_enabled", False),
        "eye_enabled": config.get("nox_eye_enabled", False),
        "files_enabled": config.get("nox_files_enabled", False),
    })


def track_app_close(config: dict[str, Any]):
    _enqueue("app_close", config)


def track_voice_interaction(config: dict[str, Any], duration_s: float):
    _enqueue("voice_interaction", config, {"duration_s": round(duration_s, 1)})


def track_tool_use(config: dict[str, Any], tool_name: str, success: bool):
    _enqueue("tool_use", config, {"tool": tool_name, "success": success})


def track_onboarding_complete(config: dict[str, Any]):
    _enqueue("onboarding_complete", config)


def track_error(config: dict[str, Any], error_code: str):
    """Track an error event with its error code (e.g. E001, E002)."""
    _enqueue("error", config, {"error_code": error_code}, error_code=error_code)
