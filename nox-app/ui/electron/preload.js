const { contextBridge, ipcRenderer } = require("electron");

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld("nox", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  // Theme
  onThemeChanged: (callback) =>
    ipcRenderer.on("theme-changed", (_, theme) => callback(theme)),

  // Window visibility events
  onWindowShow: (callback) =>
    ipcRenderer.on("window-show", () => callback()),
  onWindowHide: (callback) =>
    ipcRenderer.on("window-hide", () => callback()),

  // Settings
  onOpenSettings: (callback) =>
    ipcRenderer.on("open-settings", () => callback()),

  // Actions
  hideWindow: () => ipcRenderer.send("hide-window"),
  showWindow: () => ipcRenderer.send("show-window"),
  onboardingComplete: () => ipcRenderer.send("onboarding-complete"),
  onboardingActive: () => ipcRenderer.send("onboarding-active"),
  updateHotkey: (hotkey) => ipcRenderer.send("update-hotkey", hotkey),
  setThinkingState: (thinking) => ipcRenderer.send("thinking-state", thinking),
  setVoiceState: (active) => ipcRenderer.send("voice-state", active),

  // Logging — forward renderer logs to main process file logger
  log: (msg) => ipcRenderer.send("renderer-log", msg),
  error: (msg) => ipcRenderer.send("renderer-error", msg),
});

// Forward uncaught renderer errors to main process
window.addEventListener("error", (e) => {
  ipcRenderer.send("renderer-error", `Uncaught: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  ipcRenderer.send("renderer-error", `Unhandled rejection: ${e.reason}`);
});
