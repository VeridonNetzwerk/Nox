import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogo from "../assets/nox-logo.png";
import { useToast } from "./Toast.jsx";

const API_BASE = "http://127.0.0.1:8420";

function SettingsPanel({ locale, onClose }) {
  const { addToast } = useToast();
  const s = locale.settings;
  const [settings, setSettings] = useState({});
  const [models, setModels] = useState([]);
  const [autostart, setAutostart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newExcludedApp, setNewExcludedApp] = useState("");
  const [audioDevices, setAudioDevices] = useState({ input: [], output: [] });
  const [installedVoices, setInstalledVoices] = useState([]);
  const [previewPlaying, setPreviewPlaying] = useState(null);
  const previewAudioRef = useRef(null);
  const [testingInput, setTestingInput] = useState(false);
  const [testingOutput, setTestingOutput] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newExcludedDir, setNewExcludedDir] = useState("");
  const [filesHealth, setFilesHealth] = useState(null);

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsRes, modelsRes, autostartRes, audioRes, filesRes, voicesRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings`),
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/autostart`),
        fetch(`${API_BASE}/api/audio/devices`),
        fetch(`${API_BASE}/health/files`),
        fetch(`${API_BASE}/api/voices/installed`),
      ]);
      const settingsData = await settingsRes.json();
      const modelsData = await modelsRes.json();
      const autostartData = await autostartRes.json();
      const audioData = await audioRes.json();
      const filesData = await filesRes.json();
      const voicesData = await voicesRes.json();
      if (settingsData.status === "ok") setSettings(settingsData.settings);
      if (modelsData.status === "ok") setModels(modelsData.available_models || []);
      setAutostart(autostartData.enabled || false);
      if (audioData.status === "ok") setAudioDevices({ input: audioData.input || [], output: audioData.output || [] });
      setFilesHealth(filesData);
      if (voicesData.status === "ok") setInstalledVoices(voicesData.installed || []);
    } catch (err) {
      addToast({ type: "error", title: "Einstellungen", message: "Einstellungen konnten nicht geladen werden", detail: String(err), reportable: true });
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = async (key, value) => {
    setSaving(true);
    const updates = { [key]: value };
    setSettings((prev) => ({ ...prev, ...updates }));
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (key === "hotkey" && window.nox?.updateHotkey) {
        window.nox.updateHotkey(value);
      }
    } catch (err) {
      addToast({ type: "error", title: "Einstellungen", message: "Einstellung konnte nicht gespeichert werden", detail: String(err), reportable: true });
    }
    setSaving(false);
  };

  const playVoicePreview = async (voiceName) => {
    if (!voiceName) return;
    const parts = voiceName.split("-");
    if (parts.length < 3) return;
    const langCode = parts[0];
    const quality = parts[parts.length - 1];
    const voiceNamePart = parts.slice(1, -1).join("-");

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewPlaying === voiceName) {
      setPreviewPlaying(null);
      return;
    }

    setPreviewPlaying(voiceName);
    try {
      const res = await fetch(
        `${API_BASE}/api/voices/demo/${langCode}/${voiceNamePart}/${quality}`
      );
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPreviewPlaying(null);
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      };
      audio.onerror = () => {
        setPreviewPlaying(null);
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      };
      await audio.play();
    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewPlaying(null);
    }
  };

  const toggleAutostart = async () => {
    const newVal = !autostart;
    setAutostart(newVal);
    try {
      await fetch(`${API_BASE}/api/autostart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newVal }),
      });
    } catch (err) {
      addToast({ type: "error", title: "Autostart", message: "Autostart konnte nicht geändert werden", detail: String(err), reportable: true });
    }
  };

  const addExcludedApp = () => {
    if (!newExcludedApp.trim()) return;
    const current = settings.nox_eye_excluded_apps || [];
    if (!current.includes(newExcludedApp.trim())) {
      updateSetting("nox_eye_excluded_apps", [...current, newExcludedApp.trim()]);
    }
    setNewExcludedApp("");
  };

  const removeExcludedApp = (app) => {
    const current = settings.nox_eye_excluded_apps || [];
    updateSetting("nox_eye_excluded_apps", current.filter((a) => a !== app));
  };

  const testInputDevice = async () => {
    setTestingInput(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/audio/test-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: settings.audio_input_device || "default" }),
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setTestResult({ type: "input", ok: true, rms: data.rms, peak: data.peak });
      } else {
        setTestResult({ type: "input", ok: false, error: data.error });
      }
    } catch (err) {
      addToast({ type: "error", title: "Audio-Test", message: "Audio-Test fehlgeschlagen", detail: String(err), reportable: true });
    }
    setTestingInput(false);
    setTimeout(() => setTestResult(null), 5000);
  };

  const testOutputDevice = async () => {
    setTestingOutput(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/audio/test-output`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: settings.audio_output_device || "default" }),
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setTestResult({ type: "output", ok: true });
      } else {
        setTestResult({ type: "output", ok: false, error: data.error });
      }
    } catch (err) {
      addToast({ type: "error", title: "Audio-Test", message: "Audio-Test fehlgeschlagen", detail: String(err), reportable: true });
    }
    setTestingOutput(false);
    setTimeout(() => setTestResult(null), 5000);
  };

  const addFolder = () => {
    const folder = newFolderPath.trim();
    if (!folder) return;
    const current = settings.nox_files_custom_folders || [];
    if (!current.includes(folder)) {
      updateSetting("nox_files_custom_folders", [...current, folder]);
    }
    setNewFolderPath("");
  };

  const removeFolder = (folder) => {
    const current = settings.nox_files_custom_folders || [];
    updateSetting("nox_files_custom_folders", current.filter((f) => f !== folder));
  };

  const addExcludedDir = () => {
    const dir = newExcludedDir.trim();
    if (!dir) return;
    const current = settings.nox_files_excluded_dirs || [];
    if (!current.includes(dir)) {
      updateSetting("nox_files_excluded_dirs", [...current, dir]);
    }
    setNewExcludedDir("");
  };

  const removeExcludedDir = (dir) => {
    const current = settings.nox_files_excluded_dirs || [];
    updateSetting("nox_files_excluded_dirs", current.filter((d) => d !== dir));
  };

  const triggerReindex = async () => {
    try {
      await fetch(`${API_BASE}/files/reindex`, { method: "POST" });
      setTimeout(fetchSettings, 2000);
    } catch (err) {
      addToast({ type: "error", title: "Dateisuche", message: "Neu-Indexierung fehlgeschlagen", detail: String(err), reportable: true });
    }
  };

  const Toggle = ({ checked, onChange, disabled }) => (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
        checked ? "bg-nox-accent" : "bg-nox-border"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  const Section = ({ icon, label, children }) => (
    <div className="rounded-xl bg-nox-bg/50 border border-nox-border/50 p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <h3 className="text-xs font-semibold text-nox-text uppercase tracking-wide">{label}</h3>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );

  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-nox-surface text-sm gap-2">
      <span className="text-nox-textDim shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );

  const selectClass =
    "bg-nox-bg text-nox-text text-sm rounded px-2 py-1 border border-nox-border focus:outline-none focus:border-nox-accent";
  const inputClass = selectClass;

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-nox-border"
        style={{ WebkitAppRegion: "drag" }}
      >
        <div className="flex items-center gap-2">
          <img src={noxLogo} alt="Nox" className="h-5 w-auto" />
          <span className="text-xs text-nox-textDim">{s.title}</span>
        </div>
        <button
          onClick={onClose}
          className="text-nox-textDim hover:text-nox-text transition-colors p-1 rounded"
          style={{ WebkitAppRegion: "no-drag" }}
          aria-label={s.back}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Settings sections */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* General */}
        <Section icon="⚙️" label={s.general}>
          <Row label={s.hotkey}>
            <input
              type="text"
              className={inputClass + " w-40 text-right"}
              value={settings.hotkey || ""}
              onChange={(e) => updateSetting("hotkey", e.target.value)}
              placeholder="CommandOrControl+Shift+Space"
            />
          </Row>
          <Row label={s.theme}>
            <select
              className={selectClass}
              value={settings.ui_theme || "system"}
              onChange={(e) => updateSetting("ui_theme", e.target.value)}
            >
              <option value="system">{s.themeSystem}</option>
              <option value="dark">{s.themeDark}</option>
              <option value="light">{s.themeLight}</option>
            </select>
          </Row>
          <Row label={s.autostart}>
            <Toggle checked={autostart} onChange={toggleAutostart} />
          </Row>
        </Section>

        {/* AI Model */}
        <Section icon="🤖" label={s.aiModel}>
          <Row label={s.ollamaHost}>
            <input
              type="text"
              className={inputClass + " w-44 text-right"}
              value={settings.ollama_host || ""}
              onChange={(e) => updateSetting("ollama_host", e.target.value)}
              placeholder="http://localhost:11434"
            />
          </Row>
          <Row label={s.model}>
            <select
              className={selectClass}
              value={settings.ollama_model || ""}
              onChange={(e) => updateSetting("ollama_model", e.target.value)}
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))
              ) : (
                <option value="">{s.noModels}</option>
              )}
            </select>
          </Row>
        </Section>

        {/* Voice */}
        <Section icon="🎤" label={s.voice}>
          <Row label={s.wakeWord}>
            <Toggle
              checked={settings.wake_word_enabled || false}
              onChange={(v) => updateSetting("wake_word_enabled", v)}
            />
          </Row>
          <Row label={s.wakeSensitivity}>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              value={settings.wake_word_threshold || 0.5}
              onChange={(e) => updateSetting("wake_word_threshold", parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-nox-textDim text-xs w-8 text-right">
              {(settings.wake_word_threshold || 0.5).toFixed(2)}
            </span>
          </Row>
          <Row label={s.audioInput}>
            <select
              className={selectClass + " max-w-40"}
              value={settings.audio_input_device || "default"}
              onChange={(e) => updateSetting("audio_input_device", e.target.value)}
            >
              <option value="default">{s.audioDefault}</option>
              {audioDevices.input.map((d) => (
                <option key={d.index} value={d.name}>
                  {d.name}{d.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={testInputDevice}
              disabled={testingInput}
              className="px-2 py-1 rounded bg-nox-accent text-white text-xs whitespace-nowrap disabled:opacity-50"
              style={{ WebkitAppRegion: "no-drag" }}
            >
              {testingInput ? s.testing : s.testInput}
            </button>
          </Row>
          {testResult?.type === "input" && (
            <div className="px-3 py-1 text-xs">
              {testResult.ok ? (
                <span className="text-green-400">{s.testOk}{(testResult.rms * 1000).toFixed(1)}m)</span>
              ) : (
                <span className="text-red-400">{s.testFail}: {testResult.error}</span>
              )}
            </div>
          )}
          <Row label={s.audioOutput}>
            <select
              className={selectClass + " max-w-40"}
              value={settings.audio_output_device || "default"}
              onChange={(e) => updateSetting("audio_output_device", e.target.value)}
            >
              <option value="default">{s.audioDefault}</option>
              {audioDevices.output.map((d) => (
                <option key={d.index} value={d.name}>
                  {d.name}{d.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={testOutputDevice}
              disabled={testingOutput}
              className="px-2 py-1 rounded bg-nox-accent text-white text-xs whitespace-nowrap disabled:opacity-50"
              style={{ WebkitAppRegion: "no-drag" }}
            >
              {testingOutput ? s.testing : s.testOutput}
            </button>
          </Row>
          {testResult?.type === "output" && (
            <div className="px-3 py-1 text-xs">
              {testResult.ok ? (
                <span className="text-green-400">✓</span>
              ) : (
                <span className="text-red-400">{s.testFail}: {testResult.error}</span>
              )}
            </div>
          )}
          <Row label={s.silenceThreshold}>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={settings.end_turn_silence_threshold || 1.0}
              onChange={(e) => updateSetting("end_turn_silence_threshold", parseFloat(e.target.value))}
              className="w-24"
            />
            <span className="text-nox-textDim text-xs w-8 text-right">
              {(settings.end_turn_silence_threshold || 1.0).toFixed(1)}s
            </span>
          </Row>
          <div className="px-3 text-xs text-nox-textDim">
            {s.silenceThresholdHint}
          </div>
          <Row label={s.endTurnDetection}>
            <Toggle
              checked={settings.end_turn_enabled !== false}
              onChange={(v) => updateSetting("end_turn_enabled", v)}
            />
          </Row>
          <Row label={s.ttsVoice}>
            <div className="flex items-center gap-2">
              <select
                className={inputClass + " w-48 text-right"}
                value={settings.tts_model || ""}
                onChange={(e) => updateSetting("tts_model", e.target.value)}
              >
                {installedVoices.length > 0 ? (
                  installedVoices.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))
                ) : (
                  <option value="">— keine Stimme —</option>
                )}
              </select>
              {settings.tts_model && (
                <button
                  onClick={() => playVoicePreview(settings.tts_model)}
                  className={`px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    previewPlaying === settings.tts_model
                      ? "bg-nox-accent text-white"
                      : "bg-nox-surfaceHover hover:bg-nox-accent/20 text-nox-text"
                  }`}
                  title="Demo abspielen"
                >
                  {previewPlaying === settings.tts_model ? "⏸" : "🔊"}
                </button>
              )}
            </div>
          </Row>
        </Section>

        {/* Context Capture */}
        <Section icon="👁️" label={s.context}>
          <Row label={s.retentionDays}>
            <input
              type="number"
              min="1"
              max="90"
              className={inputClass + " w-16 text-right"}
              value={settings.nox_eye_ttl_days || 7}
              onChange={(e) => updateSetting("nox_eye_ttl_days", parseInt(e.target.value) || 7)}
            />
          </Row>
          <div className="px-3 py-2 rounded-lg bg-nox-surface space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-nox-textDim text-sm">{s.excludedApps}</span>
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                className={inputClass + " flex-1"}
                value={newExcludedApp}
                onChange={(e) => setNewExcludedApp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExcludedApp()}
                placeholder={s.addAppPlaceholder}
              />
              <button
                onClick={addExcludedApp}
                className="px-2 py-1 rounded bg-nox-accent text-white text-sm"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(settings.nox_eye_excluded_apps || []).map((app) => (
                <span
                  key={app}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-nox-bg text-nox-textDim text-xs"
                >
                  {app}
                  <button
                    onClick={() => removeExcludedApp(app)}
                    className="text-nox-textDim hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </Section>

        {/* File Search */}
        <Section icon="📁" label={s.fileSearch}>
          <Row label={s.fileSearchEnabled}>
            <Toggle
              checked={settings.nox_files_enabled || false}
              onChange={(v) => updateSetting("nox_files_enabled", v)}
            />
          </Row>
          <Row label={s.fileSearchFullDrive}>
            <Toggle
              checked={settings.nox_files_full_drive || false}
              onChange={(v) => updateSetting("nox_files_full_drive", v)}
            />
          </Row>
          {settings.nox_files_full_drive && (
            <div className="px-3 py-1 text-xs text-yellow-400">
              ⚠ {s.fileSearchFullDriveWarn}
            </div>
          )}
          <div className="px-3 py-2 rounded-lg bg-nox-surface space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-nox-textDim text-sm">{s.fileSearchFolders}</span>
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                className={inputClass + " flex-1"}
                value={newFolderPath}
                onChange={(e) => setNewFolderPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFolder()}
                placeholder={s.fileSearchAddFolder}
              />
              <button
                onClick={addFolder}
                className="px-2 py-1 rounded bg-nox-accent text-white text-sm"
                style={{ WebkitAppRegion: "no-drag" }}
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(settings.nox_files_custom_folders || []).map((folder) => (
                <span
                  key={folder}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-nox-bg text-nox-textDim text-xs max-w-full"
                >
                  <span className="truncate max-w-32">{folder}</span>
                  <button
                    onClick={() => removeFolder(folder)}
                    className="text-nox-textDim hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-nox-surface space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-nox-textDim text-sm">{s.fileSearchExcluded}</span>
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                className={inputClass + " flex-1"}
                value={newExcludedDir}
                onChange={(e) => setNewExcludedDir(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExcludedDir()}
                placeholder={s.fileSearchAddExcluded}
              />
              <button
                onClick={addExcludedDir}
                className="px-2 py-1 rounded bg-nox-accent text-white text-sm"
                style={{ WebkitAppRegion: "no-drag" }}
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(settings.nox_files_excluded_dirs || []).map((dir) => (
                <span
                  key={dir}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-nox-bg text-nox-textDim text-xs"
                >
                  {dir}
                  <button
                    onClick={() => removeExcludedDir(dir)}
                    className="text-nox-textDim hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <Row label={s.fileSearchFiles}>
            <span className="text-nox-textDim text-xs">
              {filesHealth?.files_indexed ?? "—"}
            </span>
          </Row>
          <div className="px-3">
            <button
              onClick={triggerReindex}
              disabled={filesHealth?.indexing}
              className="px-3 py-1.5 rounded bg-nox-accent text-white text-sm w-full disabled:opacity-50"
              style={{ WebkitAppRegion: "no-drag" }}
            >
              {filesHealth?.indexing ? s.fileSearchIndexing : s.fileSearchReindex}
            </button>
          </div>
        </Section>

        {/* About */}
        <div className="pt-4 border-t border-nox-border">
          <Section icon="ℹ️" label={s.about}>
            <Row label={s.version}>
              <span className="text-nox-text font-medium">0.5.0</span>
            </Row>
            <Row label={s.configPath}>
              <span className="text-nox-textDim text-xs truncate max-w-40">
                %APPDATA%\Nox\config.yaml
              </span>
            </Row>
          </Section>
        </div>

        {saving && (
          <div className="text-center text-xs text-nox-textDim animate-pulse">
            {s.saving}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPanel;
