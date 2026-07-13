import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogo from "../assets/nox-logo.png";
import { useToast } from "./Toast.jsx";
import VoiceSelection from "./VoiceSelection.jsx";

const API_BASE = "http://127.0.0.1:8420";

const FLAG_CC = {
  de_DE: "de", en_US: "us", en_GB: "gb",
  fr_FR: "fr", es_ES: "es", es_MX: "mx",
  it_IT: "it", pt_BR: "br", pt_PT: "pt",
  nl_NL: "nl", pl_PL: "pl", ru_RU: "ru",
  uk_UA: "ua", tr_TR: "tr", ar_JO: "jo",
  ja_JP: "jp", zh_CN: "cn", cs_CZ: "cz",
  da_DK: "dk", fi_FI: "fi", el_GR: "gr",
  hi: "in", hu_HU: "hu", ro_RO: "ro",
  sk_SK: "sk", sv_SE: "se", vi_VN: "vn",
};

function FlagIcon({ code, size = 20 }) {
  const cc = FLAG_CC[code];
  if (!cc) return (
    <span
      style={{ width: size, height: size * 0.75 }}
      className="inline-block rounded-[2px] bg-nox-border"
    />
  );
  return (
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      srcSet={`https://flagcdn.com/w80/${cc}.png 2x`}
      alt={code}
      width={size}
      height={Math.round(size * 0.75)}
      className="inline-block rounded-[2px] object-cover"
      loading="lazy"
    />
  );
}

function LanguageDropdown({ voiceCatalog, selectedLang, onSelect, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const entries = Object.entries(voiceCatalog || {}).sort(
    ([, a], [, b]) => a.language_name.localeCompare(b.language_name)
  );
  const selected = entries.find(([code]) => code === selectedLang);
  const selectedCode = selected ? selected[0] : null;
  const selectedName = selected ? selected[1].language_native : "—";

  return (
    <div className="space-y-1.5" ref={ref}>
      {label && (
        <label className="text-xs font-medium text-nox-textDim uppercase tracking-wide block">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-nox-surface text-nox-text text-sm border border-nox-border hover:border-nox-textDim transition-colors"
        >
          <span className="flex items-center gap-2">
            <FlagIcon code={selectedCode} size={20} />
            <span className="font-medium">{selectedName}</span>
          </span>
          <svg
            className={`w-4 h-4 text-nox-textDim transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-black/40 py-0.5">
            {entries.map(([code, info]) => {
              const isSelected = selectedLang === code;
              return (
                <button
                  key={code}
                  onClick={() => {
                    onSelect(code);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
                    isSelected
                      ? "bg-nox-accent/15 text-nox-text"
                      : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                  }`}
                >
                  <FlagIcon code={code} size={18} />
                  <span className="font-medium">{info.language_native}</span>
                  <span className="ml-auto text-[10px] text-nox-textDim uppercase">{code}</span>
                  {isSelected && (
                    <svg className="w-4 h-4 text-nox-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ locale, onClose, onLocaleChange }) {
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

  const Toggle = ({ checked, onChange, disabled }) => (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
        checked ? "bg-nox-accent shadow-sm shadow-nox-accent/30" : "bg-nox-border"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-105"}`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  const Section = ({ icon, label, children }) => (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-nox-accent/15 text-nox-accent text-sm">
          {icon}
        </div>
        <h3 className="text-xs font-semibold text-nox-text uppercase tracking-wide">{label}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );

  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-nox-surface/40 text-sm gap-2">
      <span className="text-nox-textDim shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );

  const selectClass =
    "bg-nox-surface text-nox-text text-sm rounded-lg px-3 py-1.5 border border-nox-border/50 focus:outline-none focus:border-nox-accent transition-colors";
  const inputClass = selectClass;

  const categories = [
    { id: "general", icon: "⚙️", label: s.general, keywords: ["hotkey", "theme", "autostart", "tastenkombination", "design", "start"] },
    { id: "ai", icon: "🤖", label: s.aiModel, keywords: ["ollama", "model", "host", "preload", "vram", "ram", "ki", "künstliche intelligenz"] },
    { id: "voice", icon: "🎤", label: s.voice, keywords: ["wake", "audio", "input", "output", "tts", "stimme", "sprache", "mikrofon", "lautsprecher", "silence"] },
    { id: "context", icon: "👁️", label: s.context, keywords: ["eye", "ttl", "excluded", "apps", "kontext", "erfassung", "ausschließen"] },
    { id: "files", icon: "📁", label: s.fileSearch, keywords: ["file", "search", "drive", "folders", "index", "datei", "suche", "ordner", "laufwerk"] },
    { id: "about", icon: "ℹ️", label: s.about, keywords: ["version", "config", "path", "info", "über"] },
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
    </>
  );

  const renderAISettings = () => (
    <>
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
      <Row label={"Modell vorab laden"}>
        <Toggle
          checked={settings.ollama_preload || false}
          onChange={(v) => updateSetting("ollama_preload", v)}
        />
      </Row>
      <Row label={"Thinking-Modus"}>
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
          <div className="px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-start gap-2">
              <span className="text-yellow-400 text-sm flex-shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-yellow-300 break-words">
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
                {d.name}{d.is_default ? " ★" : ""}
              </option>
            ))}
          </select>
          <button
            onClick={testInputDevice}
            disabled={testingInput}
            className="px-3 py-1 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-xs whitespace-nowrap disabled:opacity-50 transition-all hover:scale-105 self-end"
          >
            {testingInput ? s.testing : s.testInput}
          </button>
        </div>
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
        <div className="flex flex-col items-end gap-1.5 min-w-0">
          <select
            className={selectClass + " max-w-44 w-full"}
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
            className="px-3 py-1 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-xs whitespace-nowrap disabled:opacity-50 transition-all hover:scale-105 self-end"
          >
            {testingOutput ? s.testing : s.testOutput}
          </button>
        </div>
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
          className="w-24 accent-nox-accent"
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
      {/* Voice selection button — opens modal */}
      <div className="px-3 py-3 rounded-lg bg-nox-surface/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-nox-textDim text-sm">Stimme & Sprache</span>
          {settings.tts_model && (
            <span className="text-xs text-nox-textDim truncate max-w-32">
              {settings.tts_model}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowVoiceSelection(true)}
          className="w-full px-3 py-2.5 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-sm font-medium transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 8.5a3.5 3.5 0 10-1 5.83M11 5L6 9H3v6h3l5 4V5z" />
          </svg>
          Stimme & Sprache wählen
        </button>
      </div>
    </>
  );

  const renderContextSettings = () => (
    <>
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
      <div className="px-3 py-3 rounded-lg bg-nox-surface/40 space-y-2">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-sm transition-all hover:scale-105 shrink-0"
          >
            +
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_eye_excluded_apps || []).map((app) => (
            <span
              key={app}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-border/40 text-nox-textDim text-xs"
            >
              {app}
              <button
                onClick={() => removeExcludedApp(app)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </>
  );

  const renderFilesSettings = () => (
    <>
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
      <div className="px-3 py-3 rounded-lg bg-nox-surface/40 space-y-2">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-sm transition-all hover:scale-105 shrink-0"
          >
            +
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_files_custom_folders || []).map((folder) => (
            <span
              key={folder}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-border/40 text-nox-textDim text-xs max-w-full"
            >
              <span className="truncate max-w-32">{folder}</span>
              <button
                onClick={() => removeFolder(folder)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="px-3 py-3 rounded-lg bg-nox-surface/40 space-y-2">
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
            className="flex items-center justify-center w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-sm transition-all hover:scale-105 shrink-0"
          >
            +
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(settings.nox_files_excluded_dirs || []).map((dir) => (
            <span
              key={dir}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-nox-border/40 text-nox-textDim text-xs"
            >
              {dir}
              <button
                onClick={() => removeExcludedDir(dir)}
                className="text-nox-textDim hover:text-red-500 transition-colors"
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
          className="px-4 py-2 rounded-full bg-nox-accent hover:bg-nox-accentHover text-white text-sm w-full disabled:opacity-50 transition-all hover:scale-[1.02]"
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
          className="px-3 py-1.5 rounded-lg bg-nox-accent/20 hover:bg-nox-accent/30 text-nox-accent text-sm font-medium transition-colors disabled:opacity-50"
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
    <div className="flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nox-border/50">
        <div className="flex items-center gap-2">
          {activeCat ? (
            <button
              onClick={() => setActiveCategory(null)}
              className="flex items-center justify-center w-8 h-8 rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-all hover:scale-105"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <img src={noxLogo} alt="Nox" className="h-6 w-6 rounded-full" />
          )}
          <span className="text-sm font-semibold text-nox-text">
            {activeCat ? activeCat.label : s.title}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-all hover:scale-105"
          aria-label={s.back}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6L18 18M6 18L18 6" />
          </svg>
        </button>
      </div>

      {/* Search bar (only on main page) */}
      {!activeCategory && (
        <div className="px-4 py-2 border-b border-nox-border/50">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-nox-textDim" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Einstellungen durchsuchen..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-nox-surface text-nox-text text-sm border border-nox-border/50 focus:outline-none focus:border-nox-accent transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6L18 18M6 18L18 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {activeCategory && activeCat ? (
          /* Sub-page: show selected category settings */
          <div className="glass-card p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-nox-accent/15 text-nox-accent text-sm">
                {activeCat.icon}
              </div>
              <h3 className="text-xs font-semibold text-nox-text uppercase tracking-wide">{activeCat.label}</h3>
            </div>
            <div className="space-y-2">
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
                className="glass-card w-full p-4 flex items-center gap-3 text-left transition-all hover:scale-[1.02] hover:bg-nox-surface/60"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-nox-accent/15 text-nox-accent text-lg flex-shrink-0">
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-nox-text">{cat.label}</span>
                  {cat.id === "ai" && settings.ollama_model && (
                    <p className="text-xs text-nox-textDim truncate">{settings.ollama_model}</p>
                  )}
                  {cat.id === "voice" && settings.tts_model && (
                    <p className="text-xs text-nox-textDim truncate">{settings.tts_model}</p>
                  )}
                  {cat.id === "files" && filesHealth && (
                    <p className="text-xs text-nox-textDim truncate">
                      {filesHealth.files_indexed ?? 0} Dateien indexiert
                    </p>
                  )}
                </div>
                <svg className="w-4 h-4 text-nox-textDim flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
            <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4" />
              <path className="opacity-75" strokeWidth="4" strokeLinecap="round" d="M4 12a8 8 0 018-8" />
            </svg>
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
