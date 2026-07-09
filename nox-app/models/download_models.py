#!/usr/bin/env python3
"""Download placeholder/example models for Nox.

This script downloads:
1. An openWakeWord example model as hey_nox.onnx placeholder
2. A Piper German voice model (de_DE thorsten medium)
3. Instructions for faster-whisper models (downloaded on first use)

Usage:
    python download_models.py
"""

import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).parent

# openWakeWord example model – used as placeholder for hey_nox.onnx
# openWakeWord stores models as .tflite; we download and convert to .onnx
OWW_MODEL_URL = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_jarvis_v0.1.tflite"

# Piper German voice model (de_DE thorsten medium)
PIPER_VOICE_BASE = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/"
)
PIPER_VOICE_FILES = {
    "de_DE-thorsten-medium.onnx": PIPER_VOICE_BASE + "de_DE-thorsten-medium.onnx",
    "de_DE-thorsten-medium.onnx.json": PIPER_VOICE_BASE + "de_DE-thorsten-medium.onnx.json",
}

WHISPER_NOTE = """
faster-whisper models are downloaded automatically on first use.
The model cache is typically stored in ~/.cache/huggingface/ or
C:\\Users\\<user>\\AppData\\Local\\huggingface\\.

To pre-download a model:
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cuda", compute_type="float16")
"""


def download_file(url: str, dest: Path) -> bool:
    """Download a file with progress output."""
    if dest.exists():
        print(f"  [skip] {dest.name} already exists ({dest.stat().st_size} bytes)")
        return True
    print(f"  [download] {dest.name} from {url}")
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"  [ok] {dest.name} downloaded ({dest.stat().st_size} bytes)")
        return True
    except Exception as exc:
        print(f"  [error] Failed to download {dest.name}: {exc}", file=sys.stderr)
        return False


def download_wake_word_model() -> None:
    """Download openWakeWord example model as hey_nox.onnx placeholder.

    openWakeWord distributes models as .tflite. We download the tflite,
    then convert to .onnx using openwakeword's built-in conversion.
    """
    onnx_dest = MODELS_DIR / "hey_nox.onnx"
    if onnx_dest.exists():
        print(f"  [skip] hey_nox.onnx already exists ({onnx_dest.stat().st_size} bytes)")
        return

    tflite_dest = MODELS_DIR / "hey_nox.tflite"
    if not tflite_dest.exists():
        print(f"  [download] hey_nox.tflite (placeholder: hey_jarvis) from openWakeWord releases")
        try:
            urllib.request.urlretrieve(OWW_MODEL_URL, tflite_dest)
            print(f"  [ok] hey_nox.tflite downloaded ({tflite_dest.stat().st_size} bytes)")
        except Exception as exc:
            print(f"  [error] Failed to download wake word model: {exc}", file=sys.stderr)
            return
    else:
        print(f"  [skip] hey_nox.tflite already exists")

    # Convert tflite to onnx
    print("  [convert] tflite → onnx...")
    try:
        import onnx
        from onnx import helper
        # Use openwakeword's conversion if available
        try:
            from openwakeword.model import Model as OWWModel
            # Loading the tflite model triggers automatic onnx conversion
            # when onnxruntime is the inference framework
            model = OWWModel(wakeword_model_paths=[str(tflite_dest)], inference_framework="onnx")
            # The onnx model is saved alongside the tflite
            converted = tflite_dest.with_suffix(".onnx")
            if converted.exists():
                import shutil
                shutil.move(str(converted), str(onnx_dest))
                print(f"  [ok] hey_nox.onnx created ({onnx_dest.stat().st_size} bytes)")
            else:
                print("  [warning] Conversion did not produce .onnx file")
                print("  The .tflite model will be used as fallback by openWakeWord")
        except ImportError:
            print("  [warning] openwakeword not installed – cannot convert to .onnx")
            print("  The .tflite model will be used as fallback by openWakeWord")
            print("  Install with: pip install openwakeword onnxruntime")
    except ImportError:
        print("  [warning] onnx package not installed – cannot convert")
        print("  The .tflite model will be used as fallback by openWakeWord")

    print("  NOTE: This is a placeholder (hey_jarvis model). Train a custom")
    print("  'hey_nox' model with openWakeWord for production use.")


def download_piper_voice() -> None:
    """Download Piper German voice model."""
    piper_dir = MODELS_DIR / "piper-models"
    piper_dir.mkdir(parents=True, exist_ok=True)

    all_ok = True
    for name, url in PIPER_VOICE_FILES.items():
        dest = piper_dir / name
        if not download_file(url, dest):
            all_ok = False

    if all_ok:
        print("  [ok] Piper German voice (de_DE-thorsten-medium) ready")
    else:
        print("  [warning] Some Piper voice files failed to download")
        print(f"  Manual download from: {PIPER_VOICE_BASE}")


def main() -> None:
    print("Nox Model Downloader")
    print("=" * 40)
    print()

    print("[1/3] Wake word model (hey_nox.onnx placeholder):")
    download_wake_word_model()
    print()

    print("[2/3] Piper TTS German voice (de_DE-thorsten-medium):")
    download_piper_voice()
    print()

    print("[3/3] faster-whisper:")
    print(WHISPER_NOTE)
    print()

    print("Done. Review the notes above for manual download steps.")


if __name__ == "__main__":
    main()
