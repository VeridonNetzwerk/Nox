const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  nativeTheme,
  screen,
  ipcMain,
  net,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { createTrayIcon } = require("../build/icon");
const { checkAndUpgradeCuda } = require("../build/cuda-upgrade");
const { checkForUpdates, downloadAndInstallInstaller, runInstaller, APP_VERSION } = require("../updater/updater");

// ---------------------------------------------------------------------------
// File logging — writes to %APPDATA%/Nox/logs/nox-electron.log
// ---------------------------------------------------------------------------
const LOG_DIR = path.join(app.getPath("userData"), "..", "Nox", "logs");
// Fallback: if userData doesn't work, use temp
let logFile;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logFile = path.join(LOG_DIR, "nox-electron.log");
} catch {
  const tmpDir = require("os").tmpdir();
  logFile = path.join(tmpDir, "nox-electron.log");
}

const logStream = fs.createWriteStream(logFile, { flags: "a" });
const origLog = console.log;
const origError = console.error;

function writeLog(level, args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const line = `[${ts}] [${level}] ${msg}\n`;
  logStream.write(line);
  if (level === "ERROR") origError(msg);
  else origLog(msg);
}

console.log = (...args) => writeLog("INFO", args);
console.error = (...args) => writeLog("ERROR", args);

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

// Set AppUserModelID so Windows groups all Nox processes under one taskbar entry
if (process.platform === "win32") {
  app.setAppUserModelId("com.nox.assistant");
}

console.log("========== Nox Electron starting ==========");
console.log("App path:", app.getAppPath());
console.log("userData:", app.getPath("userData"));
console.log("isPackaged:", app.isPackaged);
console.log("Log file:", logFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Main window (Gemini-style chat)
const MAIN_WINDOW_WIDTH = 900;
const MAIN_WINDOW_HEIGHT = 680;
const MAIN_WINDOW_MIN_WIDTH = 600;
const MAIN_WINDOW_MIN_HEIGHT = 500;

// Overlay window (compact Hey Nox popup)
const OVERLAY_WINDOW_WIDTH = 380;
const OVERLAY_WINDOW_HEIGHT = 600;
const WINDOW_MARGIN = 8;
let currentScale = 1.0;
const HOTKEY = "CommandOrControl+Shift+Space";
const ANIMATION_DURATION = 200;
const BACKEND_URL = "http://127.0.0.1:8420";
const BOOTSTRAP_URL = "http://127.0.0.1:8421";
let bootstrapProcess = null;
let depsInstalled = null; // null = unknown, true/false = checked

// ---------------------------------------------------------------------------
// Backend helpers
// ---------------------------------------------------------------------------

function postBackend(path) {
  const request = net.request({
    method: "POST",
    url: `${BACKEND_URL}${path}`,
  });
  request.on("error", (err) => console.error("Backend request failed:", err));
  request.end();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mainWindow = null;       // Large Gemini-style chat window
let overlayWindow = null;    // Compact Hey Nox popup window
let tray = null;
let isQuitting = false;
let suppressBlur = false;
let lastShowTime = 0;
let isThinking = false; // Don't hide overlay while Nox is generating a response
let isOnboardingActive = true; // Assume onboarding is active until frontend confirms otherwise
let isVoiceActive = false; // Don't hide overlay while listening or speaking

// ---------------------------------------------------------------------------
// Screen positioning
// ---------------------------------------------------------------------------

/**
 * Get the display nearest to the mouse cursor.
 * Falls back to primary display if detection fails.
 */
function getDisplayAtCursor() {
  try {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
  } catch {
    return screen.getPrimaryDisplay();
  }
}

/**
 * Calculate overlay window bounds (bottom-right corner, above taskbar).
 */
function calculateOverlayBounds(display) {
  const workArea = display.workArea;
  const w = Math.round(OVERLAY_WINDOW_WIDTH * currentScale);
  const h = Math.round(OVERLAY_WINDOW_HEIGHT * currentScale);
  const x = Math.round(workArea.x + workArea.width - w - WINDOW_MARGIN);
  const y = Math.round(workArea.y + workArea.height - h - WINDOW_MARGIN);
  return { x, y, width: w, height: h };
}

/**
 * Calculate main window bounds (centered on primary display).
 */
function calculateMainBounds(display) {
  const workArea = display.workArea;
  const w = Math.min(MAIN_WINDOW_WIDTH, workArea.width - 80);
  const h = Math.min(MAIN_WINDOW_HEIGHT, workArea.height - 80);
  const x = Math.round(workArea.x + (workArea.width - w) / 2);
  const y = Math.round(workArea.y + (workArea.height - h) / 2);
  return { x, y, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Window management — Main window (Gemini-style chat)
// ---------------------------------------------------------------------------

function getDevUrl(mode) {
  return `http://localhost:5173/?mode=${mode}`;
}

function getProdIndexPath() {
  return path.join(__dirname, "..", "dist", "index.html");
}

function createMainWindow() {
  const display = screen.getPrimaryDisplay();
  const bounds = calculateMainBounds(display);

  const debugFlag = path.join(app.getPath("userData"), "..", "Nox", "debug.enabled");
  const isDebug = fs.existsSync(debugFlag) || !app.isPackaged;

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    frame: true,
    transparent: false,
    resizable: true,
    show: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    backgroundColor: "#1b1c1d",
    title: "Nox",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(getDevUrl("main"));
  } else {
    const indexPath = getProdIndexPath();
    console.log("Main window: loading", indexPath);
    mainWindow.loadFile(indexPath, { query: { mode: "main" } });
  }

  if (fs.existsSync(debugFlag)) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("Main window: loaded");
  });
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDesc, validatedURL) => {
    console.error("Main window: did-fail-load —", errorCode, errorDesc, validatedURL);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    console.log(`[Main UI ${levels[level] || level}] ${sourceId}:${line} — ${message}`);
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  sendTheme();
}

// ---------------------------------------------------------------------------
// Window management — Overlay window (compact Hey Nox popup)
// ---------------------------------------------------------------------------

function createOverlayWindow() {
  const display = getDisplayAtCursor();
  const bounds = calculateOverlayBounds(display);

  const debugFlag = path.join(app.getPath("userData"), "..", "Nox", "debug.enabled");
  const isDebug = fs.existsSync(debugFlag) || !app.isPackaged;

  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    show: false, // Hidden by default — only shows on hotkey or wake word
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");

  if (!app.isPackaged) {
    overlayWindow.loadURL(getDevUrl("overlay"));
  } else {
    const indexPath = getProdIndexPath();
    overlayWindow.loadFile(indexPath, { query: { mode: "overlay" } });
  }

  if (fs.existsSync(debugFlag)) {
    overlayWindow.webContents.openDevTools({ mode: "detach" });
  }

  overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  overlayWindow.webContents.on("did-finish-load", () => {
    console.log("Overlay window: loaded");
  });
  overlayWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    console.log(`[Overlay UI ${levels[level] || level}] ${sourceId}:${line} — ${message}`);
  });

  // Blur → hide overlay (with suppress flag + timestamp for tray interactions)
  overlayWindow.on("blur", () => {
    if (suppressBlur || isQuitting || !overlayWindow) return;
    if (isThinking) return;
    if (isOnboardingActive) return;
    if (isVoiceActive) return;
    if (Date.now() - lastShowTime < 1000) return;
    hideOverlay();
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("window-show");
}

function hideMainWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  mainWindow.webContents.send("window-hide");
}

function showOverlay() {
  if (!overlayWindow) return;
  lastShowTime = Date.now();

  const display = getDisplayAtCursor();
  const bounds = calculateOverlayBounds(display);
  overlayWindow.setBounds(bounds);

  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setSkipTaskbar(false);
  overlayWindow.webContents.send("window-show");
}

function hideOverlay() {
  if (!overlayWindow) return;
  overlayWindow.webContents.send("window-hide");
  overlayWindow.setSkipTaskbar(true);
  setTimeout(() => {
    if (overlayWindow && !isQuitting) {
      overlayWindow.hide();
    }
  }, ANIMATION_DURATION);
}

function toggleWindow() {
  // Hotkey toggles the overlay (compact Hey Nox popup)
  if (!overlayWindow) return;
  if (overlayWindow.isVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

let themePreference = "system"; // "system" | "dark" | "light"

function applyThemePreference(pref) {
  themePreference = pref || "system";
  if (themePreference === "dark") {
    nativeTheme.themeSource = "dark";
  } else if (themePreference === "light") {
    nativeTheme.themeSource = "light";
  } else {
    nativeTheme.themeSource = "system";
  }
  sendTheme();
}

function sendTheme() {
  const isDark = themePreference === "dark" || (themePreference === "system" && nativeTheme.shouldUseDarkColors);
  const theme = isDark ? "dark" : "light";
  if (mainWindow) mainWindow.webContents.send("theme-changed", theme);
  if (overlayWindow) overlayWindow.webContents.send("theme-changed", theme);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  tray = new Tray(createTrayIcon(false));
  tray.setToolTip("Nox – Lokaler KI-Assistent");

  const buildMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Hauptfenster öffnen",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          showMainWindow();
        },
      },
      {
        label: "Schnellzugriff (Hey Nox)",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          showOverlay();
        },
      },
      { type: "separator" },
      {
        label: "Einstellungen",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          showMainWindow();
          if (mainWindow) mainWindow.webContents.send("open-settings");
        },
      },
      {
        label: "Beenden",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };

  buildMenu();

  tray.on("click", () => {
    suppressBlur = true;
    setTimeout(() => {
      suppressBlur = false;
    }, 250);
    // Tray click toggles main window
    if (mainWindow && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });

  // Explicit right-click handler — some Windows/AV sandbox combinations
  // suppress the default context menu, so we pop it up manually.
  tray.on("right-click", () => {
    tray.popUpContextMenu();
  });
}

// ---------------------------------------------------------------------------
// Backend process management
// ---------------------------------------------------------------------------

let backendProcess = null;
let backendRestartCount = 0;
let backendIntentionallyStopped = false;
const MAX_BACKEND_RESTARTS = 5;
const BACKEND_RESTART_DELAY = 5000; // 5s base, grows with retries

function startBackend() {
  backendIntentionallyStopped = false;
  if (!app.isPackaged) {
    spawnDevBackend();
  } else {
    spawnBackend();
  }
}

function spawnDevBackend() {
  // Dev mode: spawn backend from source tree using system Python
  const backendDir = path.resolve(__dirname, "..", "..", "..", "backend", "core");
  console.log("Dev mode – starting backend from source:", backendDir);

  const env = {
    ...process.env,
    APPUSERMODELID: "com.nox.assistant",
  };

  backendProcess = spawn("py", [
    "-m", "uvicorn", "main:app",
    "--host", "127.0.0.1",
    "--port", "8420",
    "--app-dir", backendDir,
  ], {
    cwd: backendDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
  });

  backendProcess.stdout.on("data", (data) => console.log("[backend]", data.toString().trim()));
  backendProcess.stderr.on("data", (data) => console.error("[backend]", data.toString().trim()));

  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
    if (backendIntentionallyStopped) return;
    if (backendRestartCount < MAX_BACKEND_RESTARTS) {
      const delay = BACKEND_RESTART_DELAY * (backendRestartCount + 1);
      console.log(`Backend crashed (code ${code}). Restarting in ${delay / 1000}s...`);
      backendRestartCount++;
      setTimeout(spawnDevBackend, delay);
    }
  });

  backendProcess.on("error", (err) => {
    console.error("Backend spawn error:", err);
    backendProcess = null;
  });
}

function spawnBackend() {
  // Production: use embedded Python backend from extraResources
  const backendDir = path.join(process.resourcesPath, "backend");
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  // Linux: check venv first, then embedded, then system python3
  // Windows: embedded Python
  let pythonExe;
  if (isLinux) {
    const venvPython = path.join(backendDir, ".venv", "bin", "python3");
    const optVenvPython = "/opt/Nox/backend/.venv/bin/python3";
    if (fs.existsSync(venvPython)) {
      pythonExe = venvPython;
    } else if (fs.existsSync(optVenvPython)) {
      pythonExe = optVenvPython;
    } else {
      pythonExe = path.join(backendDir, "python", "bin", "python3");
    }
  } else {
    pythonExe = path.join(backendDir, "python", "python.exe");
  }
  const launcherBat = path.join(backendDir, "nox-backend.bat");
  const launcherSh = path.join(backendDir, "nox-backend.sh");
  const appDir = path.join(backendDir, "app");

  console.log(`Starting backend (attempt ${backendRestartCount + 1}) from:`, backendDir);
  console.log("  pythonExe exists:", fs.existsSync(pythonExe), pythonExe);
  console.log("  appDir exists:", fs.existsSync(appDir), appDir);
  console.log("  resourcesPath:", process.resourcesPath);

  if (fs.existsSync(pythonExe)) {
    // Embedded Python path
    const modelsDir = path.join(backendDir, "models");
    const env = {
      ...process.env,
      PYTHONPATH: appDir,
      NOX_MODELS_DIR: modelsDir,
      APPUSERMODELID: "com.nox.assistant",
    };
    const isDev = !app.isPackaged;
    const uvicornArgs = [
      "-m", "uvicorn", "main:app",
      "--host", "127.0.0.1",
      "--port", "8420",
      "--app-dir", appDir,
    ];
    if (isDev) uvicornArgs.push("--reload");
    backendProcess = spawn(pythonExe, uvicornArgs, {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
  } else if (isWin && fs.existsSync(launcherBat)) {
    // Fallback: launcher.bat (Windows)
    backendProcess = spawn("cmd.exe", ["/c", launcherBat], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } else if (isLinux && fs.existsSync(launcherSh)) {
    // Fallback: launcher.sh (Linux)
    backendProcess = spawn("bash", [launcherSh], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else if (isLinux) {
    // Linux fallback — check venv first, then system python3
    const sysBackendDir = fs.existsSync("/opt/Nox/backend") ? "/opt/Nox/backend" : backendDir;
    const sysAppDir = sysBackendDir;
    const sysModelsDir = path.join(sysBackendDir, "..", "models");
    const venvPython = path.join(sysBackendDir, ".venv", "bin", "python3");
    const sysPython = fs.existsSync(venvPython) ? venvPython : "python3";
    const env = {
      ...process.env,
      PYTHONPATH: sysAppDir,
      NOX_MODELS_DIR: sysModelsDir,
      APPUSERMODELID: "com.nox.assistant",
    };
    console.log("Trying python from:", sysBackendDir, "exe:", sysPython);
    const isDevLinux = !app.isPackaged;
    const uvicornArgsLinux = [
      "-m", "uvicorn", "main:app",
      "--host", "127.0.0.1",
      "--port", "8420",
      "--app-dir", sysAppDir,
    ];
    if (isDevLinux) uvicornArgsLinux.push("--reload");
    backendProcess = spawn(sysPython, uvicornArgsLinux, {
      cwd: sysAppDir,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  } else {
    console.error("No backend found at", backendDir);
    console.error("Backend dir contents:", fs.existsSync(backendDir) ? fs.readdirSync(backendDir) : "DIR NOT FOUND");
    return;
  }

  backendProcess.stdout.on("data", (data) => console.log("[backend]", data.toString().trim()));
  backendProcess.stderr.on("data", (data) => console.error("[backend]", data.toString().trim()));

  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;

    if (backendIntentionallyStopped) return;

    // Auto-restart: sandbox or AV may have killed the process
    if (backendRestartCount < MAX_BACKEND_RESTARTS) {
      const delay = BACKEND_RESTART_DELAY * (backendRestartCount + 1);
      console.log(`Backend crashed (code ${code}). Restarting in ${delay / 1000}s... (attempt ${backendRestartCount + 2}/${MAX_BACKEND_RESTARTS})`);
      backendRestartCount++;
      setTimeout(spawnBackend, delay);
    } else {
      console.error(`Backend failed ${MAX_BACKEND_RESTARTS} times. Giving up. Try restarting Nox manually.`);
    }
  });

  backendProcess.on("error", (err) => {
    console.error("Backend spawn error:", err);
    backendProcess = null;

    if (backendIntentionallyStopped) return;

    if (backendRestartCount < MAX_BACKEND_RESTARTS) {
      const delay = BACKEND_RESTART_DELAY * (backendRestartCount + 1);
      console.log(`Backend spawn failed. Retrying in ${delay / 1000}s...`);
      backendRestartCount++;
      setTimeout(spawnBackend, delay);
    }
  });
}

function stopBackend() {
  backendIntentionallyStopped = true;
  if (backendProcess) {
    console.log("Stopping backend process...");
    // On Windows, kill the process tree (child processes of python.exe)
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", backendProcess.pid, "/f", "/t"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        backendProcess.kill();
      }
    } catch (err) {
      console.error("Failed to kill backend:", err);
      try { backendProcess.kill(); } catch {}
    }
    backendProcess = null;
  } else if (!app.isPackaged) {
    // Dev mode: backend is started externally — don't kill it.
    console.log("Dev mode – backend expected to be running externally on port 8420");
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Check if onboarding has been completed by querying the backend
// Extra retries and longer delays to survive AV/sandbox scanning
let onboardingRetryCount = 0;
const MAX_ONBOARDING_RETRIES = 30; // 30 × 3s = 90s max wait for sandbox scanning

// Local first-run flag — more reliable than backend API for onboarding decision
const userDataDir = app.getPath("userData");
const firstRunFlag = path.join(userDataDir, "onboarding-done");

// In dev mode, always delete the onboarding flag so the wizard shows every start
if (!app.isPackaged) {
  try {
    if (fs.existsSync(firstRunFlag)) {
      fs.unlinkSync(firstRunFlag);
      console.log("Dev mode: onboarding-done flag deleted");
    }
  } catch (err) {
    console.error("Failed to delete onboarding flag:", err);
  }
}

function isFirstRun() {
  return !fs.existsSync(firstRunFlag);
}

function markOnboardingDone() {
  try {
    fs.writeFileSync(firstRunFlag, "done");
  } catch (err) {
    console.error("Failed to write onboarding flag:", err);
  }
}

function checkOnboardingAndShow() {
  // Primary check: local flag file (doesn't depend on backend)
  if (isFirstRun()) {
    console.log("First run detected (local flag) — showing main window for onboarding");
    showMainWindow();
    return;
  }

  // Secondary check: backend API (for cases where flag exists but onboarding was reset)
  if (onboardingRetryCount > MAX_ONBOARDING_RETRIES) {
    console.error(`Backend not reachable after ${MAX_ONBOARDING_RETRIES} retries — showing main window anyway`);
    showMainWindow();
    return;
  }
  onboardingRetryCount++;
  const http = require("http");
  const req = http.get(`${BACKEND_URL}/api/settings`, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const onboardingDone = parsed?.settings?.onboarding_completed === true;
        if (!onboardingDone) {
          console.log("Onboarding not completed (backend) — showing main window");
          showMainWindow();
        }
      } catch {
        setTimeout(checkOnboardingAndShow, 3000);
      }
    });
  });
  req.on("error", () => {
    setTimeout(checkOnboardingAndShow, 3000);
  });
  req.setTimeout(5000, () => {
    req.destroy();
    setTimeout(checkOnboardingAndShow, 3000);
  });
}

// Single-instance lock — prevents port conflicts when AV launches a second instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("Another instance of Nox is already running — quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to launch a second instance — show main window
    showMainWindow();
  });
}

// Workaround for GPU process crash (exitCode 18) on some Windows/NVIDIA setups
app.commandLine.appendSwitch("disable-gpu-process-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.disableHardwareAcceleration();

function checkDepsInstalled() {
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.get(`${BOOTSTRAP_URL}/api/bootstrap/status`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.deps_installed === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

function startBootstrapServer() {
  if (!app.isPackaged) return;
  const backendDir = path.join(process.resourcesPath, "backend");
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const pythonExe = isWin
    ? path.join(backendDir, "python", "python.exe")
    : path.join(backendDir, "python", "bin", "python3");
  const appDir = path.join(backendDir, "app");
  const bootstrapScript = path.join(appDir, "bootstrap_server.py");

  // On Linux, try system python3 if embedded Python not found
  let usePython = pythonExe;
  let useAppDir = appDir;
  let useCwd = appDir;

  if (isLinux && !fs.existsSync(pythonExe)) {
    // Try /opt/Nox/backend (deb install) or backendDir directly
    if (fs.existsSync("/opt/Nox/backend/bootstrap_server.py")) {
      usePython = "python3";
      useAppDir = "/opt/Nox/backend";
      useCwd = "/opt/Nox/backend";
    } else if (fs.existsSync(path.join(backendDir, "bootstrap_server.py"))) {
      usePython = "python3";
      useAppDir = backendDir;
      useCwd = backendDir;
    } else {
      console.error("Bootstrap: bootstrap_server.py not found");
      return;
    }
  } else if (!fs.existsSync(pythonExe) || !fs.existsSync(bootstrapScript)) {
    console.error("Bootstrap: python or bootstrap_server.py not found", pythonExe);
    return;
  }

  console.log("Starting bootstrap server for dependency installation...");
  bootstrapProcess = spawn(usePython, [path.join(useAppDir, "bootstrap_server.py")], {
    cwd: useCwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONPATH: useAppDir,
      APPUSERMODELID: "com.nox.assistant",
    },
  });

  bootstrapProcess.stdout.on("data", (data) => console.log("[bootstrap]", data.toString().trim()));
  bootstrapProcess.stderr.on("data", (data) => console.error("[bootstrap]", data.toString().trim()));
  bootstrapProcess.on("exit", (code) => {
    console.log(`Bootstrap server exited with code ${code}`);
    bootstrapProcess = null;
  });
}

function stopBootstrapServer() {
  if (bootstrapProcess) {
    console.log("Stopping bootstrap server...");
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", bootstrapProcess.pid, "/f", "/t"], {
          windowsHide: true, stdio: "ignore",
        });
      } else {
        bootstrapProcess.kill();
      }
    } catch {}
    bootstrapProcess = null;
  }
}

app.whenReady().then(async () => {
  // Check for GPU (only in production)
  if (app.isPackaged) {
    const backendDir = path.join(process.resourcesPath, "backend");
    const cudaResult = await checkAndUpgradeCuda(backendDir, (line) => {
      console.log("GPU detection:", line);
    });
    if (cudaResult.gpuName) {
      console.log(`GPU detected: ${cudaResult.gpuName}`);
    }

    // Start bootstrap server to check/install deps
    startBootstrapServer();

    // Wait a moment for bootstrap server to start, then check deps
    await new Promise(resolve => setTimeout(resolve, 2000));
    depsInstalled = await checkDepsInstalled();
    console.log(`Deps installed: ${depsInstalled}`);

    if (depsInstalled) {
      // Deps already installed — stop bootstrap, start real backend
      stopBootstrapServer();
      startBackend();
    } else {
      // Deps not installed — keep bootstrap running, UI will show setup screen
      console.log("Dependencies not installed — showing setup screen");
    }
  } else {
    // Dev mode — backend runs separately
    startBackend();
  }

  createMainWindow();
  createOverlayWindow();
  createTray();

  // Fetch theme preference from backend
  try {
    const res = await net.fetch("http://127.0.0.1:8420/api/settings");
    const data = await res.json();
    if (data.ui_theme) {
      applyThemePreference(data.ui_theme);
    }
  } catch (err) {
    // Backend might not be ready yet — default to system
    console.log("Could not fetch theme preference on startup:", err.message);
  }

  // Show main window on first launch so onboarding wizard is visible
  if (!app.isPackaged) {
    setTimeout(checkOnboardingAndShow, 1500);
  } else {
    // Production: show main window immediately so setup/onboarding UI is visible
    setTimeout(() => {
      showMainWindow();
      if (depsInstalled !== false) {
        checkOnboardingAndShow();
      }
    }, 2000);
  }

  // Global hotkey
  const registered = globalShortcut.register(HOTKEY, () => toggleWindow());
  if (!registered) {
    console.error("Failed to register global hotkey:", HOTKEY);
  }

  // Theme change listener
  nativeTheme.on("updated", () => sendTheme());

  // IPC from renderer — window visibility
  // hide-window/show-window control the overlay (compact popup)
  ipcMain.on("hide-window", () => hideOverlay());
  ipcMain.on("show-window", () => showOverlay());
  // wake-show-window: only show overlay if main window is NOT visible/focused
  ipcMain.on("wake-show-window", () => {
    if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) {
      // Main window is open — don't show overlay, just let MainApp handle it
      console.log("Wake word: main window is open — skipping overlay");
      return;
    }
    showOverlay();
  });
  ipcMain.on("is-main-window-visible", (event) => {
    event.returnValue = !!(mainWindow && mainWindow.isVisible() && mainWindow.isFocused());
  });
  ipcMain.on("close-app", () => {
    isQuitting = true;
    app.quit();
  });
  ipcMain.on("close-window", () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.on("onboarding-complete", () => {
    markOnboardingDone();
    isOnboardingActive = false;
    console.log("Onboarding completed — flag written");
  });
  ipcMain.on("onboarding-active", () => {
    isOnboardingActive = true;
    console.log("Onboarding active — overlay will stay visible and on top");
  });
  ipcMain.on("onboarding-not-needed", () => {
    isOnboardingActive = false;
    console.log("Onboarding not needed — overlay can hide normally");
  });
  ipcMain.on("deps-installed", () => {
    console.log("Deps installed — restarting real backend...");
    stopBootstrapServer();
    // Reset restart count since this is a fresh start
    backendRestartCount = 0;
    startBackend();
  });
  ipcMain.on("thinking-state", (_e, thinking) => {
    isThinking = thinking;
    if (overlayWindow) overlayWindow.setAlwaysOnTop(thinking || isVoiceActive || isOnboardingActive, "screen-saver");
    console.log("Thinking state:", thinking);
    // If no longer thinking/voice and overlay lost focus while blocked, hide now
    if (!thinking && !isVoiceActive && !isOnboardingActive && overlayWindow && !overlayWindow.isFocused()) {
      hideOverlay();
    }
  });
  ipcMain.on("voice-state", (_e, active) => {
    isVoiceActive = active;
    if (overlayWindow) overlayWindow.setAlwaysOnTop(active || isThinking || isOnboardingActive, "screen-saver");
    console.log("Voice active state:", active);
    // If no longer voice/thinking and overlay lost focus while blocked, hide now
    if (!active && !isThinking && !isOnboardingActive && overlayWindow && !overlayWindow.isFocused()) {
      hideOverlay();
    }
  });
  ipcMain.on("renderer-log", (_e, msg) => console.log(`[RENDERER] ${msg}`));
  ipcMain.on("renderer-error", (_e, msg) => console.error(`[RENDERER ERROR] ${msg}`));
  ipcMain.on("set-theme-preference", (_e, pref) => {
    console.log("Theme preference:", pref);
    applyThemePreference(pref);
  });
  ipcMain.on("update-hotkey", (_, newHotkey) => {
    if (!newHotkey) return;
    globalShortcut.unregisterAll();
    const registered = globalShortcut.register(newHotkey, () => toggleWindow());
    if (!registered) {
      console.error("Failed to register new hotkey:", newHotkey);
    } else {
      console.log("Hotkey updated:", newHotkey);
    }
  });

  // --- Update IPC handlers ---
  ipcMain.handle("update:check", async () => {
    return await checkForUpdates();
  });

  ipcMain.handle("update:download-and-install", async (event) => {
    const info = await checkForUpdates();
    if (!info || info.error || !info.hasUpdate || !info.installer) {
      return { error: "No update available or no installer asset found" };
    }

    try {
      const installerPath = await downloadAndInstallInstaller(
        info.installer.downloadUrl,
        (progress) => {
          if (mainWindow) mainWindow.webContents.send("update:progress", progress);
          if (overlayWindow) overlayWindow.webContents.send("update:progress", progress);
        }
      );
      runInstaller(installerPath);
      return { success: true };
    } catch (err) {
      console.error("Update download/install failed:", err);
      return { error: err.message };
    }
  });

  ipcMain.on("update:open-release-page", () => {
    checkForUpdates().then((info) => {
      if (info && info.releaseUrl) {
        shell.openExternal(info.releaseUrl);
      }
    });
  });

  // IPC: open a file/folder — supports optional line number for editor goto
  // pathToOpen can be a string (path) or { path, line }
  ipcMain.on("open-path", (_e, payload) => {
    if (!payload) return;
    const fs = require("fs");
    const path = require("path");
    const { execSync, spawn } = require("child_process");

    let targetPath, lineNum;
    if (typeof payload === "string") {
      targetPath = payload;
    } else {
      targetPath = payload.path;
      lineNum = payload.line;
    }
    if (!targetPath) return;

    try {
      // Folder → open in Explorer
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        shell.openPath(targetPath);
        return;
      }

      // File with line number → try VS Code --goto
      if (lineNum && fs.existsSync(targetPath)) {
        try {
          const codeCmd = execSync("where code", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim().split("\n")[0].trim();
          if (codeCmd) {
            spawn(codeCmd, ["--goto", `${targetPath}:${lineNum}`], { detached: true, shell: false, stdio: "ignore" });
            return;
          }
        } catch {
          // VS Code not found — fall through to default program
        }
      }

      // File without line or VS Code not available → open with default program
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        shell.openPath(targetPath);
        return;
      }

      // Path doesn't exist — try opening parent folder
      const parent = path.dirname(targetPath);
      if (fs.existsSync(parent)) {
        shell.openPath(parent);
      }
    } catch (err) {
      console.error("Failed to open path:", targetPath, err);
    }
  });

  // IPC: resize overlay window when UI scale changes
  ipcMain.on("resize-window", (_e, scale) => {
    if (!scale) return;
    currentScale = Math.max(0.7, Math.min(1.6, parseFloat(scale)));
    if (overlayWindow) {
      const display = getDisplayAtCursor();
      const bounds = calculateOverlayBounds(display);
      overlayWindow.setBounds(bounds);
    }
    console.log("Overlay resized for scale:", currentScale);
  });

  // Fetch ui_scale from backend after startup and apply it to overlay
  setTimeout(() => {
    const http = require("http");
    const req = http.get(`${BACKEND_URL}/api/settings`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const scale = parsed?.settings?.ui_scale;
          if (scale && !isNaN(parseFloat(scale))) {
            currentScale = Math.max(0.7, Math.min(1.6, parseFloat(scale)));
            if (overlayWindow) {
              const display = getDisplayAtCursor();
              const bounds = calculateOverlayBounds(display);
              overlayWindow.setBounds(bounds);
            }
            console.log("Applied ui_scale from settings:", currentScale);
          }
        } catch {}
      });
    });
    req.on("error", () => {});
    req.setTimeout(3000, () => req.destroy());
  }, 3000);

  // Auto-check for updates on startup (production only, after delay)
  if (app.isPackaged) {
    setTimeout(async () => {
      const info = await checkForUpdates();
      if (info && info.hasUpdate) {
        console.log(`Update notification: v${info.latestVersion} available`);
        const updateData = {
          currentVersion: info.currentVersion,
          latestVersion: info.latestVersion,
          releaseUrl: info.releaseUrl,
          releaseNotes: info.releaseNotes,
          installerSize: info.installer ? info.installer.size : 0,
        };
        if (mainWindow) mainWindow.webContents.send("update:available", updateData);
        if (overlayWindow) overlayWindow.webContents.send("update:available", updateData);
      }
    }, 5000);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopBackend();
});

// Keep app running in tray when window is hidden
app.on("window-all-closed", () => {
  // Do nothing – app stays in tray
});
