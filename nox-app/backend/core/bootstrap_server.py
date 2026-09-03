#!/usr/bin/env python3
"""Minimal bootstrap server for dependency installation.

This runs BEFORE any pip packages are installed. It uses only the Python
standard library (http.server) to provide endpoints for:
  - Checking if deps are installed
  - Starting the install_all_deps.py process
  - Polling install progress

Once deps are installed, the main FastAPI backend can be started.
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse


# State shared between handler and install thread
INSTALL_STATE = {
    "phase": "idle",  # idle, installing, done, error
    "progress": 0,
    "current_package": "",
    "current_index": 0,
    "total_packages": 0,
    "speed_mbs": 0,
    "eta_s": 0,
    "elapsed_s": 0,
    "log": [],
    "error": None,
    "has_nvidia": False,
    "cuda": False,
    "installing": False,
    "post_install_task": "",
    "total_estimate_mb": 0,
}

INSTALL_PROCESS = None
INSTALL_THREAD = None


def get_backend_dir():
    """Get the backend app directory."""
    base = Path(__file__).parent
    # In packaged mode: resources/backend/app/
    # In dev mode: backend/core/  (main.py is in core/)
    candidates = [
        base / "app",
        base,
        base.parent,  # backend/ (dev mode — main.py in core/)
    ]
    for c in candidates:
        if (c / "main.py").exists() or (c / "core" / "main.py").exists():
            return c
    return base.parent


def get_python_exe():
    """Get the Python executable — system python3 on Linux, embedded on Windows."""
    base = Path(__file__).parent
    if sys.platform.startswith("linux"):
        return sys.executable
    # Windows: embedded Python
    candidates = [
        base / "python" / "python.exe",
        base / ".." / "python" / "python.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c.resolve())
    return sys.executable


def check_deps_installed():
    """Check if core deps are installed by trying to import fastapi."""
    python_exe = get_python_exe()
    try:
        result = subprocess.run(
            [python_exe, "-c", "import fastapi; import uvicorn; import numpy; print('ok')"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0 and "ok" in result.stdout
    except Exception:
        return False


def check_nvidia():
    """Check for NVIDIA GPU."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return True, result.stdout.strip().splitlines()[0]
    except Exception:
        pass
    return False, ""


def run_install(cuda=False):
    """Run install_all_deps.py in a subprocess and parse progress."""
    global INSTALL_PROCESS

    python_exe = get_python_exe()
    backend_dir = get_backend_dir()
    install_script = str(backend_dir / "build" / "install_all_deps.py")
    if not Path(install_script).exists():
        install_script = str(backend_dir / "install_all_deps.py")  # packaged mode fallback

    cmd = [python_exe, install_script]
    if cuda:
        cmd.append("--cuda")

    INSTALL_STATE["installing"] = True
    INSTALL_STATE["phase"] = "installing"
    INSTALL_STATE["log"] = []
    INSTALL_STATE["error"] = None
    INSTALL_STATE["progress"] = 0

    try:
        INSTALL_PROCESS = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "PYTHONPATH": str(backend_dir)},
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )

        for line in INSTALL_PROCESS.stdout:
            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str:
                continue
            try:
                data = json.loads(line_str)
                phase = data.get("phase", "")

                if phase == "starting":
                    INSTALL_STATE["total_packages"] = data.get("total_packages", 0)
                    INSTALL_STATE["total_estimate_mb"] = data.get("total_estimate_mb", 0)
                    INSTALL_STATE["cuda"] = data.get("cuda", False)
                    INSTALL_STATE["log"].append(f"Starting installation of {data.get('total_packages', 0)} packages...")
                elif phase == "package_start":
                    idx = data.get("index", 0)
                    pkg = data.get("package", "")
                    INSTALL_STATE["current_package"] = pkg
                    INSTALL_STATE["current_index"] = idx
                    INSTALL_STATE["log"].append(f"[{idx + 1}/{data.get('total', '?')}] Installing {pkg}...")
                elif phase == "package_done":
                    pkg = data.get("package", "")
                    dur = data.get("duration_s", 0)
                    INSTALL_STATE["log"].append(f"  ✓ {pkg} ({dur}s)")
                elif phase == "package_skip":
                    pkg = data.get("package", "")
                    INSTALL_STATE["log"].append(f"  ⊘ {pkg} (already installed)")
                elif phase == "package_failed":
                    pkg = data.get("package", "")
                    req = data.get("required", False)
                    tag = "✗ REQUIRED" if req else "✗ optional"
                    INSTALL_STATE["log"].append(f"  {tag} {pkg}")
                elif phase == "progress":
                    INSTALL_STATE["progress"] = data.get("overall_pct", 0)
                    INSTALL_STATE["speed_mbs"] = data.get("speed_mbs", 0)
                    INSTALL_STATE["eta_s"] = data.get("eta_s", 0)
                    INSTALL_STATE["elapsed_s"] = data.get("elapsed_s", 0)
                elif phase == "post_install":
                    task = data.get("task", "")
                    INSTALL_STATE["post_install_task"] = task
                    INSTALL_STATE["log"].append(f"Post-install: {task}...")
                elif phase == "post_install_done":
                    task = data.get("task", "")
                    ok = data.get("success", False)
                    tag = "✓" if ok else "✗"
                    INSTALL_STATE["log"].append(f"  {tag} {task}")
                elif phase == "done":
                    INSTALL_STATE["progress"] = 100
                    if data.get("success"):
                        INSTALL_STATE["phase"] = "done"
                        INSTALL_STATE["log"].append(f"Installation complete in {data.get('total_duration_s', 0)}s")
                    else:
                        INSTALL_STATE["phase"] = "error"
                        failed = data.get("failed_required", [])
                        INSTALL_STATE["error"] = f"Failed required packages: {', '.join(failed)}"
                        INSTALL_STATE["log"].append(f"Installation failed: {INSTALL_STATE['error']}")
                elif phase == "info":
                    INSTALL_STATE["log"].append(data.get("message", ""))
            except json.JSONDecodeError:
                INSTALL_STATE["log"].append(line_str)

        INSTALL_PROCESS.wait()
        if INSTALL_PROCESS.returncode != 0 and INSTALL_STATE["phase"] != "done":
            stderr_data = INSTALL_PROCESS.stderr.read().decode("utf-8", errors="replace")[-500:]
            INSTALL_STATE["phase"] = "error"
            INSTALL_STATE["error"] = stderr_data
            INSTALL_STATE["log"].append(f"Process exited with code {INSTALL_PROCESS.returncode}")

    except Exception as exc:
        INSTALL_STATE["phase"] = "error"
        INSTALL_STATE["error"] = str(exc)
        INSTALL_STATE["log"].append(f"Error: {exc}")
    finally:
        INSTALL_STATE["installing"] = False


class BootstrapHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def _send_json(self, data, code=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/bootstrap/status":
            self._send_json({
                "status": "ok",
                "deps_installed": check_deps_installed(),
                "has_nvidia": INSTALL_STATE.get("has_nvidia", False),
                "gpu_name": INSTALL_STATE.get("gpu_name", ""),
                "installing": INSTALL_STATE.get("installing", False),
                "phase": INSTALL_STATE.get("phase", "idle"),
                "progress": INSTALL_STATE.get("progress", 0),
                "current_package": INSTALL_STATE.get("current_package", ""),
                "current_index": INSTALL_STATE.get("current_index", 0),
                "total_packages": INSTALL_STATE.get("total_packages", 0),
                "speed_mbs": INSTALL_STATE.get("speed_mbs", 0),
                "eta_s": INSTALL_STATE.get("eta_s", 0),
                "elapsed_s": INSTALL_STATE.get("elapsed_s", 0),
                "total_estimate_mb": INSTALL_STATE.get("total_estimate_mb", 0),
                "post_install_task": INSTALL_STATE.get("post_install_task", ""),
                "log": INSTALL_STATE.get("log", [])[-20:],
                "error": INSTALL_STATE.get("error"),
            })
        elif path == "/api/bootstrap/health":
            self._send_json({"status": "ok"})
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        global INSTALL_THREAD
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/bootstrap/install":
            if INSTALL_STATE.get("installing"):
                self._send_json({"status": "already_running"})
                return

            body = self._read_body()
            cuda = body.get("cuda", False)

            # Auto-detect NVIDIA if not specified
            if not cuda:
                has_nvidia, gpu_name = check_nvidia()
                INSTALL_STATE["has_nvidia"] = has_nvidia
                INSTALL_STATE["gpu_name"] = gpu_name
                cuda = has_nvidia
            else:
                INSTALL_STATE["has_nvidia"] = True

            INSTALL_THREAD = threading.Thread(target=run_install, args=(cuda,), daemon=True)
            INSTALL_THREAD.start()
            self._send_json({"status": "started", "cuda": cuda})
        else:
            self._send_json({"error": "not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    port = 8421  # Bootstrap port (main backend uses 8420)

    # Check NVIDIA on startup
    has_nvidia, gpu_name = check_nvidia()
    INSTALL_STATE["has_nvidia"] = has_nvidia
    INSTALL_STATE["gpu_name"] = gpu_name

    deps_ok = check_deps_installed()
    print(f"Bootstrap server on port {port}")
    print(f"  Deps installed: {deps_ok}")
    print(f"  NVIDIA: {has_nvidia} ({gpu_name})")

    server = HTTPServer(("127.0.0.1", port), BootstrapHandler)
    print(f"  Listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
