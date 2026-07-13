#!/usr/bin/env python3
"""Build script: prepares a self-contained backend distribution.

Strategy: Embedded Python + pre-installed packages (NOT PyInstaller).
PyInstaller is unreliable with PyTorch/CUDA, ctranslate2, and onnxruntime
due to complex DLL dependency chains. Instead we use the official Python
embeddable distribution + a virtual environment with all pip packages.

This script:
1. Downloads Python embeddable ZIP from python.org (if not cached)
2. Extracts it to dist-backend/python/
3. Bootstraps pip into the embedded Python
4. Installs all requirements from requirements.txt
5. Copies backend source code + config + models dir
6. Creates launcher.bat that runs nox-backend via embedded Python

Usage:
    python build_backend.py [--python-version 3.11.9]

Output: dist-backend/ directory ready for electron-builder extraResources.
"""

import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
DIST_DIR = BACKEND_DIR / "dist-backend"
PYTHON_VERSION = "3.11.9"
PYTHON_EMBED_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
CACHE_DIR = BACKEND_DIR / ".build-cache"


def download(url: str, dest: Path) -> None:
    """Download a file with progress indication."""
    if dest.exists():
        print(f"  Cached: {dest.name}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading {url}...")
    urllib.request.urlretrieve(url, str(dest))
    print(f"  Saved to {dest}")


def prepare_embedded_python(python_version: str) -> Path:
    """Download and extract embedded Python, bootstrap pip, add dev headers."""
    url = f"https://www.python.org/ftp/python/{python_version}/python-{python_version}-embed-amd64.zip"
    zip_path = CACHE_DIR / f"python-{python_version}-embed-amd64.zip"
    python_dir = DIST_DIR / "python"

    if python_dir.exists() and (python_dir / "python.exe").exists():
        print(f"  Embedded Python already at {python_dir}")
        return python_dir

    download(url, zip_path)

    print(f"  Extracting to {python_dir}...")
    python_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(python_dir)

    # Download dev headers (include/ and libs/) from NuGet package
    # The embeddable zip doesn't include these, but they're needed to build
    # C extensions like webrtcvad-wheels
    nuget_url = f"https://www.nuget.org/api/v2/package/python/{python_version}"
    nuget_path = CACHE_DIR / f"python-{python_version}-nuget.zip"
    print(f"  Downloading Python dev headers (NuGet)...")
    download(nuget_url, nuget_path)
    with zipfile.ZipFile(nuget_path) as zf:
        for member in zf.namelist():
            # NuGet package stores headers under tools/include/ and tools/libs/
            # We need them at include/ and libs/ in the embedded Python dir
            if member.startswith("tools/include/"):
                rel = member[len("tools/")]
                target = python_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    dst.write(src.read())
            elif member.startswith("tools/libs/"):
                rel = member[len("tools/")]
                target = python_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    dst.write(src.read())
        print(f"  Extracted dev headers to {python_dir / 'include'} and {python_dir / 'libs'}")

    # Enable pip: uncomment 'import site' in pythonXX._pth
    pth_files = list(python_dir.glob("python*._pth"))
    for pth in pth_files:
        content = pth.read_text(encoding="utf-8")
        content = content.replace("#import site", "import site")
        # Add Lib\site-packages for pip installs
        if "Lib/site-packages" not in content:
            content += "\nLib/site-packages\n"
        pth.write_text(content, encoding="utf-8")
        print(f"  Patched {pth.name}")

    # Bootstrap pip via get-pip.py
    get_pip = CACHE_DIR / "get-pip.py"
    download("https://bootstrap.pypa.io/get-pip.py", get_pip)
    print("  Bootstrapping pip...")
    subprocess.run(
        [str(python_dir / "python.exe"), str(get_pip), "--no-warn-script-location"],
        check=True,
        cwd=str(python_dir),
    )

    return python_dir


def install_torch_cuda(python_exe: str) -> None:
    """Install CPU-only PyTorch.

    CUDA-enabled PyTorch is ~2.8GB, too large for the NSIS installer.
    Instead, we ship CPU torch and upgrade to CUDA at runtime via
    cuda-upgrade.js if an NVIDIA GPU is detected.
    """
    print("  Installing CPU PyTorch (CUDA upgrade handled at runtime)...")
    result = subprocess.run(
        [
            python_exe, "-m", "pip", "install",
            "torch", "torchvision",
            "--index-url", "https://download.pytorch.org/whl/cpu",
            "--no-warn-script-location",
        ],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("  CPU PyTorch installed successfully")
    else:
        print(f"  WARNING: CPU PyTorch install failed")
        print(f"  Error: {result.stderr[-300:]}")


def install_requirements(python_exe: str) -> None:
    """Install all requirements into the embedded Python.

    Installs CUDA-enabled PyTorch first, then the rest of the requirements.
    Tries full install first. If it fails (e.g. C extension build issues),
    retries without optional packages (webrtcvad, easyocr) which are
    handled gracefully at runtime via try/except imports.
    """
    # Install CUDA PyTorch first (before requirements.txt which has CPU torch)
    install_torch_cuda(python_exe)

    req_file = BACKEND_DIR / "requirements.txt"
    print(f"  Installing requirements from {req_file}...")

    # Install requirements but exclude torch/torchvision (already installed with CUDA)
    result = subprocess.run(
        [
            python_exe, "-m", "pip", "install",
            "-r", str(req_file),
            "--no-warn-script-location",
            "--no-cache-dir",
        ],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("  All requirements installed successfully")
        return

    # Print the error for diagnostics
    print(f"  Full install failed, retrying without optional packages...")
    print(f"  Error: {result.stderr[-500:]}")

    # Second attempt: install core packages one by one, skip failures
    # Note: torch/torchvision already installed with CUDA above
    core_packages = [
        "fastapi==0.115.6",
        "uvicorn[standard]==0.34.0",
        "websockets==14.1",
        "pyyaml==6.0.2",
        "httpx==0.28.1",
        "openwakeword==0.6.0",
        "onnxruntime>=1.17.0",
        "sounddevice==0.5.1",
        "numpy>=1.26.0",
        "faster-whisper==1.1.0",
        "pywin32>=306",
        "uiautomation>=2.0.20",
        "psutil>=5.9.0",
        "Pillow>=10.0.0",
        "sentence-transformers>=2.7.0",
        "SoundCard>=0.4.6",
        "shazamio>=0.7.0",
        "pytest>=8.0.0",
    ]
    optional_packages = [
        "webrtcvad-wheels==2.0.10.post2",
        "easyocr>=1.7.1",
    ]

    failed = []
    for pkg in core_packages:
        print(f"  [install] {pkg}")
        r = subprocess.run(
            [python_exe, "-m", "pip", "install", pkg,
             "--no-warn-script-location", "--no-cache-dir"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"  [FAILED] {pkg}: {r.stderr[-200:]}")
            failed.append(pkg)

    for pkg in optional_packages:
        print(f"  [install-optional] {pkg}")
        r = subprocess.run(
            [python_exe, "-m", "pip", "install", pkg,
             "--no-warn-script-location", "--no-cache-dir",
             "--only-binary", ":all:"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"  [SKIPPED] {pkg} (optional, code handles ImportError)")
            failed.append(pkg)

    if failed:
        print(f"\n  Warning: {len(failed)} package(s) failed to install:")
        for f in failed:
            print(f"    - {f}")
        print("  These are optional and handled at runtime via try/except imports.")


def install_piper_tts(python_exe: str) -> None:
    """Install Piper TTS separately.

    piper-phonemize (a dependency of piper-tts) has no Windows wheels on PyPI
    for Python 3.11. We try multiple strategies:
    1. piper1-gpl (the GPL fork, may have better Windows support)
    2. piper-tts with --no-deps + manually install piper-phonemize from GitHub
    3. Skip gracefully – TTS is optional, code handles ImportError
    """
    print("  Attempting Piper TTS installation...")

    # Strategy 1: Try piper1-gpl (may have pre-built wheels)
    try:
        print("  [try] piper1-gpl...")
        result = subprocess.run(
            [python_exe, "-m", "pip", "install", "piper1-gpl",
             "--no-warn-script-location", "--no-cache-dir"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            print("  [ok] piper1-gpl installed")
            return
        print(f"  [skip] piper1-gpl failed: {result.stderr[:200]}")
    except Exception as exc:
        print(f"  [skip] piper1-gpl exception: {exc}")

    # Strategy 2: piper-phonemize from HuggingFace wheels + piper-tts --no-deps
    try:
        print("  [try] piper-phonemize (HuggingFace wheel) + piper-tts --no-deps...")
        phonemize_url = (
            "https://huggingface.co/csukuangfj/piper-phonemize-wheels/resolve/main/"
            "piper_phonemize-1.3.0-cp311-cp311-win_amd64.whl"
        )
        result = subprocess.run(
            [python_exe, "-m", "pip", "install", phonemize_url,
             "--no-warn-script-location", "--no-cache-dir"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            print("  [ok] piper-phonemize installed from HuggingFace")
            # Now install piper-tts with --no-deps (phonemize already installed)
            result2 = subprocess.run(
                [python_exe, "-m", "pip", "install", "piper-tts==1.2.0",
                 "--no-deps", "--no-warn-script-location", "--no-cache-dir"],
                capture_output=True, text=True, timeout=120,
            )
            if result2.returncode == 0:
                print("  [ok] piper-tts installed")
                # Fix: piper-tts 1.2.0 imports tashkeel_run from piper_phonemize,
                # but piper_phonemize 1.3.0 doesn't have it. Patch voice.py to
                # make the import optional (only needed for Arabic).
                voice_py = DIST_DIR / "python" / "Lib" / "site-packages" / "piper" / "voice.py"
                if voice_py.exists():
                    content = voice_py.read_text(encoding="utf-8")
                    old = "from piper_phonemize import phonemize_codepoints, phonemize_espeak, tashkeel_run"
                    new = (
                        "from piper_phonemize import phonemize_codepoints, phonemize_espeak\n"
                        "try:\n"
                        "    from piper_phonemize import tashkeel_run\n"
                        "except ImportError:\n"
                        "    tashkeel_run = None"
                    )
                    if old in content:
                        voice_py.write_text(content.replace(old, new), encoding="utf-8")
                        print("  [ok] Patched piper voice.py (tashkeel_run import)")
                return
            print(f"  [skip] piper-tts --no-deps failed: {result2.stderr[:200]}")
        else:
            print(f"  [skip] piper-phonemize wheel failed: {result.stderr[:200]}")
    except Exception as exc:
        print(f"  [skip] piper-phonemize exception: {exc}")

    # Strategy 3: Skip – TTS is optional
    print("  [warning] Piper TTS could not be installed.")
    print("  TTS will be disabled – text chat and STT still work.")
    print("  To enable TTS manually, install piper-phonemize from:")
    print("  https://github.com/rhasspy/piper-phonemize/releases")


def copy_backend_source() -> None:
    """Copy backend source code to dist-backend/app/."""
    app_dir = DIST_DIR / "app"
    if app_dir.exists():
        shutil.rmtree(app_dir)
    app_dir.mkdir(parents=True)

    # Copy Python modules
    for item in ["main.py", "config.yaml", "settings_manager.py", "autostart.py",
                 "nox_voice", "nox_eye", "nox_files", "orchestrator"]:
        src = BACKEND_DIR / item
        if src.exists():
            if src.is_dir():
                shutil.copytree(src, app_dir / item,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            else:
                shutil.copy2(src, app_dir / item)

    # Note: models/ directory is handled by copy_small_assets() separately

    # Copy shared config schema
    shared_src = BACKEND_DIR.parent / "shared"
    shared_dst = DIST_DIR / "shared"
    if shared_dst.exists():
        shutil.rmtree(shared_dst)
    if shared_src.exists():
        shutil.copytree(shared_src, shared_dst)


def copy_small_assets() -> None:
    """Copy small assets (wake word ONNX, Piper voice) into dist-backend/models/.

    These are bundled with the installer (few MB). Large assets like
    Whisper models and Ollama models are downloaded via the onboarding wizard.
    """
    models_dst = DIST_DIR / "models"
    models_dst.mkdir(parents=True, exist_ok=True)

    # Wake word model – check both .tflite (openWakeWord native) and .onnx
    project_models = BACKEND_DIR.parent / "models"
    wake_tflite = project_models / "hey_nox.tflite"
    wake_onnx = project_models / "hey_nox.onnx"
    if wake_tflite.exists():
        shutil.copy2(wake_tflite, models_dst / "hey_nox.tflite")
        print(f"  Copied wake word model: {wake_tflite.name} ({wake_tflite.stat().st_size} bytes)")
    elif wake_onnx.exists():
        shutil.copy2(wake_onnx, models_dst / "hey_nox.onnx")
        print(f"  Copied wake word model: {wake_onnx.name} ({wake_onnx.stat().st_size} bytes)")
    else:
        print(f"  [warning] Wake word model not found in {project_models}")
        print(f"  Run 'python models/download_models.py' first to fetch placeholder models.")

    # Piper voice models
    piper_src = project_models / "piper-models"
    piper_dst = models_dst / "piper-models"
    if piper_src.exists() and any(piper_src.iterdir()):
        if piper_dst.exists():
            shutil.rmtree(piper_dst)
        shutil.copytree(piper_src, piper_dst)
        total = sum(f.stat().st_size for f in piper_dst.rglob("*") if f.is_file())
        print(f"  Copied Piper voice models: {total} bytes")
    else:
        print(f"  [warning] Piper voice models not found at {piper_src}")
        print(f"  Download a German voice from https://github.com/rhasspy/piper1-gpl/tree/main/VOICES")
        print(f"  Place .onnx and .onnx.json files in models/piper-models/")

    # Copy download_models.py for reference
    dl_script = project_models / "download_models.py"
    if dl_script.exists():
        shutil.copy2(dl_script, models_dst / "download_models.py")

    # Copy .gitkeep
    gitkeep = project_models / ".gitkeep"
    if gitkeep.exists():
        shutil.copy2(gitkeep, models_dst / ".gitkeep")


def create_launcher(python_dir: Path) -> None:
    """Create launcher.bat that starts the backend via embedded Python."""
    launcher_path = DIST_DIR / "nox-backend.bat"
    python_exe = "python\\python.exe"
    app_dir = "app"

    launcher_content = f"""@echo off
setlocal
set PYTHONPATH=%~dp0{app_dir};%~dp0shared
set APPDATA_OVERRIDE=%APPDATA%
"%~dp0{python_exe}" -m uvicorn main:app --host 127.0.0.1 --port 8420 --app-dir "%~dp0{app_dir}"
endlocal
"""
    launcher_path.write_text(launcher_content, encoding="utf-8")
    print(f"  Created launcher: {launcher_path}")

    # Also create a simple .exe wrapper placeholder (we use .bat for now,
    # electron can spawn .bat files directly)
    exe_stub = DIST_DIR / "nox-backend.exe"
    # Create a minimal C# wrapper that launches the bat silently
    cs_content = '''// Minimal launcher: runs nox-backend.bat without console window
using System.Diagnostics;
class LaunchNox {
    static void Main() {
        var psi = new ProcessStartInfo {
            FileName = "nox-backend.bat",
            WorkingDirectory = System.AppDomain.CurrentDomain.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        Process.Start(psi);
    }
}
'''
    cs_path = DIST_DIR / "nox-backend.cs"
    cs_path.write_text(cs_content, encoding="utf-8")
    print(f"  Created C# launcher stub: {cs_path}")
    print("  NOTE: Compile with: csc /out:nox-backend.exe nox-backend.cs")
    print("  Or use the .bat directly (electron spawns it with windowsHide:true)")


def main():
    parser = argparse.ArgumentParser(description="Build self-contained Nox backend")
    parser.add_argument("--python-version", default=PYTHON_VERSION,
                        help=f"Python embeddable version (default: {PYTHON_VERSION})")
    parser.add_argument("--skip-install", action="store_true",
                        help="Skip pip install (for debugging)")
    args = parser.parse_args()

    print("=" * 60)
    print("Nox Backend Build – Embedded Python Strategy")
    print("=" * 60)
    print()
    print("Strategy: Official Python embeddable + pip-installed packages")
    print("Reason: PyInstaller is unreliable with PyTorch/CUDA, ctranslate2,")
    print("        and onnxruntime GPU DLL chains. Embedded Python is stable.")
    print()

    # Clean
    if DIST_DIR.exists():
        print(f"Cleaning {DIST_DIR}...")
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Prepare embedded Python
    print("\n[1/5] Preparing embedded Python...")
    python_dir = prepare_embedded_python(args.python_version)
    python_exe = str(python_dir / "python.exe")

    # Step 2: Install requirements
    if not args.skip_install:
        print("\n[2/5] Installing requirements (CPU PyTorch, CUDA upgrade at runtime)...")
        install_requirements(python_exe)
        print("\n  Installing Piper TTS (optional)...")
        install_piper_tts(python_exe)
        print("\n  Downloading openWakeWord resource models...")
        try:
            subprocess.run(
                [python_exe, "-c",
                 "from openwakeword.utils import download_models; download_models()"],
                cwd=str(DIST_DIR), timeout=120, check=True,
            )
            print("  [ok] openWakeWord models downloaded")
        except Exception as exc:
            print(f"  [warning] openWakeWord model download failed: {exc}")
            print("  Models will be auto-downloaded on first wake word use.")
    else:
        print("\n[2/5] Skipping pip install (--skip-install)")

    # Step 3: Copy backend source
    print("\n[3/5] Copying backend source...")
    copy_backend_source()

    # Step 4: Copy small assets (wake word, Piper voice)
    print("\n[4/5] Copying small assets (wake word, Piper voice)...")
    copy_small_assets()

    # Step 5: Create launcher
    print("\n[5/5] Creating launcher...")
    create_launcher(python_dir)

    # Summary
    print("\n" + "=" * 60)
    print("Build complete!")
    print(f"  Output: {DIST_DIR}")
    print(f"  Python: {python_dir / 'python.exe'}")
    print(f"  App:    {DIST_DIR / 'app'}")
    print(f"  Models: {DIST_DIR / 'models'}")
    print(f"  Launch: {DIST_DIR / 'nox-backend.bat'}")
    print()
    print("Test with:")
    print(f"  {DIST_DIR / 'nox-backend.bat'}")
    print()
    print("For electron-builder: extraResources should point to dist-backend/")
    print("=" * 60)


if __name__ == "__main__":
    main()
