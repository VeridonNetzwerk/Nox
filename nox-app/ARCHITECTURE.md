# Nox – Architecture

> Living document. Updated after each development phase.

## Current Phase: Production Readiness – Backend Freezing, Branding, Intelligent Onboarding

### Structure
```
nox-app/
├── package.json          # Root monorepo: `npm run dev` starts backend + UI
├── README.md             # Dev setup guide
├── .gitignore
├── ARCHITECTURE.md       # This file
├── assets/
│   └── branding/         # Mascot icons, text logos (PNG, 7 files)
├── backend/
│   ├── main.py           # FastAPI app: health, chat, voice, eye, settings, models, onboarding
│   ├── build_backend.py  # Embedded Python build script (downloads, pip install, package)
│   ├── config.yaml       # Default config (copied to %APPDATA% on first run)
│   ├── settings_manager.py # Persistent config in %APPDATA%\Nox\config.yaml
│   ├── autostart.py      # Windows Registry Run-Key management
│   ├── requirements.txt  # Pinned Python deps (core + voice + eye)
│   ├── nox_voice/        # Voice pipeline module
│   │   ├── __init__.py   # Exports VoiceManager
│   │   ├── audio_devices.py  # Audio device listing + resolution (sounddevice)
│   │   ├── wake_word.py  # openWakeWord continuous listener (daemon thread)
│   │   ├── vad.py        # webrtcvad recorder + end-of-turn detection (heuristic)
│   │   ├── stt.py        # faster-whisper STT (CUDA, lazy model load, beam_size param)
│   │   ├── tts.py        # Piper TTS (sentence streaming, configurable output device)
│   │   └── voice_manager.py  # Orchestrates wake→record→transcribe→TTS, audio hot-reload
│   ├── nox_eye/          # Context capture module
│   │   ├── __init__.py   # Exports EyeManager
│   │   ├── window_monitor.py   # Active window tracking (win32gui, event-driven)
│   │   ├── uia_reader.py       # UI Automation text extraction (uiautomation)
│   │   ├── ocr_fallback.py     # EasyOCR GPU fallback (screenshot + OCR)
│   │   ├── clipboard_monitor.py # Clipboard text monitoring (win32clipboard)
│   │   ├── context_store.py    # SQLite + FTS5 + embeddings storage
│   │   └── eye_manager.py      # Orchestrates capture, pause/resume, retrieval
│   ├── nox_files/        # Local file search module (read-only)
│   │   ├── __init__.py   # Exports FilesManager
│   │   ├── file_indexer.py  # Folder scanner + text extraction (txt/md/docx/pdf/OCR)
│   │   ├── file_store.py    # SQLite + FTS5 + embeddings for file content
│   │   └── files_manager.py # Orchestrates indexing, search, pause/resume, exclusions
│   ├── orchestrator/    # Central orchestration module
│   │   ├── __init__.py          # Exports Orchestrator
│   │   ├── orchestrator.py      # Context + history + prompt + streaming + TTS
│   │   ├── conversation_store.py # SQLite conversation history + summarization
│   │   ├── system_prompt.py     # Persona "Nox" + voice/text mode directives
│   │   └── tool_handler.py      # Tool-calling interface + fallback parsing
├── tests/              # All tests (pytest + manual test plan)
│   ├── conftest.py
│   ├── test_context_ranking.py  # Context retrieval ranking
│   ├── test_prompt_construction.py  # System prompt + message assembly
│   ├── test_config_loading.py  # SettingsManager persistence
│   └── Testplan.md             # Manual E2E test scenarios
├── ui/
│   ├── package.json      # Electron + React + Vite + Tailwind
│   ├── electron/
│   │   ├── main.js       # Overlay: positioning, tray, hotkey, blur, theme
│   │   ├── preload.js    # contextBridge: IPC for theme, window, settings
│   │   └── icon.js       # Tray icon from mascot PNG (active/paused desaturated)
│   ├── src/
│   │   ├── assets/        # Mascot icon + text logos (imported in React)
│   │   ├── App.jsx       # Gemini-style chat UI: streaming, mic, thinking, settings
│   │   ├── main.jsx      # React entry point
│   │   ├── index.css     # CSS vars (dark/light), animations, backdrop blur
│   │   ├── locales/
│   │   │   └── de.json   # German UI strings (not hardcoded)
│   │   └── components/
│   │       ├── SettingsPanel.jsx  # API-driven settings: model, voice, context, hotkey, theme
│   │       └── OnboardingWizard.jsx  # First-run setup: Ollama install, model pull, GPU check, mic, wake
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js  # CSS variable-based theme colors
│   └── postcss.config.js
├── shared/
│   └── config_schema.json  # JSON Schema for config.yaml validation
└── models/
    ├── .gitkeep
    └── download_models.py  # Fetches placeholder OWW model, notes for Whisper/Piper
```

### Module Interfaces

#### Backend → Frontend

**REST:**
| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/health` | GET | — | `{status, service, version}` |
| `/health/ollama` | GET | — | `{status, ollama_host, configured_model, available_models?, model_available?, error?}` |
| `/health/voice` | GET | — | `{wake_word: {available, running, model}, stt: {available, model, device}, tts: {available, model, speaking}, state, enabled}` |
| `/health/eye` | GET | — | `{enabled, paused, window_monitor, uia_reader, ocr_fallback, clipboard_monitor, context_store}` |
| `/eye/pause` | POST | — | `{status, paused: true}` — stop context capture |
| `/eye/resume` | POST | — | `{status, paused: false}` — resume context capture |
| `/api/models` | GET | — | `{status, current_model, available_models[]}` — Ollama model list |
| `/api/model` | POST | `{model: str}` | `{status, model}` — change active model at runtime |
| `/api/conversation/new` | POST | — | `{status, conversation_id}` — start new conversation |
| `/api/settings` | GET | — | `{status, settings, config_path}` — all current settings |
| `/api/settings` | POST | `{key: value, …}` | `{status, settings}` — update + persist settings |
| `/api/autostart` | GET | — | `{available, enabled, exe_path}` — autostart status |
| `/api/autostart` | POST | `{enabled: bool}` | `{status, enabled}` — toggle autostart |
| `/api/status` | GET | — | `{ollama, microphone, wake_word, voice, eye, autostart}` — comprehensive system status for UI error states |

**WebSocket `/ws/chat`:**
- Client → Server: `{message: str, context?: str, voice_input?: bool}` or `{type: "voice_trigger"}`
- Server → Client (multiple):
  - `{type: "token", content: str}` — streamed LLM token
  - `{type: "done", content: str}` — full response when complete
  - `{type: "error", content: str}` — error message
  - `{type: "voice_event", state: str}` — voice state: `wake_detected|listening|transcribing|thinking|speaking|idle`
  - `{type: "user_message", content: str, voice_input: bool}` — voice transcript shown as user message
  - `{type: "eye_event", state: str}` — eye state: `paused|active`
  - `{type: "tool_result", tool: str, result: str}` — tool execution result

### Config (`config.yaml`)
Central configuration for all modules. Override with `config.local.yaml`.

### Logging
Python `logging` → Rotating File Handler at `%APPDATA%\Nox\logs\backend.log` (5MB, 3 backups).

### Process Isolation
Backend and Electron run as separate processes. Backend wraps all Ollama calls in try/except — no crash propagates to the frontend.

### Electron IPC (Main ↔ Renderer)

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `theme-changed` | Main → Renderer | `"dark" \| "light"` | Windows theme changed |
| `window-show` | Main → Renderer | — | Window is being shown (trigger slide-in) |
| `window-hide` | Main → Renderer | — | Window is being hidden (trigger fade-out) |
| `open-settings` | Main → Renderer | — | Open settings panel |
| `hide-window` | Renderer → Main | — | Request window hide (Escape key) |
| `show-window` | Renderer → Main | — | Request window show (wake word detected) |
| `update-hotkey` | Renderer → Main | `string` | Re-register global hotkey at runtime |

### Overlay Positioning
- Uses `screen.getCursorScreenPoint()` + `screen.getDisplayNearestPoint()` for multi-monitor support
- Window placed at bottom-right of `display.workArea` (respects taskbar position)
- 380×600px, 8px margin from edges
- `alwaysOnTop` level: `screen-saver`
- `skipTaskbar: true`, `frame: false`, `transparent: true`

### Tray
- Programmatic icon (purple = active, gray = paused)
- Left click: toggle overlay
- Context menu: Open, Close, Pause/Resume, Settings, Quit
- `suppressBlur` flag prevents immediate hide on tray click

### Theme System
- `nativeTheme.shouldUseDarkColors` → `data-theme` attribute on root div
- CSS variables in `index.css` for all colors
- Tailwind colors reference CSS vars (`var(--nox-*)`)
- Auto-updates on Windows theme change via `nativeTheme.on("updated")`

### Voice Pipeline (nox_voice)

**State machine:** `idle → wake_detected → listening → transcribing → thinking → speaking → idle`

The `listening → thinking` transition happens only when the end-of-turn detector commits — not on first silence. This ensures Nox doesn't start responding while the user is still formulating a thought.

**Threading model:**
- Wake word listener: daemon thread, continuous mic capture at 16kHz
- VAD recording: blocking thread spawned on wake detection
- STT (Whisper): runs in same thread as VAD, lazy model load
- TTS (Piper): separate thread per sentence, sounddevice playback
- Wake word paused during recording and TTS to prevent echo

**Audio device selection:**
- `GET /api/audio/devices` — lists all input/output devices via `sounddevice.query_devices()`
- `POST /api/audio/test-input` — records 1s sample, returns RMS/peak level
- `POST /api/audio/test-output` — plays 440Hz test tone on selected device
- Config: `audio_input_device` / `audio_output_device` (name, index, or "default")
- Hot-reload: changing device in settings re-opens the affected audio stream without restarting the backend
- `nox_voice/audio_devices.py` resolves device names/indices to sounddevice indices

**End-of-Turn Detection (vad.py):**
- **Asymmetric thresholds:** Speech onset requires `vad_speech_onset_frames` (default 3) consecutive speech frames to confirm — prevents false triggers from coughs/noises. Speech offset is immediate (1 frame of silence starts the silence timer).
- **Configurable silence duration:** `end_turn_silence_threshold` (default 1.0s, range 0.5–2.5s via UI slider). Higher = more time for thinking pauses.
- **Heuristic end-of-turn fallback** (when no ML turn-detection model is available):
  - **Fill word detection:** If the partial transcript ends with "ähm", "also", "naja" etc., silence tolerance is extended by `end_turn_fillword_extension` (0.8s).
  - **Incomplete sentence detection:** If the partial transcript lacks terminal punctuation or ends with a conjunction, silence tolerance is extended by `end_turn_incomplete_sentence_extension` (1.0s).
  - **Hard cap:** `end_turn_max_silence` (2.5s) — never wait longer than this, even with extensions.
- **Speculative transcription:** During recording, `on_partial_transcript` callback runs faster-whisper with `beam_size=1` on recent audio chunks to get a running transcript for heuristic analysis. The final transcription (full quality, `beam_size=5`) runs only after the recorder returns.
- **Commit semantics:** The orchestrator receives the transcript only after the recorder confirms end-of-turn. The `listening → transcribing → thinking` state transitions happen at the actual commit point, making it visually clear to the user when Nox stops listening and starts processing.

**Datenschutz:**
- Only the lightweight ONNX/TFLite wake word listener runs permanently
- Full audio recording + Whisper transcription only AFTER wake detection
- No audio is ever streamed to Whisper continuously
- Speculative transcription runs locally only — no audio leaves the machine

**Sentence-buffered TTS:**
- `SentenceBuffer` in `main.py` accumulates streamed LLM tokens
- Complete sentences are sent to Piper immediately (low latency)
- Remaining text flushed at end of response

### Context Capture (nox_eye)

**Capture pipeline (priority order):**
1. Active window + process name (win32gui, event-driven via hwnd change detection)
2. UI Automation text extraction (uiautomation package, skips password fields)
3. OCR fallback: screenshot + EasyOCR GPU (for games, Electron apps, RDP)
4. Clipboard text monitoring (win32clipboard, text only)

**Storage:**
- SQLite `context_log` table: id, timestamp, app_name, window_title, content_type, content_text
- FTS5 virtual table for full-text search over content_text
- `context_embeddings` table with sentence-transformers vectors (paraphrase-multilingual-MiniLM-L12-v2)
- Automatic cleanup of entries older than `nox_eye_ttl_days` (default 7)

**Retrieval (`get_relevant_context`):**
- Combines semantic similarity (cosine) + recency weighting + FTS5 keyword matching
- Returns top-k formatted snippets from last N hours
- Injected into every LLM prompt by `process_chat_message()` in `main.py`

**Privacy:**
- Configurable app exclusion list (password managers, etc.)
- Global pause via tray menu → `POST /eye/pause` → `EyeManager.pause()`
- Tray icon changes color (purple active → gray paused)
- Password fields never captured (UIA `IsPassword` flag check)
- TTL-based automatic deletion of old entries

### File Search (nox_files)

**Purpose:** Gives Nox read-only access to local files so the assistant can answer "Wo ist nochmal die Datei zu X?" or "Was stand in dem PDF von letzter Woche?".

**Architecture (mirrors nox_eye):**
- `file_indexer.py`: Scans configured folders, extracts text from supported formats
- `file_store.py`: SQLite + FTS5 + sentence-transformers embeddings (separate `nox_files.db`)
- `files_manager.py`: Orchestrates indexing loop, search, pause/resume, settings hot-reload

**Supported file formats:**
- Text: `.txt`, `.md`, `.log`, `.csv`, `.json`, `.xml`, `.html`, `.py`, `.js`, `.ts`, `.yaml`, `.toml`, `.ini`, etc.
- Documents: `.docx` (python-docx), `.pdf` (PyMuPDF for text PDFs, EasyOCR fallback for scanned/image PDFs)

**Scope & settings:**
- Default scope: Documents, Desktop, Downloads, Pictures, Videos, Music (user profile folders)
- `nox_files_full_drive`: Explicit opt-in for full drive indexing — not a hidden default, shows warning in UI
- `nox_files_custom_folders`: Additional folders added via settings
- `nox_files_excluded_dirs`: Editable exclusion list (same pattern as nox_eye excluded apps)

**Security & privacy:**
- **Read-only by design**: No write, delete, or execute tools. Only `dateien_suchen` and `datei_lesen`.
- **Sensitive file exclusion**: Files matching `*password*`, `*credentials*`, `*.kdbx`, `*.key`, `*.pem`, `*.wallet`, etc. are always excluded from the index, regardless of settings.
- **Default excluded directories**: `.ssh`, `.gnupg`, browser cookie/storage dirs, crypto wallet dirs, `node_modules`, `.git`, system folders (`Windows`, `Program Files`, `$Recycle.Bin`, `AppData`).
- **Size limits**: Max 50MB per file, 2MB text extraction limit per file. Binary files (images, videos, audio, executables, archives) are never indexed.
- **Prompt injection prevention**: `system_prompt.py` includes `REFERENCE_MATERIAL_DIRECTIVE` — file contents from tools are explicitly labeled as reference material, not instructions. The model is instructed to ignore embedded commands in file content.
- **Pause**: Tray + settings pause stops indexing immediately (same as nox_eye). Search still works on existing index.

**Tools (in tool_handler.py):**
- `dateien_suchen(query, ordner?)`: Full-text + semantic search over file index. Returns file name, path, and snippet.
- `datei_lesen(pfad)`: Reads text content of a specific file (with 100K char limit). Falls back to direct file read if not yet indexed.

**API endpoints:**
- `GET /health/files`: Index stats (file count, by extension, scan folders, indexing status)
- `POST /files/pause`: Pause indexing immediately
- `POST /files/resume`: Resume indexing
- `POST /files/reindex`: Trigger immediate re-index

**Indexing:**
- Background daemon thread, re-scans every 30 minutes
- Only re-indexes files with changed modification time
- OCR for scanned PDFs reuses EasyOCR from nox_eye (GPU if configured)

### Orchestrator

**Pipeline per message:**
1. Retrieve context from `nox_eye.get_relevant_context()`
2. Load conversation history from `ConversationStore` (SQLite)
3. Build messages: system prompt (persona + voice/text mode) + summary + history + new message
4. Stream Ollama `/api/chat` response token-by-token via WebSocket
5. In voice mode: `SentenceBuffer` emits complete sentences to Piper TTS immediately
6. Tool-calling: fallback `[TOOL: name] params` parsing → execute → inject result → re-stream
   - `kontext_suche`: search nox_eye context
   - `notiz_speichern`: save a note
   - `aktuelle_uhrzeit`: get current time
   - `dateien_suchen`: search local files (full-text + semantic)
   - `datei_lesen`: read file content (read-only)
7. Persist user + assistant turns in SQLite
8. Context window management: auto-summarize old turns when token count exceeds 75% of max

**Persona (system_prompt.py):**
- Base: "Nox, lokaler KI-Desktop-Assistent" – kurz, hilfreich, direkt, Deutsch
- Text mode: Markdown allowed, structured answers
- Voice mode: short natural sentences, no Markdown, max 2-3 sentences
- Temporal awareness: current date/time injected

**Conversation memory (conversation_store.py):**
- SQLite `conversations` table: conversation_id, role, content, timestamp, token_count, voice_input
- `build_messages()` assembles: system + summary + recent N turns + new message
- `summarize_old_turns()`: LLM generates summary, old turns deleted, summary stored
- Triggered when total tokens > 75% of `max_context_tokens`

**Tool-calling (tool_handler.py):**
- Registered tools: `kontext_suche`, `notiz_speichern`, `aktuelle_uhrzeit`
- Native: Ollama tool schema available via `get_ollama_tools()`
- Fallback: `[TOOL: name] params` regex parsing for models without native support
- Tool results injected into conversation, LLM re-streams with result

**Model selection at runtime:**
- `GET /api/models` → fetches Ollama `/api/tags`, returns available models
- `POST /api/model` → changes active model, updates orchestrator + conversation store
- Settings panel can display dropdown

### Settings & Persistence

**Settings Manager (`settings_manager.py`):**
- `config.yaml` persisted in `%APPDATA%\Nox\config.yaml`
- First run: bundled `config.yaml` copied to `%APPDATA%`
- `GET /api/settings` → full config for settings panel
- `POST /api/settings` → partial update, persisted to disk, applied immediately where possible:
  - `ollama_model` → `orchestrator.set_model()`
  - `wake_word_threshold` → `voice_manager.wake_word.threshold`
  - `wake_word_enabled` → `voice_manager.start()/stop()`
  - `nox_eye_ttl_days` → `eye_manager.context_store.ttl_days`
  - `nox_eye_excluded_apps` → `eye_manager.window_monitor.excluded_apps`
  - `tts_model` → `voice_manager.tts.model_name` (reload on next use)
  - `hotkey` → IPC `update-hotkey` to Electron for re-registration

**Autostart (`autostart.py`):**
- Windows Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- `GET /api/autostart` → status
- `POST /api/autostart` → enable/disable
- Settings panel toggle

**Error Handling (UI):**
- `GET /api/status` → comprehensive system status (Ollama, microphone, wake word model, voice, eye, autostart)
- Ollama down → red banner with "Status prüfen" button
- No microphone → mic button greyed out, text chat fully functional
- Wake word model missing → yellow warning with instructions
- All error states polled every 30s + on-demand

**Resource Management:**
- Window monitor: 500ms lightweight hwnd check (no content capture unless hwnd changes)
- Wake word: ONNX inference on 1280-sample frames (~80ms per frame at 16kHz)
- nox_eye capture: only on actual window change + 5s cooldown
- Idle: only wake word listener + window monitor threads active

### Pending (future prompts)
- [x] Prompt 2: UI positioning, overlay behavior, tray
- [x] Prompt 3: Voice pipeline (wake word + STT + TTS)
- [x] Prompt 4: Nox Eye (context capture: window, UIA, OCR, clipboard)
- [x] Prompt 5: Orchestrator (persona, conversation history, tool-calling, model selection)
- [x] Prompt 6: Integration & Settings (settings panel, persistence, autostart, error handling)
- [x] Prompt 7: Production Readiness (tests, logging review, NSIS build, onboarding wizard)

### Testing

**Unit Tests (`tests/`, pytest):**
- `test_context_ranking.py`: Recency weighting, FTS keyword matching, combined ranking, k-limit, clipboard inclusion
- `test_prompt_construction.py`: System prompt (text/voice mode, tools, time), ConversationStore message assembly, summary injection, conversation isolation
- `test_config_loading.py`: SettingsManager first-run copy, load/save, partial merge, list persistence

**Manual E2E Tests (`tests/Testplan.md`):**
- Wake-Word → Answer, Text-Chat, Kontext-Injection, Settings-Änderung, Neustart-Verhalten, Multi-Monitor, Pause/Resume, Onboarding, Fehlerzustände

### Logging

- **Size rotation:** `nox_backend.log` – 10MB, 3 backups
- **Age rotation:** `nox_timed.log` – daily, 7 days retention
- **Privacy:** Raw context/clipboard text only logged when `log_context_content: true` (opt-in, default off). Default logs only metadata (char count, app name, content type).
- **Location:** `%APPDATA%\Nox\logs\`

### Production Build

- `npm run build` → `build:backend` (embedded Python) + `build:ui` (Vite) + electron-builder NSIS installer
- Output: **single file** `dist/Nox-Setup-0.5.0.exe`
- **Unsigned** → SmartScreen warning expected for both Nox and Ollama installers

**Build Pipeline (3 steps):**

1. `npm run build:backend` → `backend/build_backend.py`:
   - Downloads Python 3.11.9 embeddable ZIP from python.org
   - Bootstraps pip via `get-pip.py`
   - Installs all `requirements.txt` packages into embedded Python
   - Copies backend source to `dist-backend/app/`
   - Copies small assets (wake word ONNX, Piper voice) to `dist-backend/models/`
   - Creates `nox-backend.bat` launcher
2. `npm run build:ui` → Vite production build of React frontend
3. `electron-builder` → Packages `dist-backend/` as `extraResources/backend/`, Vite dist, branding icons into single NSIS installer

**Bundled vs. Downloaded Assets:**

| Asset | Bundled in installer | Downloaded via onboarding |
|---|---|---|
| Wake word ONNX (`hey_nox.onnx`) | ✓ (~few MB) | |
| Piper voice (`.onnx` + `.onnx.json`) | ✓ (~10-20 MB) | |
| Whisper model | | ✓ (via faster-whisper auto-download) |
| Ollama model (e.g. `llama3.1`) | | ✓ (via `ollama pull` in onboarding) |
| Ollama itself | | ✓ (auto-download + silent install in onboarding) |

**Installer Size:**

Several hundred MB to low single-digit GB. This is normal for a local AI app:
- PyTorch + CUDA runtime DLLs (~2 GB, via pip wheels – no separate CUDA Toolkit)
- ctranslate2 (~200 MB), onnxruntime (~100 MB)
- Embedded Python + all pip packages (~500 MB)
- Small assets (~10-20 MB)

**Backend Freezing Strategy: Embedded Python (NOT PyInstaller)**

PyInstaller is unreliable with PyTorch/CUDA, ctranslate2, and onnxruntime GPU DLL chains.
Instead, we use the official Python embeddable distribution:

1. `npm run build:backend` runs `backend/build_backend.py`
2. Downloads Python 3.11.9 embeddable ZIP from python.org
3. Bootstraps pip via `get-pip.py`
4. Installs all `requirements.txt` packages into the embedded Python
5. Copies backend source to `dist-backend/app/`
6. Copies small assets (wake word, Piper voice) to `dist-backend/models/`
7. Creates `nox-backend.bat` launcher
8. electron-builder bundles `dist-backend/` as `extraResources/backend/`
9. Electron `main.js` spawns `python/python.exe -m uvicorn main:app` with `NOX_MODELS_DIR` env var

**Why not PyInstaller?**
- PyTorch CUDA DLLs (cublas, cudnn, cusparse, etc.) have complex dependency trees
- ctranslate2 loads CUDA libs dynamically at runtime, not at import time
- onnxruntime-gpu has similar issues with provider DLLs
- Embedded Python is stable, well-tested, and officially supported by python.org
- No separate CUDA Toolkit needed – GPU runtime comes via PyPI wheels (torch, ctranslate2, onnxruntime-gpu)
- Only requirement: normal, current NVIDIA driver on the target machine

**Branding Assets:**
- App icon: `assets/branding/icon_1024x1024.png` (electron-builder, chat avatar)
- Tray icon: `assets/branding/icon_non_glow_1024x1024.png` (resized to 16x16, desaturated when paused)
- NSIS installer icon: `assets/branding/icon_non_transparent_382x382.png`
- Onboarding banner: `assets/branding/Nox_text_logo_glowing_2350x1024.png`
- Settings header: `assets/branding/Nox_text_logo_2350x1024.png`
- `Nox_text_1536x1024.png` and `Nox_text_eyes_1536x1024.png` reserved for future use

### Final Installer End-to-End Flow

```
User downloads Nox-Setup.exe
  │
  ├─ Double-click → NSIS installer
  │   ├─ Installs app files (Electron + React dist)
  │   ├─ Installs embedded Python backend (python/, app/, models/)
  │   ├─ Installs small assets (hey_nox.onnx, Piper voice)
  │   ├─ Creates Desktop + Start Menu shortcuts
  │   └─ Runs Nox automatically (runAfterFinish: true)
  │
  ├─ Nox starts → Electron main.js spawns backend
  │   ├─ python/python.exe -m uvicorn main:app --port 8420
  │   └─ NOX_MODELS_DIR=resources/backend/models
  │
  ├─ Backend ready → UI checks onboarding_completed
  │   └─ If false → OnboardingWizard launches
  │
  ├─ Onboarding Wizard:
  │   ├─ Step 1: Ollama check → if missing, auto-download + silent install
  │   │   └─ OllamaSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  │   ├─ Step 1: GPU/CUDA check → show GPU or CPU fallback
  │   ├─ Step 2: Model pull (llama3.1 / qwen2.5 / mistral) with progress
  │   ├─ Step 2: Voice model download (if not bundled)
  │   ├─ Step 3: Microphone test
  │   ├─ Step 4: Wake-word calibration
  │   └─ Step 5: Done → onboarding_completed: true
  │
  └─ Fully functional Nox:
      ├─ Tray icon (mascot, desaturated when paused)
      ├─ Chat with streaming responses
      ├─ Voice pipeline (wake → record → STT → LLM → TTS)
      ├─ Context capture (nox_eye)
      ├─ Autostart (Windows Registry Run-Key)
      └─ No manual Python or Ollama installation needed
```

### Onboarding Wizard

First-run wizard (`OnboardingWizard.jsx`) shown when `onboarding_completed` is false/missing in config:
1. **Welcome** – Ollama status check, GPU/CUDA detection, automatic Ollama installation
   - Downloads `OllamaSetup.exe` from ollama.com with progress bar
   - Silent install: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`
   - 60s timeout with fallback to manual install link
   - GPU check via `torch.cuda.is_available()` + `nvidia-smi` fallback
   - CPU fallback clearly indicated if CUDA unavailable
2. **Model selection** – Dropdown from `/api/models`, or pull with real-time progress
   - Quick-pull buttons for `llama3.1`, `qwen2.5`, `mistral`
   - Ollama pull progress streamed via `/api/onboarding/pull-status` polling
   - Voice model (wake word) download with progress bar
3. **Microphone test** – Auto-detect via `/api/status`
4. **Wake-Word calibration** – Model existence check + 3× detection test
5. **Done** – Sets `onboarding_completed: true`

**Onboarding API Endpoints:**
- `GET /api/onboarding/gpu-check` – CUDA availability, GPU name, torch version, nvidia-smi
- `POST /api/onboarding/install-ollama` – Start async Ollama download + silent install
- `GET /api/onboarding/install-status` – Poll install progress (phase, progress 0-1, error)
- `POST /api/onboarding/pull-ollama-model` – Start async `ollama pull` via Ollama API
- `GET /api/onboarding/pull-status` – Poll model pull progress
- `POST /api/onboarding/download-model` – Start async model file download (Whisper/Piper/wakeword)
- `GET /api/onboarding/download-status` – Poll download progress
