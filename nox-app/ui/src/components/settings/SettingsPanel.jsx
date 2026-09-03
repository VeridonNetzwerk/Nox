import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogo from "../../assets/nox-logo.png";
import { useToast } from "../common/Toast.jsx";
import VoiceSelection from "./VoiceSelection.jsx";
import { API_BASE, FlagIcon, LanguageDropdown } from "../../shared/constants.jsx";
import { IconGear, IconRobot, IconMicrophone, IconEye, IconFolder, IconInfo, IconWarning, IconCheck, IconX, IconSearch, IconPlus, IconArrowRight, IconArrowLeft, IconSpeaker, IconSpinner } from "../../shared/Icon.jsx";
import { prettyModelName, prettyVoiceName } from "../../shared/prettyNames.jsx";

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative rounded-full transition-all duration-200 ${
        checked ? "bg-nox-accent" : "bg-nox-border"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      style={{ width: "40px", height: "22px" }}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-[18px]" : "translate-x-0"}`}
      />
    </button>
  );
}

function Section({ icon, label, children }) {
  return (
    <div className="rounded-xl border border-nox-border bg-nox-surface/20 p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-nox-accent/10 text-nox-accent">
          {icon}
        </div>
        <h3 className="text-xs font-semibold text-nox-text uppercase tracking-wide">{label}</h3>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, children, hint }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm gap-3">
      <div className="flex flex-col min-w-0">
        <span className="text-nox-text shrink-0">{label}</span>
        {hint && <span className="text-[11px] text-nox-textDim mt-0.5">{hint}</span>}
      </div>
      <div className="flex items-center gap-2 min-w-0 shrink-0">{children}</div>
    </div>
  );
}

function HotkeyInput({ value, onChange }) {
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef(null);

  const parseKeys = (str) => {
    if (!str) return [];
    return str.split("+").map((k) => k.trim()).filter(Boolean);
  };

  const formatKey = (key) => {
    const map = {
      "CommandOrControl": "Ctrl",
      "Control": "Ctrl",
      "Meta": "Win",
      "Command": "Cmd",
      "Shift": "Shift",
      "Alt": "Alt",
      "AltGr": "AltGr",
      "Space": "Space",
      "Enter": "Enter",
      "Tab": "Tab",
      "Escape": "Esc",
      "Backspace": "⌫",
      "Delete": "Del",
      "ArrowUp": "↑",
      "ArrowDown": "↓",
      "ArrowLeft": "←",
      "ArrowRight": "→",
    };
    return map[key] || key;
  };

  const keys = parseKeys(value);

  const handleKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(false);
      return;
    }
    if (e.key === "Backspace" && keys.length > 0) {
      onChange("");
      setCapturing(false);
      return;
    }

    const parts = [];
    if (e.ctrlKey) parts.push("CommandOrControl");
    if (e.metaKey && !e.ctrlKey) parts.push("Meta");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    let keyName = e.key;
    if (keyName === " ") keyName = "Space";
    if (keyName.length === 1) keyName = keyName.toUpperCase();
    if (!["Control", "Shift", "Alt", "Meta"].includes(keyName)) {
      parts.push(keyName);
      onChange(parts.join("+"));
      setCapturing(false);
    }
  };

  return (
    <div
      ref={inputRef}
      tabIndex={0}
      onKeyDown={capturing ? handleKeyDown : undefined}
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all min-w-[160px] ${
        capturing
          ? "border-nox-accent bg-nox-accent/5 ring-2 ring-nox-accent/20"
          : "border-nox-border bg-nox-bgSolid hover:border-nox-accent/40"
      }`}
    >
      {capturing ? (
        <span className="text-xs text-nox-accent animate-pulse">Taste drücken…</span>
      ) : keys.length > 0 ? (
        <div className="flex items-center gap-1 flex-wrap">
          {keys.map((k, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-nox-textDim text-xs">+</span>}
              <kbd className="px-1.5 py-0.5 rounded bg-nox-surface border border-nox-border text-xs text-nox-text font-mono leading-none">
                {formatKey(k)}
              </kbd>
            </React.Fragment>
          ))}
        </div>
      ) : (
        <span className="text-xs text-nox-textDim">Nicht festgelegt</span>
      )}
    </div>
  );
}

function SettingsPanel({ locale, onClose, onLocaleChange, onUiScaleChange, embedded }) {
  const { addToast } = useToast();
  const s = locale.settings;
  const so = locale.onboarding || {};
  const [settings, setSettings] = useState({});
  const [models, setModels] = useState([]);
  const [autostart, setAutostart] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newExcludedApp, setNewExcludedApp] = useState("");
  const [audioDevices, setAudioDevices] = useState({ input: [], output: [] });
  const [installedVoices, setInstalledVoices] = useState([]);
  const [previewPlaying, setPreviewPlaying] = useState(null);
  const previewAudioRef = useRef(null);
  const [previewError, setPreviewError] = useState(null);
  const [voiceCatalog, setVoiceCatalog] = useState(null);
  const [edgeCatalog, setEdgeCatalog] = useState(null);
  const [kokoroCatalog, setKokoroCatalog] = useState(null);
  const [selectedLang, setSelectedLang] = useState("");
  const [openLangDropdown, setOpenLangDropdown] = useState(false);
  const [testingInput, setTestingInput] = useState(false);
  const [testingOutput, setTestingOutput] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [newExcludedDir, setNewExcludedDir] = useState("");
  const [filesHealth, setFilesHealth] = useState(null);
  const [showVoiceSelection, setShowVoiceSelection] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);

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
      if (settingsData.status === "ok") {
        setSettings(settingsData.settings);
        if (settingsData.settings.ui_theme && window.nox?.setThemePreference) {
          window.nox.setThemePreference(settingsData.settings.ui_theme);
        }
      }
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

  // Fetch voice catalogs + system language
  useEffect(() => {
    const fetchVoiceData = async () => {
      try {
        const [catRes, langRes, edgeRes, kokoroRes] = await Promise.all([
          fetch(`${API_BASE}/api/voices/catalog`),
          fetch(`${API_BASE}/api/voices/system-language`),
          fetch(`${API_BASE}/api/voices/edge/catalog`),
          fetch(`${API_BASE}/api/voices/kokoro/catalog`),
        ]);
        const catData = await catRes.json();
        const langData = await langRes.json();
        const edgeData = await edgeRes.json();
        const kokoroData = await kokoroRes.json();
        if (catData.status === "ok") setVoiceCatalog(catData.catalog);
        if (langData.status === "ok") setSelectedLang(langData.language_code);
        if (edgeData.status === "ok") setEdgeCatalog(edgeData.catalog);
        if (kokoroData.status === "ok") setKokoroCatalog(kokoroData.catalog);
      } catch (err) {
        console.error("Voice catalog fetch failed:", err);
      }
    };
    fetchVoiceData();
  }, []);

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
      if (key === "ui_theme" && window.nox?.setThemePreference) {
        window.nox.setThemePreference(value);
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

  const saveVoiceSetting = async (voiceName, engine = "piper") => {
    if (!voiceName) return;
    setSettings((prev) => ({ ...prev, tts_model: voiceName, tts_engine: engine }));
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tts_model: voiceName, tts_engine: engine }),
      });
    } catch (err) {
      console.error("Failed to save voice:", err);
    }
  };

  const _stopAndToggle = (id) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewPlaying === id) {
      setPreviewPlaying(null);
      return true;
    }
    return false;
  };

  const _playAudioBlob = async (url) => {
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
  };

  const playKokoroPreview = async (langCode, voiceId) => {
    const id = `kokoro:${voiceId}`;
    if (_stopAndToggle(id)) return;
    setPreviewPlaying(id);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/voices/demo/kokoro/${langCode}/${voiceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Kokoro Preview fehlgeschlagen");
      }
      const blob = await res.blob();
      await _playAudioBlob(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Kokoro preview failed:", err);
      setPreviewPlaying(null);
      setPreviewError(`Kokoro: ${err.message}`);
    }
  };

  const playEdgePreview = async (langCode, voiceId) => {
    const id = `edge:${voiceId}`;
    if (_stopAndToggle(id)) return;
    setPreviewPlaying(id);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/voices/demo/edge/${langCode}/${voiceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Edge TTS Preview fehlgeschlagen");
      }
      const blob = await res.blob();
      await _playAudioBlob(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Edge preview failed:", err);
      setPreviewPlaying(null);
      setPreviewError(`Edge TTS: ${err.message}`);
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

  const selectClass =
    "bg-nox-bgSolid text-nox-text text-sm rounded-lg px-3 py-1.5 border border-nox-border focus:outline-none focus:border-nox-accent transition-colors";
  const inputClass = selectClass;

  const categories = [
    { id: "general", icon: <IconGear size={18} />, label: s.general, desc: "Tastenkombination, Design, Autostart", keywords: ["hotkey", "theme", "autostart", "tastenkombination", "design", "start", "analytics", "größe", "size", "ui_scale"] },
    { id: "ai", icon: <IconRobot size={18} />, label: s.aiModel, desc: "Modell, Host, Thinking-Modus", keywords: ["ollama", "model", "host", "preload", "vram", "ram", "ki", "künstliche intelligenz"] },
    { id: "voice", icon: <IconMicrophone size={18} />, label: s.voice, desc: "Wake Word, Audio, Stimme", keywords: ["wake", "audio", "input", "output", "tts", "stimme", "sprache", "mikrofon", "lautsprecher", "silence"] },
    { id: "context", icon: <IconEye size={18} />, label: s.context, desc: "Screenshots, Speicherung, Apps", keywords: ["eye", "ttl", "excluded", "apps", "kontext", "erfassung", "ausschließen"] },
    { id: "files", icon: <IconFolder size={18} />, label: s.fileSearch, desc: "Ordner, Indexierung, Ausschlüsse", keywords: ["file", "search", "drive", "folders", "index", "datei", "suche", "ordner", "laufwerk"] },
    { id: "about", icon: <IconInfo size={18} />, label: s.about, desc: "Version, Updates, Konfiguration", keywords: ["version", "config", "path", "info", "über"] },
  ];

  const filteredCategories = searchQuery.trim()
    ? categories.filter(c => {
        const q = searchQuery.toLowerCase();
        return c.label.toLowerCase().includes(q) ||
               c.keywords.some(k => k.includes(q));
      })
    : categories;

  const renderGeneralSettings = () => (
    <>
      <Row label={s.hotkey} hint="Klicken und Tastenkombination drücken">
        <HotkeyInput
          value={settings.hotkey || ""}
          onChange={(v) => updateSetting("hotkey", v)}
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
      <Row label={s.autostart} hint="Nox beim Systemstart öffnen">
        <Toggle checked={autostart} onChange={toggleAutostart} />
      </Row>
      <Row label={s.language || "Sprache"}>
        <div className="w-48">
          <LanguageDropdown
            voiceCatalog={voiceCatalog}
            selectedLang={selectedLang}
            onSelect={async (code) => {
              setSelectedLang(code);
              await updateSetting("system_language", code);
              if (onLocaleChange) onLocaleChange(code);
              try {
                const res = await fetch(`${API_BASE}/api/voices/default/${code}`);
                const data = await res.json();
                if (data.status === "ok") {
                  await updateSetting("tts_model", data.default_voice);
                  await updateSetting("tts_engine", data.default_engine);
                }
              } catch (err) {
                console.error("Failed to fetch default voice:", err);
              }
            }}
            label={null}
          />
        </div>
      </Row>
      <Row label={s.uiScale || "Größe"}>
        <div className="flex items-center gap-2 w-48">
          <input
            type="range"
            min="0.7"
            max="1.6"
            step="0.1"
            value={settings.ui_scale || "1.0"}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              updateSetting("ui_scale", val);
              if (onUiScaleChange) onUiScaleChange(val);
            }}
            className="flex-1 accent-nox-accent"
          />
          <span className="text-xs text-nox-textDim w-10 text-right tabular-nums">
            {Math.round((settings.ui_scale || 1.0) * 100)}%
          </span>
        </div>
      </Row>
      <Row label={s.analytics || "Analytics"} hint="Anonyme Nutzungsdaten senden">
        <Toggle
          checked={settings.analytics_enabled !== false}
          onChange={(v) => updateSetting("analytics_enabled", v)}
        />
      </Row>
    </>
  );

  const renderAISettings = () => (
    <>
      <Row label={s.ollamaHost} hint="z.B. http://localhost:11434">
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
              <option key={m} value={m}>{prettyModelName(m)}</option>
            ))
          ) : (
            <option value="">{s.noModels}</option>
          )}
        </select>
      </Row>
      <Row label={"Modell vorab laden"} hint="Modell im Speicher halten für schnelleren Start">
        <Toggle
          checked={settings.ollama_preload || false}
          onChange={(v) => updateSetting("ollama_preload", v)}
        />
      </Row>
      <Row label={"Thinking-Modus"} hint="KI zeigt ihren Gedankengang vor der Antwort">
        <Toggle
          checked={settings.ollama_think || false}
          onChange={(v) => updateSetting("ollama_think", v)}
        />
      </Row>
      {settings.ollama_preload && (
        <>
          <Row label={"Preload-Modus"}>
            <select
              className={selectClass}
              value={settings.ollama_preload_mode || "vram"}
              onChange={(e) => updateSetting("ollama_preload_mode", e.target.value)}
            >
              <option value="vram">VRAM (GPU)</option>
              <option value="ram">RAM (CPU, schneller Wechsel)</option>
            </select>
          </Row>
          <div className="px-3 py-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
            <div className="flex items-start gap-2">
              <span className="text-yellow-500/80 text-sm flex-shrink-0"><IconWarning size={14} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-yellow-600/90 dark:text-yellow-400/90 break-words">
                  <strong>Warnung:</strong> Das Vorabladen des Modells verbraucht erheblich RAM bzw. VRAM und hält diese Ressourcen dauerhaft reserviert. Bei großen Modellen kann das System verlangsmt werden oder andere Anwendungen können abstürzen. Nur aktivieren, wenn genügend Arbeitsspeicher verfügbar ist!
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  const renderVoiceSettings = () => (
    <>
      <Row label={s.wakeWord} hint="Nox per Sprache aufrufen">
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
          className="w-24 accent-nox-accent"
        />
        <span className="text-nox-textDim text-xs w-8 text-right">
          {(settings.wake_word_threshold || 0.5).toFixed(2)}
        </span>
      </Row>
      <Row label={s.audioInput}>
        <div className="flex flex-col items-end gap-1.5 min-w-0">
          <select
            className={selectClass + " max-w-44 w-full"}
            value={settings.audio_input_device || "default"}
            onChange={(e) => updateSetting("audio_input_device", e.target.value)}
          >
            <option value="default">{s.audioDefault}</option>
            {audioDevices.input.map((d) => (
              <option key={d.index} value={d.name}>
                {d.name}{d.is_default ? " (Standard)" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={testInputDevice}
            disabled={testingInput}
            className="px-3 py-1 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg text-xs whitespace-nowrap disabled:opacity-50 transition-all hover:scale-105 self-end"
          >
            {testingInput ? s.testing : s.testInput}
          </button>
        </div>
      </Row>
      {testResult?.type === "input" && (
        <div className="px-3 py-1 text-xs">
          {testResult.ok ? (
            <span className="text-green-600 dark:text-green-400">{s.testOk}{(testResult.rms * 1000).toFixed(1)}m)</span>
          ) : (
            <span className="text-red-600 dark:text-red-400">{s.testFail}: {testResult.error}</span>
          )}
        </div>
      )}
      <Row label={s.audioOutput}>
        <div className="flex flex-col items-end gap-1.5 min-w-0">
          <select
            className={selectClass + " max-w-44 w-full"}
            value={settings.audio_output_device || "default"}
            onChange={(e) => updateSetting("audio_output_device", e.target.value)}
          >
            <option value="default">{s.audioDefault}</option>
            {audioDevices.output.map((d) => (
              <option key={d.index} value={d.name}>
                {d.name}{d.is_default ? " (Standard)" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={testOutputDevice}
            disabled={testingOutput}
            className="px-3 py-1 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg text-xs whitespace-nowrap disabled:opacity-50 transition-all hover:scale-105 self-end"
          >
            {testingOutput ? s.testing : s.testOutput}
          </button>
        </div>
      </Row>
      {testResult?.type === "output" && (
        <div className="px-3 py-1 text-xs">
          {testResult.ok ? (
            <span className="text-green-600 dark:text-green-400"><IconCheck size={12} /></span>
          ) : (
            <span className="text-red-600 dark:text-red-400">{s.testFail}: {testResult.error}</span>
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
          className="w-24 accent-nox-accent"
        />
        <span className="text-nox-textDim text-xs w-8 text-right">
          {(settings.end_turn_silence_threshold || 1.0).toFixed(1)}s
        </span>
      </Row>
      <div className="px-3 text-xs text-nox-textDim">
        {s.silenceThresholdHint}
      </div>
      <Row label={s.endTurnDetection} hint="Automatisch erkennen, wenn du fertig sprichst">
        <Toggle
          checked={settings.end_turn_enabled !== false}
          onChange={(v) => updateSetting("end_turn_enabled", v)}
        />
      </Row>
      {/* Voice selection button — opens modal */}
      <div className="px-3 py-3 rounded-lg bg-nox-surface/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-nox-textDim text-sm">Stimme & Sprache</span>
          {settings.tts_model && (
            <span className="text-xs text-nox-textDim truncate max-w-32">
              {prettyVoiceName(settings.tts_model)}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowVoiceSelection(true)}
          className="w-full px-3 py-2.5 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg text-sm font-medium transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
        >
          <IconSpeaker size={16} />
          Stimme & Sprache wählen
        </button>
      </div>
    </>
  );

  const renderContextSettings = () => (
    <>
      <Row label={s.retentionDays} hint="Wie lange Screenshots gespeichert werden">
        <input
          type="number"
          min="1"
          max="90"
          className={inputClass + " w-16 text-right"}
          value={settings.nox_eye_ttl_days || 7}
          onChange={(e) => updateSetting("nox_eye_ttl_days", parseInt(e.target.value) || 7)}
        />
      </Row>
      <Row label="Screenshot-Historie Intervall (Sekunden)">
        <input
          type="number"
          min="10"
          max="600"
          className={inputClass + " w-20 text-right"}
          value={settings.nox_eye_screenshot_interval || 60}
          onChange={(e) => updateSetting("nox_eye_screenshot_interval", parseInt(e.target.value) || 60)}
        />
      </Row>
      <div className="px-3 py-3 rounded-lg bg-nox-surface/20 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-nox-textDim text-sm">{s.excludedApps}</span>
        </div>
        <div className="flex gap-1.5">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg transition-all hover:scale-105 shrink-0"
          >
            <IconPlus size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_eye_excluded_apps || []).map((app) => (
            <span
              key={app}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-surface text-nox-text text-xs border border-nox-border"
            >
              {app}
              <button
                onClick={() => removeExcludedApp(app)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>
    </>
  );

  const renderFilesSettings = () => (
    <>
      <Row label={s.fileSearchEnabled} hint="Nox erlaubt, nach lokalen Dateien zu suchen">
        <Toggle
          checked={settings.nox_files_enabled || false}
          onChange={(v) => updateSetting("nox_files_enabled", v)}
        />
      </Row>
      <Row label={s.fileSearchFullDrive} hint="Gesamtes Laufwerk indexieren (langsamer)">
        <Toggle
          checked={settings.nox_files_full_drive || false}
          onChange={(v) => updateSetting("nox_files_full_drive", v)}
        />
      </Row>
      {settings.nox_files_full_drive && (
        <div className="px-3 py-1 text-xs text-yellow-400 flex items-center gap-1">
          <IconWarning size={12} /> {s.fileSearchFullDriveWarn}
        </div>
      )}
      <div className="px-3 py-3 rounded-lg bg-nox-surface/20 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-nox-textDim text-sm">{s.fileSearchFolders}</span>
        </div>
        <div className="flex gap-1.5">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg transition-all hover:scale-105 shrink-0"
          >
            <IconPlus size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_files_custom_folders || []).map((folder) => (
            <span
              key={folder}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-surface text-nox-text text-xs max-w-full border border-nox-border"
            >
              <span className="truncate max-w-32">{folder}</span>
              <button
                onClick={() => removeFolder(folder)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="px-3 py-3 rounded-lg bg-nox-surface/20 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-nox-textDim text-sm">{s.fileSearchExcluded}</span>
        </div>
        <div className="flex gap-1.5">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg transition-all hover:scale-105 shrink-0"
          >
            <IconPlus size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_files_excluded_dirs || []).map((dir) => (
            <span
              key={dir}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-surface text-nox-text text-xs border border-nox-border"
            >
              {dir}
              <button
                onClick={() => removeExcludedDir(dir)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
              >
                <IconX size={12} />
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
          className="px-4 py-2 nox-btn-primary w-full"
        >
          {filesHealth?.indexing ? s.fileSearchIndexing : s.fileSearchReindex}
        </button>
      </div>
    </>
  );

  const renderAboutSettings = () => {
    const handleCheckUpdates = async () => {
      setUpdateChecking(true);
      try {
        const result = await window.nox?.checkForUpdates?.();
        if (result?.error) {
          addToast({ type: "error", title: "Update", message: `Prüfung fehlgeschlagen: ${result.error}`, duration: 5000 });
        } else if (result?.hasUpdate) {
          addToast({
            type: "info",
            title: "Update verfügbar",
            message: `v${result.latestVersion} ist verfügbar (aktuell: v${result.currentVersion})`,
            duration: 8000,
          });
          if (result.releaseUrl) {
            window.nox?.openReleasePage?.();
          }
        } else {
          addToast({ type: "success", title: "Update", message: `Nox ist aktuell (v${result?.currentVersion || "0.5.0"})`, duration: 4000 });
        }
      } catch (err) {
        addToast({ type: "error", title: "Update", message: "Update-Prüfung fehlgeschlagen", detail: String(err), duration: 5000 });
      }
      setUpdateChecking(false);
    };

    return (
    <>
      <Row label={s.version}>
        <span className="text-nox-text font-medium">0.5.0</span>
      </Row>
      <Row label="Updates">
        <button
          onClick={handleCheckUpdates}
          disabled={updateChecking}
          className="px-3 py-1.5 nox-btn-secondary"
        >
          {updateChecking ? "Prüfe…" : "Auf Updates prüfen"}
        </button>
      </Row>
      <Row label={s.configPath}>
        <span className="text-nox-textDim text-xs truncate max-w-40">
          %APPDATA%\Nox\config.yaml
        </span>
      </Row>
    </>
    );
  };

  const renderCategoryContent = (catId) => {
    switch (catId) {
      case "general": return renderGeneralSettings();
      case "ai": return renderAISettings();
      case "voice": return renderVoiceSettings();
      case "context": return renderContextSettings();
      case "files": return renderFilesSettings();
      case "about": return renderAboutSettings();
      default: return null;
    }
  };

  const activeCat = categories.find(c => c.id === activeCategory);

  return (
    <div className="flex flex-col h-full">
      {/* Header — only when not embedded */}
      {!embedded && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-nox-border">
          <div className="flex items-center gap-2.5">
            {activeCat ? (
              <button
                onClick={() => setActiveCategory(null)}
                className="flex items-center justify-center w-7 h-7 text-nox-textDim hover:text-nox-text transition-all"
              >
                <IconArrowLeft size={16} />
              </button>
            ) : (
              <img src={noxLogo} alt="Nox" className="h-5 w-5 rounded-full" />
            )}
            <span className="text-base font-semibold text-nox-text">
              {activeCat ? activeCat.label : s.title}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 text-nox-textDim hover:text-nox-text transition-all"
            aria-label={s.back}
          >
            <IconX size={16} />
          </button>
        </div>
      )}

      {/* Sub-page header when embedded — show back button + category name */}
      {embedded && activeCat && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-nox-border">
          <button
            onClick={() => setActiveCategory(null)}
            className="flex items-center justify-center w-7 h-7 text-nox-textDim hover:text-nox-text transition-all"
          >
            <IconArrowLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-nox-text">{activeCat.label}</span>
        </div>
      )}

      {/* Search bar (only on main page) */}
      {!activeCategory && (
        <div className="px-4 py-2.5">
          <div className="relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-nox-textDim" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Einstellungen durchsuchen..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-nox-bgSolid text-nox-text text-sm border border-nox-border focus:outline-none focus:border-nox-accent transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-all"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 max-w-3xl w-full mx-auto">
        {activeCategory && activeCat ? (
          /* Sub-page: show selected category settings */
          <div className="rounded-xl border border-nox-border bg-nox-surface/20 p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex items-center justify-center w-7 h-7 bg-nox-accent/10 text-nox-accent text-sm rounded-lg">
                {activeCat.icon}
              </div>
              <h3 className="text-xs font-semibold text-nox-text uppercase tracking-wide">{activeCat.label}</h3>
            </div>
            <div className="space-y-1">
              {renderCategoryContent(activeCategory)}
            </div>
          </div>
        ) : (
          /* Main page: category cards */
          <>
            {filteredCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setActiveCategory(cat.id); setSearchQuery(""); }}
                className="w-full p-3.5 flex items-center gap-3 text-left rounded-xl border border-nox-border bg-nox-surface/20 hover:bg-nox-surface-hover hover:border-nox-accent/30 transition-all"
              >
                <div className="flex items-center justify-center w-9 h-9 bg-nox-accent/10 text-nox-accent text-base flex-shrink-0 rounded-lg">
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-nox-text">{cat.label}</span>
                  {cat.desc && (
                    <p className="text-xs text-nox-textDim truncate mt-0.5">{cat.desc}</p>
                  )}
                  {cat.id === "ai" && settings.ollama_model && (
                    <p className="text-xs text-nox-textDim truncate">{prettyModelName(settings.ollama_model)}</p>
                  )}
                  {cat.id === "voice" && settings.tts_model && (
                    <p className="text-xs text-nox-textDim truncate">{prettyVoiceName(settings.tts_model)}</p>
                  )}
                  {cat.id === "files" && filesHealth && (
                    <p className="text-xs text-nox-textDim truncate">
                      {filesHealth.files_indexed ?? 0} Dateien indexiert
                    </p>
                  )}
                </div>
                <IconArrowRight size={16} className="text-nox-textDim flex-shrink-0" />
              </button>
            ))}
            {filteredCategories.length === 0 && (
              <div className="text-center py-8 text-nox-textDim text-sm">
                Keine Einstellungen gefunden für "{searchQuery}"
              </div>
            )}
          </>
        )}

        {saving && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-nox-textDim animate-pulse">
            <IconSpinner size={12} className="animate-spin" />
            {s.saving}
          </div>
        )}
      </div>

      {showVoiceSelection && (
        <VoiceSelection
          locale={locale}
          currentVoice={settings.tts_model}
          currentEngine={settings.tts_engine}
          lockedLang={selectedLang}
          onClose={() => {
            setShowVoiceSelection(false);
            fetchSettings();
          }}
        />
      )}
    </div>
  );
}

export default SettingsPanel;
