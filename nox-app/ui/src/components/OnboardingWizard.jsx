import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogoGlowing from "../assets/nox-logo-glowing.png";
import noxIcon from "../assets/nox-icon.png";
import { useToast } from "./Toast.jsx";

const API_BASE = "http://127.0.0.1:8420";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

// Map language codes to ISO 3166-1 alpha-2 country codes for flagcdn.com
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

function LanguageDropdown({ voiceCatalog, selectedLang, onSelect, label, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const toggle = (v) => {
    const next = typeof v === "boolean" ? v : !open;
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) toggle(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const entries = Object.entries(voiceCatalog || {}).sort(
    ([, a], [, b]) => a.language_name.localeCompare(b.language_name)
  );
  const selected = entries.find(([code]) => code === selectedLang);
  const selectedCode = selected ? selected[0] : null;
  const selectedName = selected ? selected[1].language_native : "—";

  return (
    <div className="w-full max-w-xs space-y-1.5" ref={ref}>
      <label className="text-xs font-medium text-nox-textDim uppercase tracking-wide text-left block">
        {label}
      </label>
      <div className="relative">
        <button
          onClick={() => toggle()}
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
          <div className="absolute z-50 mt-1 w-full max-h-32 overflow-y-auto rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-black/40 py-0.5">
            {entries.map(([code, info]) => {
              const isSelected = selectedLang === code;
              return (
                <button
                  key={code}
                  onClick={() => {
                    onSelect(code);
                    toggle(false);
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

function OnboardingWizard({ locale, onLocaleChange, onComplete }) {
  const { addToast } = useToast();
  const s = locale.onboarding || {};
  const [step, setStep] = useState(0);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [ollamaOk, setOllamaOk] = useState(null);
  const [micOk, setMicOk] = useState(null);
  const [wakeOk, setWakeOk] = useState(null);
  const [wakeAttempts, setWakeAttempts] = useState(0);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [audioDevices, setAudioDevices] = useState({ input: [], output: [] });
  const [selectedInput, setSelectedInput] = useState("default");
  const [selectedOutput, setSelectedOutput] = useState("default");

  // Voice catalog state
  const [voiceCatalog, setVoiceCatalog] = useState(null);
  const [systemLang, setSystemLang] = useState(null);
  const [selectedLang, setSelectedLang] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [selectedEngine, setSelectedEngine] = useState("kokoro");
  const [previewPlaying, setPreviewPlaying] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const previewAudioRef = useRef(null);
  const [engines, setEngines] = useState(null);
  const [edgeCatalog, setEdgeCatalog] = useState(null);
  const [kokoroCatalog, setKokoroCatalog] = useState(null);

  // Ollama install state
  const [ollamaInstallPhase, setOllamaInstallPhase] = useState("idle");
  const [ollamaInstallProgress, setOllamaInstallProgress] = useState(0);
  const [ollamaInstallError, setOllamaInstallError] = useState(null);

  // Model pull state
  const [pullProgress, setPullProgress] = useState(0);
  const [pullRunning, setPullRunning] = useState(false);
  const [pullError, setPullError] = useState(null);
  const [pullModel, setPullModel] = useState("");
  const [pullBytes, setPullBytes] = useState({ completed: 0, total: 0, speed: 0 });
  const [sliderPos, setSliderPos] = useState(1);
  const [showInstalledModels, setShowInstalledModels] = useState(false);

  const pollRef = useRef(null);
  const wakeTestActiveRef = useRef(false);

  const steps = [
    s.welcome || "Willkommen",
    s.voiceSelect || "Stimme",
    s.modelSelect || "Modell wählen",
    s.audioDevices || "Audio-Geräte",
    s.wakeCalibration || "Wake-Word-Kalibrierung",
    s.done || "Fertig",
  ];

  // Notify Electron to keep window visible during onboarding
  useEffect(() => {
    window.nox?.onboardingActive?.();
  }, []);

  // Auto-select model when slider position changes and the tier's model is installed
  useEffect(() => {
    if (step !== 2 || !gpuInfo) return;
    const vram = gpuInfo?.vram_mb || 0;
    let model;
    if (vram >= 20000) {
      model = sliderPos === 0 ? "qwen3:14b" : sliderPos === 1 ? "qwen3:32b" : "qwen3:32b";
    } else if (vram >= 12000) {
      model = sliderPos === 0 ? "qwen3:8b" : sliderPos === 1 ? "qwen3:14b" : "qwen3:32b";
    } else if (vram >= 8000) {
      model = sliderPos === 0 ? "qwen3:4b" : sliderPos === 1 ? "qwen3:8b" : "qwen3:14b";
    } else {
      model = sliderPos === 0 ? "qwen3:1.7b" : sliderPos === 1 ? "qwen3:4b" : "qwen3:8b";
    }
    if (model && models.includes(model)) {
      setSelectedModel(model);
    }
  }, [sliderPos, step, gpuInfo, models]);

  // Poll wake detection status during onboarding step 4
  useEffect(() => {
    if (step !== 4 || !wakeOk) return;
    let lastCount = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/wake-status`);
        const data = await res.json();
        if (data.count > lastCount) {
          lastCount = data.count;
          setWakeAttempts(data.count);
        }
      } catch {}
    }, 500);
    return () => clearInterval(interval);
  }, [step, wakeOk]);

  // Start/stop wake word test when entering/leaving step 4
  useEffect(() => {
    if (step === 4 && wakeOk) {
      // Start wake word test
      fetch(`${API_BASE}/api/onboarding/test-wake-word`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_device: selectedInput }),
      }).then(() => {
        wakeTestActiveRef.current = true;
      }).catch((err) => {
        console.error("Failed to start wake word test:", err);
        addToast({ type: "warning", title: "Wake Word", message: "Wake-Word-Test konnte nicht gestartet werden", detail: String(err), duration: 4000 });
      });
    } else if (wakeTestActiveRef.current) {
      // Stop wake word test
      fetch(`${API_BASE}/api/onboarding/stop-wake-word-test`, { method: "POST" }).catch(() => {});
      wakeTestActiveRef.current = false;
    }
  }, [step, wakeOk, selectedInput]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wakeTestActiveRef.current) {
        fetch(`${API_BASE}/api/onboarding/stop-wake-word-test`, { method: "POST" }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        setOllamaOk(data?.ollama?.status === "ok");
        setMicOk(data?.microphone?.available === true);
        setWakeOk(data?.wake_word?.model_exists === true);
        if (data?.ollama?.status === "ok") {
          const modelsRes = await fetch(`${API_BASE}/api/models`);
          const modelsData = await modelsRes.json();
          setModels(modelsData.available_models || []);
          if (modelsData.current_model) setSelectedModel(modelsData.current_model);
        }
      } catch (err) {
        console.error("Status check failed:", err);
        setOllamaOk(false);
        addToast({ type: "warning", title: "Status", message: "System-Status konnte nicht abgerufen werden", detail: String(err), duration: 4000 });
      }
      try {
        const gpuRes = await fetch(`${API_BASE}/api/onboarding/gpu-check`);
        setGpuInfo(await gpuRes.json());
      } catch (err) {
        console.error("GPU check failed:", err);
        addToast({ type: "info", title: "GPU", message: "GPU-Check fehlgeschlagen – CPU-Modus wird verwendet", detail: String(err), duration: 4000 });
      }
    };
    checkStatus();
  }, []);

  // Fetch audio devices
  useEffect(() => {
    const fetchAudioDevices = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/audio/devices`);
        const data = await res.json();
        if (data.status === "ok") {
          setAudioDevices({ input: data.input || [], output: data.output || [] });
        }
      } catch (err) {
        console.error("Audio devices fetch failed:", err);
        addToast({ type: "warning", title: "Audio", message: "Audio-Geräte konnten nicht abgerufen werden", detail: String(err), duration: 4000 });
      }
    };
    fetchAudioDevices();
  }, []);

  // Fetch voice catalog, installed voices, system language, engines, edge catalog, kokoro catalog
  useEffect(() => {
    const fetchVoiceData = async () => {
      try {
        const [catRes, langRes, engRes, edgeRes, kokoroRes] = await Promise.all([
          fetch(`${API_BASE}/api/voices/catalog`),
          fetch(`${API_BASE}/api/voices/system-language`),
          fetch(`${API_BASE}/api/voices/engines`),
          fetch(`${API_BASE}/api/voices/edge/catalog`),
          fetch(`${API_BASE}/api/voices/kokoro/catalog`),
        ]);
        const catData = await catRes.json();
        const langData = await langRes.json();
        const engData = await engRes.json();
        const edgeData = await edgeRes.json();
        const kokoroData = await kokoroRes.json();
        if (catData.status === "ok") setVoiceCatalog(catData.catalog);
        if (langData.status === "ok") {
          setSystemLang(langData);
          setSelectedLang(langData.language_code);
          if (langData.default_voice) {
            setSelectedVoice(langData.default_voice);
            setSelectedEngine(langData.default_engine || "kokoro");
          }
        }
        if (engData.status === "ok") setEngines(engData.engines);
        if (edgeData.status === "ok") setEdgeCatalog(edgeData.catalog);
        if (kokoroData.status === "ok") setKokoroCatalog(kokoroData.catalog);
      } catch (err) {
        console.error("Voice catalog fetch failed:", err);
      }
    };
    fetchVoiceData();
  }, []);

  const saveVoiceSetting = async (voiceName, engine = "piper") => {
    if (!voiceName) return;
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
    if (_stopAndToggle(`edge:${voiceId}`)) return;
    setPreviewPlaying(`edge:${voiceId}`);
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

  const checkOllama = async () => {
    try {
      const res = await fetch(`${API_BASE}/health/ollama`);
      const data = await res.json();
      const ok = data.status === "ok";
      setOllamaOk(ok);
      if (ok) {
        const modelsRes = await fetch(`${API_BASE}/api/models`);
        const modelsData = await modelsRes.json();
        setModels(modelsData.available_models || []);
        if (modelsData.current_model) setSelectedModel(modelsData.current_model);
      }
      return ok;
    } catch {
      setOllamaOk(false);
      return false;
    }
  };

  const startOllamaInstall = async () => {
    setOllamaInstallPhase("downloading");
    setOllamaInstallProgress(0);
    setOllamaInstallError(null);
    try {
      await fetch(`${API_BASE}/api/onboarding/install-ollama`, { method: "POST" });
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/install-status`);
          const data = await res.json();
          setOllamaInstallProgress(data.progress || 0);
          setOllamaInstallPhase(data.phase || "downloading");
          if (data.error === "timeout") {
            setOllamaInstallError("timeout");
            setOllamaInstallPhase("error");
            return;
          }
          if (data.installing) {
            pollRef.current = setTimeout(poll, 1000);
          } else if (data.phase === "done") {
            setTimeout(async () => {
              const ok = await checkOllama();
              setOllamaInstallPhase(ok ? "done" : "error");
              if (!ok) setOllamaInstallError("not_found_after_install");
            }, 3000);
          }
        } catch {
          pollRef.current = setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setOllamaInstallError(String(err));
      setOllamaInstallPhase("error");
    }
  };

  const startModelPull = async (model) => {
    setPullModel(model);
    setPullProgress(0);
    setPullRunning(true);
    setPullError(null);
    setPullBytes({ completed: 0, total: 0, speed: 0 });
    try {
      await fetch(`${API_BASE}/api/onboarding/pull-ollama-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
          const data = await res.json();
          setPullProgress(data.progress || 0);
          setPullBytes({ completed: data.completed || 0, total: data.total || 0, speed: data.speed || 0 });
          if (data.running) {
            pollRef.current = setTimeout(poll, 1000);
          } else {
            setPullRunning(false);
            if (data.error) {
              setPullError(data.error);
            } else {
              const modelsRes = await fetch(`${API_BASE}/api/models`);
              const modelsData = await modelsRes.json();
              setModels(modelsData.available_models || []);
              setSelectedModel(model);
            }
          }
        } catch {
          pollRef.current = setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setPullError(String(err));
      setPullRunning(false);
    }
  };

  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const saveModel = async () => {
    if (!selectedModel) return;
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollama_model: selectedModel }),
      });
    } catch (err) {
      console.error("Failed to save model:", err);
      addToast({ type: "warning", title: "Onboarding", message: "Modell konnte nicht gespeichert werden", detail: String(err), duration: 4000 });
    }
  };

  const finish = async () => {
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_completed: true }),
      });
    } catch (err) {
      console.error("Failed to save onboarding state:", err);
      addToast({ type: "warning", title: "Onboarding", message: "Onboarding-Status konnte nicht gespeichert werden", detail: String(err), duration: 4000 });
    }
    onComplete();
  };

  const saveAudioDevices = async () => {
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_input_device: selectedInput,
          audio_output_device: selectedOutput,
        }),
      });
    } catch (err) {
      console.error("Failed to save audio devices:", err);
      addToast({ type: "warning", title: "Onboarding", message: "Audio-Geräte konnten nicht gespeichert werden", detail: String(err), duration: 4000 });
    }
  };

  const next = () => {
    if (step === 1) saveVoiceSetting(selectedVoice, selectedEngine);
    if (step === 2) saveModel();
    if (step === 3) saveAudioDevices();
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const prev = () => setStep((p) => Math.max(p - 1, 0));

  const btnClass =
    "px-4 py-2 rounded-full text-sm font-medium transition-all";
  const btnPrimary = btnClass + " bg-nox-accent hover:bg-nox-accentHover text-white hover:scale-105";
  const btnSecondary = btnClass + " glass-card text-nox-text hover:scale-105";
  const btnDisabled = btnClass + " bg-nox-border/50 text-nox-textDim cursor-not-allowed";

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-nox-border/50">
        <div className="flex items-center gap-2">
          <img src={noxIcon} alt="Nox" className="w-5 h-5 rounded-full" />
          <h2 className="text-sm font-semibold text-nox-text">{s.title || "Nox einrichten"}</h2>
        </div>
        <span className="text-xs text-nox-textDim">
          {step + 1} / {steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-nox-border/50">
        <div
          className="h-full bg-nox-accent transition-all duration-300 rounded-full"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6" style={{ overflow: openDropdown ? 'hidden' : undefined }}>
        {/* Step 0: Welcome + Language selection + Ollama check/install + GPU info */}
        {step === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <img src={noxLogoGlowing} alt="Nox" className="w-48 h-auto rounded-xl" />
            <h3 className="text-lg font-semibold text-nox-text">{s.welcomeTitle || "Willkommen bei Nox"}</h3>
            <p className="text-sm text-nox-textDim max-w-xs">
              {s.welcomeText || "Nox ist dein lokaler KI-Assistent. Lass uns ihn in wenigen Schritten einrichten."}
            </p>

            {/* Language selector — custom dropdown */}
            {voiceCatalog && (
              <LanguageDropdown
                voiceCatalog={voiceCatalog}
                selectedLang={selectedLang}
                onSelect={async (code) => {
                  setSelectedLang(code);
                  setSelectedVoice("");
                  if (onLocaleChange) onLocaleChange(code);
                  try {
                    await fetch(`${API_BASE}/api/settings`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ system_language: code }),
                    });
                    const res = await fetch(`${API_BASE}/api/voices/default/${code}`);
                    const data = await res.json();
                    if (data.status === "ok") {
                      setSelectedVoice(data.default_voice);
                      setSelectedEngine(data.default_engine);
                    }
                  } catch (err) {
                    console.error("Failed to fetch default voice:", err);
                  }
                }}
                label={s.selectLanguage || "Sprache wählen"}
                onOpenChange={setOpenDropdown}
              />
            )}

            <div className="mt-2 space-y-3 w-full max-w-xs">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg glass-card text-sm">
                <span className="text-nox-textDim">Ollama</span>
                {ollamaOk === null ? (
                  <span className="text-nox-textDim">…</span>
                ) : ollamaOk ? (
                  <span className="text-green-500">✓ {s.available || "Verfügbar"}</span>
                ) : (
                  <span className="text-red-500">✗ {s.missing || "Nicht gefunden"}</span>
                )}
              </div>
              {gpuInfo && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg glass-card text-sm">
                  <span className="text-nox-textDim">{s.gpu || "GPU"}</span>
                  <span className={gpuInfo.cuda_available ? "text-green-500" : "text-yellow-500"}>
                    {gpuInfo.cuda_available
                      ? `✓ CUDA (${gpuInfo.gpu_name || "GPU"})`
                      : gpuInfo.nvidia_driver_present
                      ? "⚠ CPU-Fallback"
                      : "CPU-Modus"}
                  </span>
                </div>
              )}
              {gpuInfo && !gpuInfo.cuda_available && (
                <p className="text-xs text-yellow-400 px-3">
                  {s.gpuCpuFallback || "CUDA nicht verfügbar – Nox läuft im CPU-Modus. Voice wird langsamer sein, Text-Chat funktioniert normal."}
                </p>
              )}
              {!ollamaOk && ollamaOk !== null && ollamaInstallPhase === "idle" && (
                <div className="space-y-2">
                  <button onClick={startOllamaInstall} className={btnPrimary + " w-full"}>
                    {s.installOllama || "Ollama automatisch installieren"}
                  </button>
                  <p className="text-xs text-nox-textDim px-3">
                    {s.ollamaManualHint || "Oder manuell installieren von "}
                    <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-nox-accent underline">
                      ollama.com/download
                    </a>
                  </p>
                  <button onClick={checkOllama} className={btnSecondary + " w-full"}>
                    {s.retryCheck || "Erneut prüfen"}
                  </button>
                </div>
              )}
              {ollamaInstallPhase === "downloading" && (
                <div className="space-y-2">
                  <p className="text-xs text-nox-textDim">
                    {s.downloadingOllama || "Lade Ollama herunter…"} {Math.round(ollamaInstallProgress * 100)}%
                  </p>
                  <div className="w-full h-2 rounded-full bg-nox-border overflow-hidden">
                    <div className="h-full bg-nox-accent transition-all duration-300 rounded-full" style={{ width: `${Math.round(ollamaInstallProgress * 100)}%` }} />
                  </div>
                </div>
              )}
              {ollamaInstallPhase === "installing" && (
                <p className="text-xs text-nox-accent animate-pulse">
                  {s.installingOllama || "Installiere Ollama…"}
                </p>
              )}
              {ollamaInstallPhase === "done" && (
                <p className="text-xs text-green-500">✓ {s.ollamaInstalled || "Ollama installiert!"}</p>
              )}
              {ollamaInstallPhase === "error" && (
                <div className="space-y-2">
                  <p className="text-xs text-red-400">
                    {ollamaInstallError === "timeout"
                      ? (s.ollamaInstallTimeout || "Zeitüberschreitung bei der Installation.")
                      : (s.ollamaInstallFailed || "Automatische Installation fehlgeschlagen.")}
                  </p>
                  <p className="text-xs text-nox-textDim">
                    {s.ollamaManualHint || "Bitte manuell installieren von "}
                    <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-nox-accent underline">
                      ollama.com/download
                    </a>
                  </p>
                  <button onClick={checkOllama} className={btnSecondary + " w-full"}>
                    {s.retryCheck || "Erneut prüfen"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 1: Voice selection */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-nox-text">{s.selectVoice || "Stimme wählen"}</h3>
              {selectedLang && voiceCatalog && (
                <span className="flex items-center gap-1.5 text-xs text-nox-textDim">
                  <FlagIcon code={selectedLang} size={14} />
                  {voiceCatalog[selectedLang]?.language_native}
                </span>
              )}
            </div>
            <p className="text-sm text-nox-textDim">
              {s.voiceHintOnly || "Wähle eine Stimme für Nox."}
            </p>

            {/* Voice list — grouped by gender */}
            {voiceCatalog && selectedLang && (() => {
              const allVoices = [
                ...(kokoroCatalog?.[selectedLang]?.voices || []).map((v) => ({ ...v, _engine: "kokoro" })),
                ...(edgeCatalog?.[selectedLang]?.voices || []).map((v) => ({ ...v, _engine: "edge" })),
              ];
              const female = allVoices.filter((v) => v.gender === "female").sort((a, b) => a.name.localeCompare(b.name));
              const male = allVoices.filter((v) => v.gender === "male").sort((a, b) => a.name.localeCompare(b.name));
              const renderGroup = (label, voices) => voices.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-nox-textDim uppercase tracking-wide">{label}</span>
                    <div className="flex-1 h-px bg-nox-border" />
                  </div>
                  <div className="space-y-1.5">
                    {voices.map((v) => {
                      const isPreviewing = previewPlaying === `${v._engine}:${v.id}`;
                      const isSelected = selectedVoice === v.id && selectedEngine === v._engine;
                      const isCloud = v._engine === "edge";
                      const desc = v.description ? v.description.replace(/^Female\s+/i, "").replace(/^Male\s+/i, "").replace(/^Weiblich,\s*/i, "").replace(/^Männlich,\s*/i, "") : "";
                      return (
                        <div
                          key={`${v._engine}:${v.id}`}
                          className={`px-3 py-2.5 rounded-lg text-sm transition-all border cursor-pointer ${
                            isSelected
                              ? "bg-nox-accent/10 border-nox-accent shadow-sm shadow-nox-accent/20"
                              : "bg-nox-surface border-nox-border hover:border-nox-accent/40 hover:bg-nox-surface/80"
                          }`}
                          onClick={() => {
                            setSelectedVoice(v.id);
                            setSelectedEngine(v._engine);
                            saveVoiceSetting(v.id, v._engine);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="font-medium text-nox-text">{v.name}</span>
                              {isCloud && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium leading-none">Cloud</span>
                              )}
                              {isSelected && (
                                <svg className="w-4 h-4 text-nox-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCloud) playEdgePreview(selectedLang, v.id);
                                else playKokoroPreview(selectedLang, v.id);
                              }}
                              className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0 ${
                                isPreviewing ? "bg-nox-accent text-white" : "bg-nox-border/50 text-nox-textDim hover:bg-nox-accent/20 hover:text-nox-text"
                              }`}
                            >
                              {isPreviewing ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 8.5a3.5 3.5 0 10-1 5.83M11 5L6 9H3v6h3l5 4V5z" /></svg>
                              )}
                            </button>
                          </div>
                          {desc && <p className="text-xs text-nox-textDim mt-1">{desc}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
              if (!female.length && !male.length) {
                return (
                  <div className="px-3 py-4 rounded-lg glass-card border border-nox-border/50 text-center">
                    <p className="text-sm text-nox-textDim">Keine Stimmen für diese Sprache.</p>
                  </div>
                );
              }
              return <div className="space-y-4">{renderGroup("Weiblich", female)}{renderGroup("Männlich", male)}</div>;
            })()}

            {previewError && (
              <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                <div className="flex items-start gap-2">
                  <span className="text-red-400 text-sm flex-shrink-0">⚠</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-red-300 break-words">{previewError}</p>
                  </div>
                  <button
                    onClick={() => setPreviewError(null)}
                    className="text-red-400/60 hover:text-red-400 text-xs flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Model selection / pull */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.chooseModel || "KI-Modell wählen"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.modelHint || "Wähle das Ollama-Modell, das Nox verwenden soll."}
            </p>

            {/* Quality vs Speed slider — picks model based on VRAM and preference */}
            {(() => {
              const vram = gpuInfo?.vram_mb || 0;
              const gpuMode = gpuInfo?.cuda_available ? "GPU" : "CPU";

              // Build model tiers based on VRAM — Qwen 3 family
              let tiers;
              if (vram >= 20000) {
                tiers = [
                  { model: "qwen3:14b", label: "Qwen 3 14B", desc: "Schnell, Tool-Calling – gut für einfache Aufgaben.", size: "~9 GB" },
                  { model: "qwen3:32b", label: "Qwen 3 32B", desc: "Beste Balance – Tool-Calling, Thinking, 40K Kontext.", size: "~20 GB" },
                  { model: "qwen3:32b", label: "Qwen 3 32B", desc: "Höchste Qualität für deine GPU (" + Math.round(vram/1024) + " GB VRAM).", size: "~20 GB" },
                ];
              } else if (vram >= 12000) {
                tiers = [
                  { model: "qwen3:8b", label: "Qwen 3 8B", desc: "Sehr schnell, kompakt – gut für einfache Aufgaben.", size: "~5 GB" },
                  { model: "qwen3:14b", label: "Qwen 3 14B", desc: "Beste Balance für " + Math.round(vram/1024) + " GB VRAM – Tool-Calling, Thinking.", size: "~9 GB" },
                  { model: "qwen3:32b", label: "Qwen 3 32B", desc: "Maximale Qualität – braucht ~20 GB, kann langsam sein.", size: "~20 GB" },
                ];
              } else if (vram >= 8000) {
                tiers = [
                  { model: "qwen3:4b", label: "Qwen 3 4B", desc: "Sehr schnell, ideal für 8 GB VRAM.", size: "~2.5 GB" },
                  { model: "qwen3:8b", label: "Qwen 3 8B", desc: "Gute Balance – Tool-Calling, kompakt mit ~5 GB.", size: "~5 GB" },
                  { model: "qwen3:14b", label: "Qwen 3 14B", desc: "Maximale Qualität – braucht ~9 GB, kann langsam sein.", size: "~9 GB" },
                ];
              } else {
                tiers = [
                  { model: "qwen3:1.7b", label: "Qwen 3 1.7B", desc: "Schnell und kompakt – funktioniert überall.", size: "~1.5 GB" },
                  { model: "qwen3:4b", label: "Qwen 3 4B", desc: "Beste Wahl für CPU oder wenig VRAM.", size: "~2.5 GB" },
                  { model: "qwen3:8b", label: "Qwen 3 8B", desc: "Höchste Qualität für begrenzte Hardware – Tool-Calling.", size: "~5 GB" },
                ];
              }

              const sliderLabels = ["⚡ Schnell", "⚖️ Balance", "★ Qualität"];
              const tier = tiers[sliderPos];
              const isInstalled = models.includes(tier.model);

              return (
                <div className="space-y-3">
                  {/* GPU info badge */}
                  <div className="flex items-center gap-2 text-xs text-nox-textDim">
                    <span className="px-2 py-0.5 rounded bg-nox-surface border border-nox-border">{gpuMode}</span>
                    {vram > 0 && <span>{Math.round(vram/1024)} GB VRAM</span>}
                  </div>

                  {/* Slider */}
                  <div className="px-1">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={1}
                      value={sliderPos}
                      onChange={(e) => setSliderPos(parseInt(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer bg-nox-border accent-nox-accent"
                      style={{
                        background: `linear-gradient(to right, var(--color-nox-accent, #6366f1) ${sliderPos * 50}%, var(--color-nox-border, #2a2a2e) ${sliderPos * 50}%)`,
                      }}
                    />
                    <div className="flex justify-between mt-1.5">
                      {sliderLabels.map((label, i) => (
                        <span
                          key={i}
                          className={`text-xs transition-colors ${sliderPos === i ? "text-nox-accent font-medium" : "text-nox-textDim"}`}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Selected tier info */}
                  <div className="px-3 py-3 rounded-lg bg-nox-surface border border-nox-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-nox-text">{tier.label}</span>
                      <span className="text-xs text-nox-textDim">{tier.size}</span>
                    </div>
                    <p className="text-xs text-nox-textDim">{tier.desc}</p>
                    {isInstalled ? (
                      <div className="flex items-center gap-1.5 text-xs text-green-400">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        <span>Bereits installiert – ausgewählt als Modell</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => startModelPull(tier.model)}
                        disabled={pullRunning}
                        className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          pullRunning && pullModel === tier.model
                            ? "bg-nox-accent/30 text-nox-textDim"
                            : "bg-nox-accent hover:bg-nox-accentHover text-white"
                        }`}
                      >
                        {pullRunning && pullModel === tier.model
                          ? `${s.downloading || "Lade herunter"}… ${Math.round(pullProgress * 100)}%`
                          : `⬇ ${tier.label} herunterladen`}
                      </button>
                    )}
                    {pullRunning && pullModel === tier.model && (
                      <div className="space-y-1.5">
                        <div className="w-full h-2 rounded-full bg-nox-border overflow-hidden">
                          <div className="h-full bg-nox-accent transition-all duration-300 rounded-full" style={{ width: `${Math.round(pullProgress * 100)}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-nox-textDim">
                          <span>
                            {pullBytes.completed > 0
                              ? `${(pullBytes.completed / 1048576).toFixed(0)} / ${(pullBytes.total / 1048576).toFixed(0)} MB`
                              : `${Math.round(pullProgress * 100)}%`}
                          </span>
                          {pullBytes.speed > 0 && (
                            <span>{(pullBytes.speed / 1048576).toFixed(1)} MB/s</span>
                          )}
                        </div>
                      </div>
                    )}
                    {pullError && pullModel === tier.model && (
                      <p className="text-xs text-red-400">{s.pullFailed || "Download fehlgeschlagen:"} {pullError}</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Collapsible installed models */}
            {models.length > 0 && (
              <div className="space-y-1">
                <button
                  onClick={() => setShowInstalledModels(!showInstalledModels)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg glass-card text-sm text-nox-textDim hover:text-nox-text transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showInstalledModels ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                    </svg>
                    {s.installedModels || "Installierte Modelle"} ({models.length})
                  </span>
                  {selectedModel && (
                    <span className="text-xs text-nox-accent font-medium">{selectedModel}</span>
                  )}
                </button>
                {showInstalledModels && (
                  <div className="space-y-1 pt-1">
                    {models.map((m) => (
                      <button
                        key={m}
                        onClick={() => setSelectedModel(m)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-white" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* No models at all — manual download */}
            {models.length === 0 && (
              <div className="px-3 py-4 rounded-lg glass-card space-y-3">
                <p className="text-sm text-nox-textDim">
                  {s.noModels || "Keine Modelle gefunden. Lade ein Modell über den Slider oben herunter."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Audio device selection */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.audioDevices || "Audio-Geräte wählen"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.audioDevicesHint || "Wähle welches Mikrofon und welche Lautsprecher Nox verwenden soll."}
            </p>
            <div className="space-y-3">
              <div className="px-3 py-3 rounded-lg glass-card space-y-2">
                <label className="text-xs font-medium text-nox-textDim uppercase tracking-wide">
                  {s.audioInput || "Eingang (Mikrofon)"}
                </label>
                <select
                  className="w-full bg-nox-bg text-nox-text text-sm rounded-lg px-3 py-2 border border-nox-border focus:outline-none focus:border-nox-accent"
                  value={selectedInput}
                  onChange={(e) => setSelectedInput(e.target.value)}
                >
                  <option value="default">{s.audioDefault || "Standardgerät"}</option>
                  {audioDevices.input.map((d) => (
                    <option key={d.index} value={d.name}>
                      {d.name}{d.is_default ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="px-3 py-3 rounded-lg glass-card space-y-2">
                <label className="text-xs font-medium text-nox-textDim uppercase tracking-wide">
                  {s.audioOutput || "Ausgang (Lautsprecher)"}
                </label>
                <select
                  className="w-full bg-nox-bg text-nox-text text-sm rounded-lg px-3 py-2 border border-nox-border focus:outline-none focus:border-nox-accent"
                  value={selectedOutput}
                  onChange={(e) => setSelectedOutput(e.target.value)}
                >
                  <option value="default">{s.audioDefault || "Standardgerät"}</option>
                  {audioDevices.output.map((d) => (
                    <option key={d.index} value={d.name}>
                      {d.name}{d.is_default ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {audioDevices.input.length === 0 && (
              <p className="text-xs text-yellow-400">
                {s.noAudioDevices || "Keine Audio-Geräte gefunden. Du kannst Nox per Text bedienen."}
              </p>
            )}
          </div>
        )}

        {/* Step 4: Wake word calibration */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.wakeTitle || "Wake-Word-Kalibrierung"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.wakeHint || "Sage 3× 'Hey Nox', um die Erkennung zu testen."}
            </p>
            <div className="px-3 py-4 rounded-lg glass-card">
              {wakeOk === null ? (
                <span className="text-nox-textDim text-sm">…</span>
              ) : wakeOk ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-green-500 text-lg">✓</span>
                    <span className="text-sm text-nox-text">{s.wakeModelFound || "Wake-Word-Modell gefunden"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-nox-textDim">{s.wakeAttempts || "Erkennungen:"}</span>
                    <span className="text-nox-accent font-medium">{wakeAttempts} / 3</span>
                  </div>
                  {wakeAttempts < 3 ? (
                    <p className="text-xs text-nox-textDim">
                      {s.wakeSay || "Sage 'Hey Nox' in dein Mikrofon…"}
                    </p>
                  ) : (
                    <p className="text-xs text-green-500">
                      {s.wakeCalibrated || "Kalibrierung erfolgreich!"}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-500 text-lg">⚠</span>
                    <span className="text-sm text-nox-text">{s.wakeModelMissing || "Wake-Word-Modell nicht gefunden"}</span>
                  </div>
                  <p className="text-xs text-nox-textDim">
                    {s.wakeModelHint || "Platziere 'hey_nox.onnx' im models/-Ordner. Du kannst diesen Schritt überspringen und Nox per Text oder Mic-Button nutzen."}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Done */}
        {step === 5 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-green-500 text-3xl">✓</span>
            </div>
            <h3 className="text-lg font-semibold text-nox-text">{s.setupComplete || "Einrichtung abgeschlossen"}</h3>
            <p className="text-sm text-nox-textDim max-w-xs">
              {s.setupCompleteText || "Nox ist bereit. Du kannst jetzt Fragen stellen, Sprache verwenden und Kontext erfassen lassen."}
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-nox-border/50">
        <button
          onClick={prev}
          disabled={step === 0}
          className={step === 0 ? btnDisabled : btnSecondary}
        >
          {s.back || "Zurück"}
        </button>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${i === step ? "bg-nox-accent" : "bg-nox-border"}`}
            />
          ))}
        </div>
        {step < steps.length - 1 ? (
          <button
            onClick={next}
            disabled={(step === 0 && !ollamaOk) || (step === 1 && !selectedVoice) || (step === 2 && (pullRunning || (selectedModel && !models.includes(selectedModel))))}
            className={(step === 0 && !ollamaOk) || (step === 1 && !selectedVoice) || (step === 2 && (pullRunning || (selectedModel && !models.includes(selectedModel)))) ? btnDisabled : btnPrimary}
          >
            {s.next || "Weiter"}
          </button>
        ) : (
          <button onClick={finish} className={btnPrimary}>
            {s.finish || "Fertig"}
          </button>
        )}
      </div>
    </div>
  );
}

export default OnboardingWizard;
