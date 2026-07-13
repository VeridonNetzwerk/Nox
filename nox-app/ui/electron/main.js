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
const { createTrayIcon } = require("./icon");
const { checkAndUpgradeCuda } = require("./cuda-upgrade");
const { checkForUpdates, downloadAndInstallInstaller, runInstaller, APP_VERSION } = require("./updater");

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

console.log("========== Nox Electron starting ==========");
console.log("App path:", app.getAppPath());
console.log("userData:", app.getPath("userData"));
console.log("isPackaged:", app.isPackaged);
console.log("Log file:", logFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 600;
const WINDOW_MARGIN = 8;
const HOTKEY = "CommandOrControl+Shift+Space";
const ANIMATION_DURATION = 200;
const BACKEND_URL = "http://127.0.0.1:8420";

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

let mainWindow = null;
let tray = null;
let isQuitting = false;
let suppressBlur = false;
let lastShowTime = 0;
let isThinking = false; // Don't hide window while Nox is generating a response
let isOnboardingActive = true; // Assume onboarding is active until frontend confirms otherwise
let isVoiceActive = false; // Don't hide window while listening or speaking

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
 * Calculate window bounds so the window sits at the bottom-right corner
 * of the given display's work area (above the taskbar).
 */
function calculateBounds(display) {
  const workArea = display.workArea;
  const x = Math.round(workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN);
  const y = Math.round(workArea.y + workArea.height - WINDOW_HEIGHT - WINDOW_MARGIN);
  return { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

function createWindow() {
  const display = getDisplayAtCursor();
  const bounds = calculateBounds(display);

  // Debug mode: check if a debug flag file exists
  const debugFlag = path.join(app.getPath("userData"), "..", "Nox", "debug.enabled");
  const isDebug = fs.existsSync(debugFlag) || !app.isPackaged;
  console.log("Debug mode:", isDebug, "(flag:", debugFlag, ")");

  mainWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    show: isDebug, // Show immediately in dev (transparent bg prevents gray box)
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(!isDebug, "screen-saver");

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    console.log("Loading production index.html from:", indexPath);
    console.log("File exists:", fs.existsSync(indexPath));
    if (fs.existsSync(indexPath)) {
      console.log("index.html content (first 500 chars):", fs.readFileSync(indexPath, "utf8").substring(0, 500));
    }
    // List dist directory
    const distDir = path.join(__dirname, "..", "dist");
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      console.log("dist/ contents:", files);
      const assetsDir = path.join(distDir, "assets");
      if (fs.existsSync(assetsDir)) {
        console.log("dist/assets/ contents:", fs.readdirSync(assetsDir));
      }
    } else {
      console.error("dist directory does NOT exist:", distDir);
    }
    mainWindow.loadFile(indexPath);
  }

  // Open DevTools only when debug flag file exists
  if (fs.existsSync(debugFlag)) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Open external links (e.g. GitHub) in system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Log load events for debugging
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("UI: did-finish-load — page loaded successfully");
  });
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDesc, validatedURL) => {
    console.error("UI: did-fail-load — errorCode:", errorCode, "desc:", errorDesc, "url:", validatedURL);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("UI: render-process-gone —", JSON.stringify(details));
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
    console.log(`UI[${levels[level] || level}] ${sourceId}:${line} — ${message}`);
  });

  // Blur → hide (with suppress flag + timestamp for tray interactions)
  mainWindow.on("blur", () => {
    if (suppressBlur || isQuitting || !mainWindow) return;
    // Don't hide while Nox is thinking/generating a response
    if (isThinking) return;
    // Don't hide while onboarding wizard is active
    if (isOnboardingActive) return;
    // Don't hide while Nox is listening or speaking
    if (isVoiceActive) return;
    // Ignore blur within 1s of showWindow (tray menu close delay)
    if (Date.now() - lastShowTime < 1000) return;
    hideWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Send initial theme
  sendTheme();
}

function showWindow() {
  if (!mainWindow) return;
  lastShowTime = Date.now();

  // Reposition at current cursor's display
  const display = getDisplayAtCursor();
  const bounds = calculateBounds(display);
  mainWindow.setBounds(bounds);

  mainWindow.show();
  mainWindow.focus();
  // Re-apply always-on-top after show (Windows can drop it)
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.webContents.send("window-show");
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.webContents.send("window-hide");
  setTimeout(() => {
    if (mainWindow && !isQuitting) {
      mainWindow.hide();
    }
  }, ANIMATION_DURATION);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function sendTheme() {
  if (!mainWindow) return;
  const isDark = nativeTheme.shouldUseDarkColors;
  mainWindow.webContents.send("theme-changed", isDark ? "dark" : "light");
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
        label: "Öffnen",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          showWindow();
        },
      },
      {
        label: "Schließen",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          hideWindow();
        },
      },
      { type: "separator" },
      {
        label: "Einstellungen",
        click: () => {
          suppressBlur = true;
          setTimeout(() => { suppressBlur = false; }, 500);
          showWindow();
          mainWindow.webContents.send("open-settings");
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
    toggleWindow();
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
  // In dev mode, backend runs separately via `npm run dev:backend`
  if (!app.isPackaged) {
    console.log("Dev mode – backend expected to run separately via npm run dev:backend");
    return;
  }

  backendIntentionallyStopped = false;
  spawnBackend();
}

function spawnBackend() {
  // Production: use embedded Python backend from extraResources
  const backendDir = path.join(process.resourcesPath, "backend");
  const launcherBat = path.join(backendDir, "nox-backend.bat");
  const pythonExe = path.join(backendDir, "python", "python.exe");
  const appDir = path.join(backendDir, "app");

  console.log(`Starting backend (attempt ${backendRestartCount + 1}) from:`, backendDir);
  console.log("  pythonExe exists:", fs.existsSync(pythonExe), pythonExe);
  console.log("  launcherBat exists:", fs.existsSync(launcherBat), launcherBat);
  console.log("  appDir exists:", fs.existsSync(appDir), appDir);
  console.log("  resourcesPath:", process.resourcesPath);

  if (fs.existsSync(pythonExe)) {
    // Embedded Python path
    const modelsDir = path.join(backendDir, "models");
    const env = {
      ...process.env,
      PYTHONPATH: appDir,
      NOX_MODELS_DIR: modelsDir,
    };
    backendProcess = spawn(pythonExe, [
      "-m", "uvicorn", "main:app",
      "--host", "127.0.0.1",
      "--port", "8420",
      "--app-dir", appDir,
    ], {
      cwd: appDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env,
    });
  } else if (fs.existsSync(launcherBat)) {
    // Fallback: launcher.bat
    backendProcess = spawn("cmd.exe", ["/c", launcherBat], {
      cwd: backendDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
    // Dev mode: backend was started externally (npm run dev:backend via concurrently).
    // Kill any process still listening on port 8420.
    console.log("Dev mode – killing any process on port 8420...");
    try {
      spawn("taskkill", ["/f", "/t", "/fi", "WINDOWTITLE eq *uvicorn*"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch (err) {
      console.error("Failed to kill dev backend:", err);
    }
    // Also try via netstat + taskkill (more reliable for finding port listeners)
    try {
      const { execSync } = require("child_process");
      const out = execSync('netstat -ano | findstr ":8420" | findstr "LISTENING"', {
        windowsHide: true,
        encoding: "utf8",
      });
      const pids = new Set();
      for (const line of out.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        console.log(`Killing backend PID ${pid} on port 8420`);
        spawn("taskkill", ["/pid", pid, "/f", "/t"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
    } catch (err) {
      // netstat might fail if no process is on the port — that's fine
    }
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
    console.log("First run detected (local flag) — showing window for onboarding");
    showWindow();
    return;
  }

  // Secondary check: backend API (for cases where flag exists but onboarding was reset)
  if (onboardingRetryCount > MAX_ONBOARDING_RETRIES) {
    console.error(`Backend not reachable after ${MAX_ONBOARDING_RETRIES} retries — showing window anyway`);
    showWindow();
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
          console.log("Onboarding not completed (backend) — showing window");
          showWindow();
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
    // Someone tried to launch a second instance — show our window
    showWindow();
  });
}

// Workaround for GPU process crash (exitCode 18) on some Windows/NVIDIA setups
app.commandLine.appendSwitch("disable-gpu-process-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // Check for CUDA upgrade before starting backend (only in production)
  if (app.isPackaged) {
    const backendDir = path.join(process.resourcesPath, "backend");
    const cudaResult = await checkAndUpgradeCuda(backendDir, (line) => {
      console.log("CUDA upgrade:", line);
    });
    if (cudaResult.needed) {
      console.log(`CUDA upgrade result: success=${cudaResult.success}, gpu=${cudaResult.gpuName}`);
    }
  }

  startBackend();
  createWindow();
  createTray();

  // Show window on first launch so onboarding wizard is visible
  // In production: always show window immediately so we can see if UI loaded
  if (!app.isPackaged) {
    setTimeout(checkOnboardingAndShow, 1500);
  } else {
    // Production: show window immediately, don't wait for backend
    console.log("Production mode — showing window immediately for debugging");
    setTimeout(() => {
      showWindow();
      checkOnboardingAndShow();
    }, 2000);
  }

  // Global hotkey
  const registered = globalShortcut.register(HOTKEY, () => toggleWindow());
  if (!registered) {
    console.error("Failed to register global hotkey:", HOTKEY);
  }

  // Theme change listener
  nativeTheme.on("updated", () => sendTheme());

  // IPC from renderer
  ipcMain.on("hide-window", () => hideWindow());
  ipcMain.on("show-window", () => showWindow());
  ipcMain.on("onboarding-complete", () => {
    markOnboardingDone();
    isOnboardingActive = false;
    if (mainWindow) {
      const isDebug = !app.isPackaged;
      mainWindow.setAlwaysOnTop(!isDebug, "screen-saver");
    }
    console.log("Onboarding completed — flag written");
  });
  ipcMain.on("onboarding-active", () => {
    isOnboardingActive = true;
    if (mainWindow) mainWindow.setAlwaysOnTop(true, "screen-saver");
    console.log("Onboarding active — window will stay visible and on top");
  });
  ipcMain.on("onboarding-not-needed", () => {
    isOnboardingActive = false;
    if (mainWindow) {
      const isDebug = !app.isPackaged;
      mainWindow.setAlwaysOnTop(!isDebug, "screen-saver");
    }
    console.log("Onboarding not needed — window can hide normally");
  });
  ipcMain.on("thinking-state", (_e, thinking) => {
    isThinking = thinking;
    if (mainWindow) mainWindow.setAlwaysOnTop(thinking || isVoiceActive || isOnboardingActive, "screen-saver");
    console.log("Thinking state:", thinking);
  });
  ipcMain.on("voice-state", (_e, active) => {
    isVoiceActive = active;
    if (mainWindow) mainWindow.setAlwaysOnTop(active || isThinking || isOnboardingActive, "screen-saver");
    console.log("Voice active state:", active);
  });
  ipcMain.on("renderer-log", (_e, msg) => console.log(`[RENDERER] ${msg}`));
  ipcMain.on("renderer-error", (_e, msg) => console.error(`[RENDERER ERROR] ${msg}`));
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
          if (mainWindow) {
            mainWindow.webContents.send("update:progress", progress);
          }
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

  // Auto-check for updates on startup (production only, after delay)
  if (app.isPackaged) {
    setTimeout(async () => {
      const info = await checkForUpdates();
      if (info && info.hasUpdate && mainWindow) {
        console.log(`Update notification: v${info.latestVersion} available`);
        mainWindow.webContents.send("update:available", {
          currentVersion: info.currentVersion,
          latestVersion: info.latestVersion,
          releaseUrl: info.releaseUrl,
          releaseNotes: info.releaseNotes,
          installerSize: info.installer ? info.installer.size : 0,
        });
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
