# Nox – Local AI Desktop Assistant

A fully local, voice-enabled AI desktop assistant for Windows 11.
Built with Electron (React + Tailwind) frontend and Python FastAPI backend.

## Architecture

```
nox-app/
├── ui/              # Electron + React + Tailwind frontend
│   ├── electron/    # Main process, tray, hotkey, IPC
│   └── src/         # React app, components, locales
├── backend/         # Python FastAPI backend
│   ├── main.py      # Entry point: health, chat, settings, models
│   ├── config.yaml  # Default config (copied to %APPDATA% on first run)
│   ├── settings_manager.py  # Persistent config in %APPDATA%\Nox\
│   ├── autostart.py # Windows Registry Run-Key management
│   ├── nox_voice/   # Wake word, STT, TTS pipeline
│   ├── nox_eye/     # Context capture (window, UIA, OCR, clipboard)
│   ├── orchestrator/  # Central coordination, conversation memory, tools
│   └── tests/       # Unit tests (pytest)
├── models/          # Wake-Word ONNX model, Piper voices
├── Testplan.md      # Manual E2E test scenarios
├── ARCHITECTURE.md  # Full architecture documentation
└── package.json     # Root monorepo scripts
```

## Prerequisites

- **Node.js** 20+ (LTS)
- **Python** 3.11+
- **Ollama** running locally on `http://localhost:11434`

### Installing Ollama

1. Download from [ollama.com](https://ollama.com) and install
2. Start the service:
   ```bash
   ollama serve
   ```
3. Pull a model (required for Nox to work):
   ```bash
   ollama pull llama3.1
   ```
   Other models work too – you can change it in Settings later.

### Wake-Word Model (optional, for voice activation)

Place a wake-word ONNX model at `models/hey_nox.onnx`.
Until a custom model is trained, you can use an openWakeWord example model:

```bash
# Example: copy an existing openWakeWord model
cp %APPDATA%\openwakeword\models\hey_jarvis.onnx models\hey_nox.onnx
```

Without this file, voice activation is disabled (text chat + mic button still work).

### Piper TTS Voice (optional, for spoken responses)

Download a German Piper voice from [piper voices](https://github.com/rhasspy/piper1-gpl/tree/main/VOICES):
- Place `.onnx` and `.onnx.json` files in the models directory
- Configure the voice name in Settings → TTS-Stimme

## Dev Setup

1. **Install root dependencies:**
   ```bash
   cd nox-app
   npm install
   ```

2. **Install UI dependencies:**
   ```bash
   cd ui
   npm install
   ```

3. **Install Python dependencies:**
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Start Ollama** (in a separate terminal):
   ```bash
   ollama serve
   ```

5. **Run the dev environment** (from `nox-app/`):
   ```bash
   npm run dev
   ```

   This starts:
   - Backend: `uvicorn` on `127.0.0.1:8420` (with `--reload`)
   - Frontend: Vite dev server + Electron

## Running Tests

```bash
cd backend
.venv\Scripts\activate
python -m pytest tests/ -v
```

See `Testplan.md` for manual end-to-end test scenarios.

## Production Build

Build an installable Windows NSIS installer:

```bash
cd nox-app
npm run build
```

This runs three steps:
1. **build:backend** – Downloads Python 3.11.9 embeddable, installs all pip packages, copies backend source + small assets (wake word model, Piper voice) into `dist-backend/`
2. **build:ui** – Vite production build of the React frontend
3. **electron-builder** – Packages everything into a single NSIS installer

Output: `dist/Nox-Setup-0.5.0.exe` – a single self-contained installer.

### Installer Size

The installer is **several hundred MB to low single-digit GB** in size.
This is normal and expected for a local AI application:

- **PyTorch + CUDA runtime DLLs** (~2 GB) – bundled via pip, no separate CUDA Toolkit needed
- **ctranslate2** (faster-whisper GPU backend) – ~200 MB
- **onnxruntime** (openWakeWord) – ~100 MB
- **Embedded Python + all pip packages** – ~500 MB
- **Small assets** (wake word ONNX, Piper voice) – ~10-20 MB

This is **not a bug** – it's the cost of running AI entirely locally without
a cloud backend. For comparison, Ollama's own installer is ~500 MB.

### SmartScreen Warning (Nox + Ollama)

Both the Nox installer and Ollama's installer are **unsigned**.
Windows SmartScreen will show a warning for **both**:

> "Windows protected your PC"

To proceed: click **More info** → **Run anyway**.

This applies to:
1. **Nox-Setup.exe** – the main installer
2. **OllamaSetup.exe** – downloaded automatically by the onboarding wizard

For a production-ready installer **without** SmartScreen warnings, you need a
**code-signing certificate** (OV or EV). This is a separate, cost-bearing step
outside the codebase:
- Purchase from DigiCert, Sectigo, etc. (~$200–$400/year for OV, ~$400+ for EV)
- Configure `electron-builder` with the certificate in `package.json`:
  ```json
  "win": {
    "certificateFile": "cert.pfx",
    "certificatePassword": "..."
  }
  ```

### End-to-End Installation Flow

1. User downloads a single file: `Nox-Setup.exe`
2. Double-click → NSIS installs app files, embedded Python backend, small assets (wake word, Piper voice), creates shortcuts
3. Nox starts automatically → Onboarding wizard takes over:
   - Checks if Ollama is installed; if not, downloads and silently installs it
   - Checks GPU/CUDA availability (CPU fallback clearly indicated)
   - User selects or pulls an Ollama model (e.g. `llama3.1`) with real-time progress
   - Microphone test
   - Wake-word calibration (if model present)
4. After onboarding: fully functional, autostart-capable Nox with branding
5. No manual Python or Ollama installation required

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check |
| `/health/ollama` | GET | Ollama reachability + loaded model |
| `/health/voice` | GET | Voice pipeline component status |
| `/health/eye` | GET | Context capture component status |
| `/api/status` | GET | Comprehensive system status for UI error states |
| `/api/settings` | GET | All current settings |
| `/api/settings` | POST | Update + persist settings |
| `/api/models` | GET | Available Ollama models |
| `/api/model` | POST | Change active model at runtime |
| `/api/autostart` | GET/POST | Autostart status + toggle |
| `/api/onboarding/gpu-check` | GET | CUDA/GPU availability check |
| `/api/onboarding/install-ollama` | POST | Start async Ollama download + silent install |
| `/api/onboarding/install-status` | GET | Poll Ollama install progress |
| `/api/onboarding/pull-ollama-model` | POST | Start async Ollama model pull |
| `/api/onboarding/pull-status` | GET | Poll model pull progress |
| `/api/onboarding/download-model` | POST | Start async model file download (Whisper/Piper/wakeword) |
| `/api/onboarding/download-status` | GET | Poll model download progress |
| `/ws/chat` | WebSocket | Streaming chat (token-by-token) + voice events |

## Configuration

Settings are stored in `%APPDATA%\Nox\config.yaml` (auto-created on first run
from the bundled `backend/config.yaml`). Changes via the Settings panel are
persisted immediately. For dev overrides, use `backend/config.local.yaml`.

## Data Storage

- **Config:** `%APPDATA%\Nox\config.yaml`
- **Logs:** `%APPDATA%\Nox\logs\` (rotated by size 5MB×3 + daily×7 days)
- **Database:** `%APPDATA%\Nox\data\nox.db` (SQLite: context + conversations)

## License

Private project.
