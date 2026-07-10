<div align="center">

<img src="img/icon_1024x1024.png" width="128" height="128" alt="Nox Logo">

# 🌙 Nox

**Local AI Desktop Assistant for Windows — Voice-enabled, private, and fully offline.**

<p>
  <a href="https://github.com/VeridonNetzwerk/Nox/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/VeridonNetzwerk/Nox?style=flat-square" alt="License">
  </a>
  <a href="https://github.com/VeridonNetzwerk/Nox/issues">
    <img src="https://img.shields.io/github/issues/VeridonNetzwerk/Nox?style=flat-square" alt="Open Issues">
  </a>
  <a href="https://github.com/VeridonNetzwerk/Nox/stargazers">
    <img src="https://img.shields.io/github/stars/VeridonNetzwerk/Nox?style=flat-square" alt="Stars">
  </a>
  <a href="https://github.com/VeridonNetzwerk/Nox/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/VeridonNetzwerk/Nox/build.yml?style=flat-square&label=build" alt="Build Status">
  </a>
  <a href="https://veridonnetzwerk.github.io/Nox/">
    <img src="https://img.shields.io/badge/website-online-green" alt="Website">
  </a>
  <img src="https://img.shields.io/badge/Windows%2011-supported-blue" alt="Windows 11">
  <img src="https://img.shields.io/badge/Python-3.11-yellow" alt="Python 3.11">
  <img src="https://img.shields.io/badge/Electron-33-blue" alt="Electron 33">
  <img src="https://img.shields.io/badge/React-18-cyan" alt="React 18">
</p>

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎙️ **Wake Word** | Say **"Hey Nox"** to activate — custom-trained openWakeWord model, fully offline |
| 🗣️ **Speech-to-Text** | GPU-accelerated transcription via faster-whisper (CUDA) with VAD silence detection |
| 🔊 **Text-to-Speech** | Natural German voice via Piper TTS, sentence-by-sentence streaming |
| 💬 **Chat** | Streaming token-by-token responses via Ollama (llama3.1, mistral, etc.) |
| 👁️ **Context Capture** | Reads active windows, UI elements, clipboard, and screenshots (OCR) for context-aware answers |
| 📁 **File Search** | Indexes and searches local documents (txt, md, docx, pdf) with semantic embeddings |
| 🎨 **Overlay UI** | Sleek always-on-top overlay with system tray, global hotkey, and dark theme |
| 🔒 **100% Local** | No cloud, no telemetry, no data leaves your machine |
| 🌐 **Multilingual** | German and English UI with full i18n support |

---

## 🛠️ Requirements

| Component | Version | Notes |
|-----------|---------|-------|
| OS | Windows 10/11 | Windows 10 build 19041+ or Windows 11 |
| Node.js | 20+ (LTS) | For development only |
| Python | 3.11+ | For development only |
| Ollama | any recent | Local LLM runtime — auto-installed by onboarding wizard |
| GPU | NVIDIA CUDA (optional) | CPU fallback available (slower STT/OCR) |

> **Note**: Nox runs entirely locally. You don't need an internet connection after installation — all AI models (LLM, STT, TTS, wake word) run on your machine.

---

## 🚀 Quick Start

### Option A: Installer (Recommended)

1. Download the latest `Nox-Setup.exe` from [Releases](https://github.com/VeridonNetzwerk/Nox/releases) or from the [Actions artifacts](https://github.com/VeridonNetzwerk/Nox/actions)
2. Run the installer — Windows SmartScreen may warn (unsigned installer), click **More info → Run anyway**
3. Nox launches and the onboarding wizard guides you through:
   - Ollama installation (if not already installed)
   - Model selection (e.g. `llama3.1`)
   - Microphone & audio device setup
   - Wake word calibration ("Hey Nox")
4. Done — start chatting or say **"Hey Nox"**

### Option B: Build from Source

```bash
git clone https://github.com/VeridonNetzwerk/Nox.git
cd Nox/nox-app

# Install dependencies
npm install
cd ui && npm install && cd ..
cd backend && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt && cd ..

# Start Ollama (separate terminal)
ollama serve

# Run dev environment
npm run dev
```

This starts:
- **Backend**: FastAPI on `127.0.0.1:8420` (with hot-reload)
- **Frontend**: Vite dev server + Electron

---

## 🖼️ Screenshots & Website

<div align="center">

<img src="img/Nox_text_logo_glowing_2350x1024.png" alt="Nox Logo" width="600">

</div>

Visit the project website: **[veridonnetzwerk.github.io/Nox](https://veridonnetzwerk.github.io/Nox/)**

---

## 🏗️ Architecture

```
nox-app/
├── ui/                    # Electron + React + Tailwind frontend
│   ├── electron/          # Main process, tray, hotkey, IPC
│   └── src/               # React app, components, locales
├── backend/               # Python FastAPI backend
│   ├── main.py            # API entry point
│   ├── nox_voice/         # Wake word → VAD → STT → TTS pipeline
│   ├── nox_eye/           # Context capture (window, UIA, OCR, clipboard)
│   ├── nox_files/         # Local file search & indexing
│   ├── orchestrator/      # Central coordination, conversation memory, tools
│   └── config.yaml        # Default config
├── assets/                # Branding & icons
└── .github/workflows/     # CI/CD — automated Windows builds
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Electron 33, React 18, Tailwind CSS 3, Vite 6 |
| Backend | Python 3.11, FastAPI, uvicorn |
| LLM | Ollama (llama3.1, mistral, etc.) |
| Wake Word | openWakeWord (custom "Hey Nox" ONNX model) |
| STT | faster-whisper (CTranslate2, CUDA) |
| TTS | Piper TTS (German voice, sentence streaming) |
| VAD | webrtcvad (voice activity detection + end-of-turn) |
| Context | EasyOCR, sentence-transformers, SQLite + FTS5 |
| Packaging | electron-builder (NSIS installer) |

---

## ⚙️ Configuration

Settings are stored in `%APPDATA%\Nox\config.yaml` and can be changed via the in-app Settings panel:

| Setting | Default | Description |
|---------|---------|-------------|
| `wake_word_enabled` | `true` | Enable "Hey Nox" voice activation |
| `wake_word_model` | `hey_nox.onnx` | Wake word ONNX model filename |
| `wake_word_threshold` | `0.5` | Detection sensitivity (0–1) |
| `stt_model` | `small` | Whisper model size (tiny/base/small/medium/large) |
| `stt_language` | `de` | STT language code |
| `stt_device` | `cuda` | Compute device (cuda/cpu) |
| `tts_model` | `de_DE-thorsten-medium` | Piper voice model |
| `vad_silence_duration` | `1.0` | Silence seconds to end recording |
| `vad_timeout` | `15.0` | Max recording duration |
| `hotkey` | `Ctrl+Shift+Space` | Global overlay toggle |

### Data Storage

| Path | Content |
|------|---------|
| `%APPDATA%\Nox\config.yaml` | Configuration |
| `%APPDATA%\Nox\logs\` | Rotated log files |
| `%APPDATA%\Nox\data\nox.db` | SQLite: context + conversations |

---

## 🔨 Build & CI

### Local Build

```bash
cd nox-app
npm run build
```

This runs three steps:
1. **build:backend** — Downloads Python 3.11.9 embeddable, installs all pip packages, copies backend source
2. **build:ui** — Vite production build of the React frontend
3. **electron-builder** — Packages everything into a NSIS installer

Output: `dist/Nox-Setup-0.5.0.exe`

### GitHub Actions

Every push to `main` triggers an automated build on `windows-latest`:

[![Build Status](https://img.shields.io/github/actions/workflow/status/VeridonNetzwerk/Nox/build.yml?style=flat-square&label=build)](https://github.com/VeridonNetzwerk/Nox/actions)

Artifacts are available for download from the [Actions tab](https://github.com/VeridonNetzwerk/Nox/actions):
- **Nox-Installer** — NSIS `.exe` installer
- **Nox-Unpacked** — Unpacked portable version

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](nox-app/ARCHITECTURE.md) | Full architecture and component overview |
| [Dev Setup](nox-app/README.md) | Detailed development setup guide |
| [Test Plan](nox-app/Testplan.md) | Manual end-to-end test scenarios |

---

## 🐛 Reporting Issues

Found a bug? Open an [**Issue**](https://github.com/VeridonNetzwerk/Nox/issues/new) and include:

- What you expected vs. what actually happened
- Your Windows version and GPU (NVIDIA/AMD/Intel)
- Whether you're using the installer or running from source
- Any relevant log output from `%APPDATA%\Nox\logs\`

---

## 💖 Support

If you like this project, consider donating:

<a href="https://www.paypal.com/donate/?hosted_button_id=972P9WTWE7RBU">
  <img src="https://img.shields.io/badge/Donate-PayPal-0070ba?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal">
</a>

---

## 🤖 Built With AI

Parts of this project were created and refined with the assistance of AI tools.

---

<div align="center">
  <sub>© 2026 VeridonNetzwerk</sub>
</div>
