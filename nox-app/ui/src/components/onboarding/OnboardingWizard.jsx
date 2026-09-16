import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import NoxAvatar from "../common/NoxAvatar.jsx";
import SpeedGraph from "./SpeedGraph.jsx";
import { useToast } from "../common/Toast.jsx";
import { API_BASE, FlagIcon, LanguageDropdown } from "../../shared/constants.jsx";
import { MODEL_TABLE } from "../../shared/modelTable.js";
import { IconWarning, IconArrowDown, IconCheck, IconX } from "../../shared/Icon.jsx";
import { parseModelBadge, isCloudModel, GGUF_FILENAMES, prettyVoiceName } from "../../shared/prettyNames.jsx";

const IconLightning = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
);
const IconRocket = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.16 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.16-1.62 0-5 0-5" /></svg>
);
const IconScale = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16l3-8 3 8c-2 1.5-4 1.5-6 0" /><path d="M2 16l3-8 3 8c-2 1.5-4 1.5-6 0" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></svg>
);
const IconStar = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
);

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

const OPENAI_PROVIDERS = [
  { id: "lmstudio",      nameKey: "providerLMStudio",      descKey: "providerLMStudioDesc",      endpoint: "http://localhost:1234/v1",     gpus: ["Nvidia (CUDA)", "AMD (ROCm)", "Intel (OneAPI)"], type: "lokal" },
  { id: "llamacpp",      nameKey: "providerLlamaCpp",      descKey: "providerLlamaCppDesc",      endpoint: "http://127.0.0.1:8080/v1",     gpus: ["Nvidia (CUDA)", "AMD (ROCm)", "Intel (OneAPI)"], type: "lokal" },
  { id: "jan",           nameKey: "providerJan",           descKey: "providerJanDesc",           endpoint: "http://127.0.0.1:1337/v1",     gpus: ["Nvidia (CUDA)", "AMD (ROCm)", "Intel (OneAPI)"], type: "lokal" },
  { id: "gpt4all",       nameKey: "providerGPT4All",       descKey: "providerGPT4AllDesc",       endpoint: "http://localhost:4891/v1",     gpus: ["Nvidia (CUDA)", "AMD (Vulkan)", "Intel (Vulkan)"], type: "lokal" },
  { id: "koboldcpp",     nameKey: "providerKoboldCpp",    descKey: "providerKoboldCppDesc",    endpoint: "http://localhost:5001/v1",     gpus: ["Nvidia (CUDA)", "AMD (ROCm)", "Intel (OneAPI)"], type: "lokal" },
  { id: "vllm",          nameKey: "providerVLLM",          descKey: "providerVLLMDesc",          endpoint: "http://localhost:8000/v1",      gpus: ["Nvidia (CUDA)", "AMD (ROCm)"], type: "lokal" },
  { id: "openrouter",    nameKey: "providerOpenRouter",   descKey: "providerOpenRouterDesc",     endpoint: "https://openrouter.ai/api/v1",  gpus: ["Cloud"], type: "cloud", needsKey: true },
  { id: "kimi",          nameKey: "providerKimi",          descKey: "providerKimiDesc",          endpoint: "https://api.kimi.com/coding/v1", gpus: ["Cloud"], type: "cloud", needsKey: true },
  { id: "custom",        nameKey: "providerCustom",        descKey: "providerCustomDesc",        endpoint: "",                              gpus: ["Depends on server"], type: "both" },
];

function gpuBadgeClass(gpu) {
  if (gpu.includes("(beta)")) return "bg-nox-red/10 text-nox-red";
  if (gpu.includes("(Vulkan)")) return "bg-nox-amber/10 text-nox-amber";
  if (gpu.includes("(CUDA)") || gpu.includes("(ROCm)") || gpu.includes("(OneAPI)")) return "bg-nox-phosphor/10 text-nox-phosphor";
  if (gpu === "Cloud") return "bg-nox-accent/15 text-nox-accent";
  return "bg-nox-textDim/10 text-nox-textDim";
}

const PROVIDER_TYPE_LABELS = { lokal: "Lokal", cloud: "Cloud", both: "Lokal/Cloud" };

function AudioDeviceDropdown({ devices, selected, onSelect, defaultLabel, iconSvg, accentClass }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [popupStyle, setPopupStyle] = useState(null);

  const getPortalTarget = useCallback(() => {
    return document.querySelector("[data-theme]") || document.body;
  }, []);

  const updatePosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const POPUP_MAX = 224; // max-h-56
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when there is not enough room below (e.g. near the window bottom)
    const openUp = spaceBelow < POPUP_MAX + 12 && rect.top > spaceBelow;
    setPopupStyle({
      position: "fixed",
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, Math.min(POPUP_MAX, (openUp ? rect.top : spaceBelow) - 12)),
      zIndex: 99999,
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }
  }, [open, updatePosition]);

  const selectedName = selected === "default"
    ? defaultLabel
    : (devices.find(d => d.name === selected)?.name || defaultLabel);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 bg-nox-surface text-nox-text text-sm rounded-xl px-4 py-3 border transition-colors cursor-pointer ${
          open ? "border-nox-accent" : "border-nox-border hover:border-nox-borderHover"
        }`}
      >
        <span className={`shrink-0 ${accentClass}`}>{iconSvg}</span>
        <span className="flex-1 text-left truncate">{selectedName}</span>
        <svg className={`shrink-0 text-nox-textDim transition-transform ${open ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && popupStyle && createPortal(
        <div
          className="max-h-56 overflow-y-auto rounded-xl border border-nox-border bg-nox-surface-raised backdrop-blur-xl shadow-xl shadow-nox-shadowStrong"
          style={{ ...popupStyle, maxHeight: popupStyle.maxHeight }}
        >
          <button
            type="button"
            onClick={() => { onSelect("default"); setOpen(false); }}
            className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-nox-border/50 ${
              selected === "default" ? "text-nox-accent bg-nox-accent/10 font-medium" : "text-nox-text hover:bg-nox-surface-hover"
            }`}
          >
            {defaultLabel}
          </button>
          {devices.map((d) => (
            <button
              key={d.index}
              type="button"
              onClick={() => { onSelect(d.name); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                selected === d.name ? "text-nox-accent bg-nox-accent/10 font-medium" : "text-nox-text hover:bg-nox-surface-hover"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="truncate">{d.name}</span>
                {d.is_default && <span className="text-[10px] text-nox-textFaint shrink-0 ml-2">Standard</span>}
              </span>
            </button>
          ))}
        </div>,
        getPortalTarget()
      )}
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
  const [selectedBackend, setSelectedBackend] = useState("ollama"); // "ollama" | "openai_compatible" | "llama_cpp"
  const [lmStudioEndpoint, setLmStudioEndpoint] = useState("http://localhost:1234/v1");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [lmStudioOk, setLmStudioOk] = useState(null);
  const [noxBackendOk, setNoxBackendOk] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [recommendedBackend, setRecommendedBackend] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("lmstudio");
  const [micOk, setMicOk] = useState(null);
  const [wakeOk, setWakeOk] = useState(null);
  const [wakeAttempts, setWakeAttempts] = useState(0);
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

  // Heavy deps install state
  const [depsPhase, setDepsPhase] = useState("idle");
  const [depsCurrentPkg, setDepsCurrentPkg] = useState("");
  const [depsLog, setDepsLog] = useState([]);
  const [depsError, setDepsError] = useState(null);
  const [depsInstalled, setDepsInstalled] = useState(null); // null = not checked, {torch: bool, easyocr: bool, ...}
  const [depsHasNvidia, setDepsHasNvidia] = useState(false);

  // Model pull state
  const [pullProgress, setPullProgress] = useState(0);
  const [pullRunning, setPullRunning] = useState(false);
  const [pullPaused, setPullPaused] = useState(false);
  const [pullError, setPullError] = useState(null);
  const [pullModel, setPullModel] = useState("");
  const [pullBytes, setPullBytes] = useState({ completed: 0, total: 0, speed: 0, writeSpeed: 0 });
  const [pullStatusText, setPullStatusText] = useState("");
  const [speedHistory, setSpeedHistory] = useState([]);
  const [sliderPos, setSliderPos] = useState(2); // default: balance
  const [showInstalledModels, setShowInstalledModels] = useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = useState(true);
  const [modelsDir, setModelsDir] = useState({ dir: "", custom: false });

  const pollRef = useRef(null);
  const wakeTestActiveRef = useRef(false);

  const steps = [
    s.welcome || "Welcome",
    s.voiceSelect || "Voice",
    s.modelSelect || "Select model",
    s.audioDevices || "Audio devices",
    s.wakeCalibration || "Wake word calibration",
    s.done || "Done",
  ];

  // Notify Electron to keep window visible during onboarding
  useEffect(() => {
    window.nox?.onboardingActive?.();
  }, []);

  // GGUF models storage directory (Nox engine)
  const fetchModelsDir = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models/dir`);
      const data = await res.json();
      if (data.status === "ok") setModelsDir({ dir: data.dir || "", custom: !!data.custom });
    } catch {}
  }, []);

  useEffect(() => {
    fetchModelsDir();
  }, [fetchModelsDir]);

  const refreshModelsList = useCallback(async () => {
    try {
      const modelsRes = await fetch(`${API_BASE}/api/models`);
      const modelsData = await modelsRes.json();
      if (modelsData.status === "ok") setModels(modelsData.available_models || []);
    } catch {}
  }, []);

  const changeModelsDir = async () => {
    try {
      const dir = await window.nox?.selectFolder?.();
      if (!dir) return;
      const res = await fetch(`${API_BASE}/api/models/dir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        setModelsDir({ dir: data.dir || "", custom: !!data.custom });
        // The GGUF scan now uses the new directory — refresh the model list
        await refreshModelsList();
      }
    } catch {}
  };

  const resetModelsDir = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models/dir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: "" }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        setModelsDir({ dir: data.dir || "", custom: false });
        await refreshModelsList();
      }
    } catch {}
  };

  // MODEL_TABLE imported from shared/modelTable.js (VRAM tiers)

  const MODE_KEYS = ["superschnell", "schnell", "balance", "qualitaet"];
  const MODE_LABELS = [
    { icon: <IconLightning />, label: s.modeSuperFast || "Superschnell" },
    { icon: <IconRocket />, label: s.modeFast || "Schnell" },
    { icon: <IconScale />, label: s.modeBalanced || "Balance" },
    { icon: <IconStar />, label: s.modeQuality || "Qualität" },
  ];

  // Auto-select model when slider position changes and the tier's model is installed
  useEffect(() => {
    if (step !== 2) return;
    if (selectedBackend === "llama_cpp") {
      const vram = gpuInfo?.vram_mb || 0;
      const tierIdx = MODEL_TABLE.findIndex(t => vram >= t.range[0] && vram < t.range[1]);
      const tier = tierIdx >= 0 ? MODEL_TABLE[tierIdx] : MODEL_TABLE[0];
      const modeKey = MODE_KEYS[sliderPos];
      const entry = tier.modes[modeKey];

      const findInstalled = (modelKey) => {
        // Strict: only exact GGUF files count for the Nox engine
        const gguf = GGUF_FILENAMES[modelKey];
        return gguf && models.includes(gguf) ? gguf : null;
      };

      // Only select the exact recommended model if it's installed.
      // If not installed, don't change selection — the info panel shows "not installed" + download button.
      const match = entry && entry.model ? findInstalled(entry.model) : null;
      if (match) {
        setSelectedModel(match);
      }
      return;
    }
    if (selectedBackend !== "ollama") return;
    const vram = gpuInfo?.vram_mb || 0;
    const tierIdx = MODEL_TABLE.findIndex(t => vram >= t.range[0] && vram < t.range[1]);
    const tier = tierIdx >= 0 ? MODEL_TABLE[tierIdx] : MODEL_TABLE[0];
    const modeKey = MODE_KEYS[sliderPos];
    const entry = tier.modes[modeKey];

    const findInstalledOllama = (modelKey) => {
      // Strict: only native Ollama models count for the Ollama backend
      return models.find(m => m === modelKey || m.startsWith(modelKey)) || null;
    };

    // Only select the exact recommended model if it's installed.
    // If not installed, don't change selection — the info panel shows "not installed" + download button.
    const match = entry && entry.model ? findInstalledOllama(entry.model) : null;
    if (match) {
      setSelectedModel(match);
    }
  }, [sliderPos, step, gpuInfo, models, selectedBackend]);

  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
      const data = await res.json();
      setPullProgress(data.progress || 0);
      setPullBytes({ completed: data.completed || 0, total: data.total || 0, speed: data.speed || 0, writeSpeed: data.write_speed || 0 });
      setPullStatusText(data.status_text || "");
      setPullModel(data.model || "");
      setPullPaused(data.paused || false);
      if (data.speed_history && data.speed_history.length > 0) {
        setSpeedHistory(data.speed_history);
      }
      if (data.running) {
        pollRef.current = setTimeout(poll, 1000);
      } else {
        setPullRunning(false);
        setPullPaused(false);
        setSpeedHistory([]);
        if (data.status_text === "cancelled") {
          setPullError(null);
        } else if (data.error) {
          setPullError(data.error);
        } else {
          // Optimistically mark the model as installed to avoid a download-button flash
          if (data.model) {
            const pullId = selectedBackend === "llama_cpp" ? (GGUF_FILENAMES[data.model] || data.model) : data.model;
            setModels((prev) => (prev.includes(pullId) ? prev : [...prev, pullId]));
          }
          const modelsRes = await fetch(`${API_BASE}/api/models`);
          const modelsData = await modelsRes.json();
          setModels(modelsData.available_models || []);
          // For llama_cpp, don't set selectedModel to the Ollama model name —
          // the auto-select effect will fuzzy-match the GGUF file
          if (selectedBackend === "ollama" && data.model) {
            setSelectedModel(data.model);
          }
        }
      }
    } catch {
      pollRef.current = setTimeout(poll, 2000);
    }
  };

  // Resume polling on mount if a pull is already running (e.g. after HMR)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
        const data = await res.json();
        if (cancelled) return;
        if (data.running) {
          setPullRunning(true);
          setPullModel(data.model || "");
          setPullProgress(data.progress || 0);
          setPullBytes({ completed: data.completed || 0, total: data.total || 0, speed: data.speed || 0, writeSpeed: data.write_speed || 0 });
          setPullStatusText(data.status_text || "");
          setPullPaused(data.paused || false);
          if (data.speed_history && data.speed_history.length > 0) {
            setSpeedHistory(data.speed_history);
          }
          pollRef.current = setTimeout(poll, 1000);
        } else {
          // Backend not running — clear any stale state
          setPullRunning(false);
          setPullPaused(false);
          setPullProgress(0);
          setSpeedHistory([]);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
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
        setMicOk(data?.microphone?.available === true);
        setWakeOk(data?.wake_word?.model_exists === true);
        // Check if a backend is already configured (for pre-selection only)
        const healthRes = await fetch(`${API_BASE}/health/ollama`);
        const healthData = await healthRes.json();
        if (healthData.status === "ok") {
          setOllamaOk(true);
          const modelsRes = await fetch(`${API_BASE}/api/models`);
          const modelsData = await modelsRes.json();
          setModels(modelsData.available_models || []);
          if (modelsData.current_model) setSelectedModel(modelsData.current_model);
          // Pre-select the detected backend
          const bt = healthData.backend_type;
          if (bt === "ollama") setSelectedBackend("ollama");
          else if (bt === "openai_compatible") setSelectedBackend("openai_compatible");
          else if (bt === "llama_cpp") setSelectedBackend("llama_cpp");
        } else {
          setOllamaOk(false);
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
      // Always detect what's running for the recommendation
      // Check Ollama + all local providers in parallel
      const localProviders = OPENAI_PROVIDERS.filter(p => p.type === "lokal" && p.endpoint);
      const checks = await Promise.all([
        // Ollama
        (async () => {
          try {
            const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
            return { backend: "ollama", ok: res.ok };
          } catch {
            return { backend: "ollama", ok: false };
          }
        })(),
        // All local OpenAI-compatible providers
        ...localProviders.map(async (p) => {
          try {
            const res = await fetch(`${p.endpoint}/models`, { signal: AbortSignal.timeout(3000) });
            return { backend: "openai_compatible", providerId: p.id, ok: res.ok };
          } catch {
            return { backend: "openai_compatible", providerId: p.id, ok: false };
          }
        }),
      ]);
      // Priority: Ollama first, then local providers in order
      const ollamaFound = checks.find(c => c.backend === "ollama" && c.ok);
      if (ollamaFound) {
        setRecommendedBackend("ollama");
        setSelectedBackend("ollama");
        setOllamaOk(true);
        return;
      }
      const providerFound = checks.find(c => c.backend === "openai_compatible" && c.ok);
      if (providerFound) {
        setRecommendedBackend("openai_compatible");
        setSelectedBackend("openai_compatible");
        setSelectedProvider(providerFound.providerId);
        const provider = OPENAI_PROVIDERS.find(p => p.id === providerFound.providerId);
        if (provider) {
          setLmStudioEndpoint(provider.endpoint);
          saveBackendChoice("openai_compatible", provider.endpoint);
        }
        setLmStudioOk(true);
        setProviderStatus(true);
        return;
      }
      // Nothing local running — recommend OpenRouter (cloud, always available)
      setRecommendedBackend("openai_compatible");
      setSelectedBackend("openai_compatible");
      setSelectedProvider("openrouter");
      const orProvider = OPENAI_PROVIDERS.find(p => p.id === "openrouter");
      if (orProvider) {
        setLmStudioEndpoint(orProvider.endpoint);
        saveBackendChoice("openai_compatible", orProvider.endpoint);
      }
      setLmStudioOk(true);
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

  // Check heavy deps status when entering step 1
  useEffect(() => {
    if (step !== 1) return;
    // Deps are now handled by SetupScreen before onboarding — just skip this check
  }, [step]);

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

  const checkLmStudio = async () => {
    try {
      const res = await fetch(`${API_BASE}/health/ollama`);
      const data = await res.json();
      // If backend is already connected as openai_compatible, it's ok
      if (data.status === "ok" && data.backend_type === "openai_compatible") {
        setLmStudioOk(true);
        return true;
      }
      setLmStudioOk(false);
      return false;
    } catch {
      setLmStudioOk(false);
      return false;
    }
  };

  const saveBackendChoice = async (backend, endpointOverride) => {
    try {
      const settings = { llm_backend: backend };
      if (backend === "openai_compatible") {
        settings.llm_endpoint = endpointOverride || lmStudioEndpoint;
        if (llmApiKey.trim()) settings.llm_api_key = llmApiKey.trim();
      }
      if (backend === "llama_cpp") {
        settings.llm_speed_mode = MODE_KEYS[sliderPos];
      }
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    } catch (err) {
      console.error("Failed to save backend choice:", err);
    }
  };

  const checkProvider = async (providerId) => {
    const provider = OPENAI_PROVIDERS.find(p => p.id === providerId);
    if (!provider || provider.type === "cloud" || provider.type === "both") {
      setProviderStatus(null);
      return;
    }
    setProviderStatus("checking");
    try {
      const res = await fetch(`${provider.endpoint}/models`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        setProviderStatus(true);
      } else {
        setProviderStatus(false);
      }
    } catch {
      setProviderStatus(false);
    }
  };

  const selectProvider = (providerId) => {
    setSelectedProvider(providerId);
    const provider = OPENAI_PROVIDERS.find(p => p.id === providerId);
    if (provider) {
      setLmStudioEndpoint(provider.endpoint);
      saveBackendChoice("openai_compatible", provider.endpoint);
    }
    if (provider && provider.type === "lokal") {
      checkProvider(providerId);
    } else {
      setProviderStatus(null);
    }
    setLmStudioOk(true);
  };

  const checkNoxBackend = async () => {
    try {
      // Save backend choice first so the backend can re-init
      await saveBackendChoice("llama_cpp");
      // Check health endpoint with reconnect=true to force re-detection
      const res = await fetch(`${API_BASE}/health/ollama?reconnect=true`);
      const data = await res.json();
      if (data.status === "ok" && data.backend_type === "llama_cpp") {
        setNoxBackendOk(true);
        // Fetch available GGUF models
        try {
          const modelsRes = await fetch(`${API_BASE}/api/models`);
          const modelsData = await modelsRes.json();
          if (modelsData.status === "ok") {
            setModels(modelsData.available_models || []);
            if (modelsData.current_model) setSelectedModel(modelsData.current_model);
          }
        } catch {}
        return true;
      }
      // Backend not ok — check if any GGUF models exist via the models endpoint
      try {
        const modelsRes = await fetch(`${API_BASE}/api/models`);
        const modelsData = await modelsRes.json();
        const ggufModels = modelsData.available_models || [];
        if (ggufModels.length > 0) {
          setNoxBackendOk(true);
          setModels(ggufModels);
          if (modelsData.current_model) setSelectedModel(modelsData.current_model);
          return true;
        }
      } catch {}
      setNoxBackendOk(false);
      return false;
    } catch {
      setNoxBackendOk(false);
      return false;
    }
  };

  const selectBackend = (backend) => {
    setSelectedBackend(backend);
    setOllamaOk(null);
    setLmStudioOk(null);
    setNoxBackendOk(null);
    setProviderStatus(null);
    if (backend === "ollama") {
      saveBackendChoice("ollama").then(() => checkOllama());
    } else if (backend === "openai_compatible") {
      const provider = OPENAI_PROVIDERS.find(p => p.id === selectedProvider);
      if (provider && provider.endpoint) {
        setLmStudioEndpoint(provider.endpoint);
      }
      setLmStudioOk(true);
      saveBackendChoice("openai_compatible");
      if (provider && provider.type === "lokal") {
        checkProvider(selectedProvider);
      }
    } else if (backend === "llama_cpp") {
      checkNoxBackend();
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
    setPullPaused(false);
    setPullError(null);
    setPullBytes({ completed: 0, total: 0, speed: 0, writeSpeed: 0 });
    setPullStatusText("starting");
    setSpeedHistory([]);
    try {
      const endpoint = selectedBackend === "llama_cpp"
        ? "/api/onboarding/pull-gguf-model"
        : "/api/onboarding/pull-ollama-model";
      await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      poll();
    } catch (err) {
      setPullError(String(err));
      setPullRunning(false);
    }
  };

  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const cancelPull = async () => {
    setPullRunning(false);
    setPullPaused(false);
    setPullProgress(0);
    setPullBytes({ completed: 0, total: 0, speed: 0, writeSpeed: 0 });
    setSpeedHistory([]);
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    try {
      await fetch(`${API_BASE}/api/onboarding/pull-cancel`, { method: "POST" });
    } catch {}
  };

  const togglePause = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/pull-pause`, { method: "POST" });
      const data = await res.json();
      setPullPaused(data.paused || false);
    } catch {}
  };

  const saveModel = async () => {
    if (!selectedModel) return;
    try {
      const modeKey = MODE_KEYS[sliderPos];
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollama_model: selectedModel, ollama_model_mode: modeKey }),
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
        body: JSON.stringify({ onboarding_completed: true, analytics_enabled: analyticsOptIn }),
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

  const startDepsInstall = async () => {
    setDepsPhase("installing");
    setDepsLog([]);
    setDepsError(null);
    try {
      await fetch(`${API_BASE}/api/onboarding/install-deps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const pollDeps = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/deps-status`);
          const data = await res.json();
          setDepsPhase(data.phase || "installing");
          setDepsCurrentPkg(data.current_package || "");
          setDepsLog(data.log || []);
          if (data.error) setDepsError(data.error);
          if (data.installing) {
            pollRef.current = setTimeout(pollDeps, 1000);
          } else if (data.phase === "done") {
            setDepsPhase("done");
          } else if (data.phase === "error") {
            setDepsPhase("error");
          }
        } catch {
          pollRef.current = setTimeout(pollDeps, 2000);
        }
      };
      pollDeps();
    } catch (err) {
      setDepsError(String(err));
      setDepsPhase("error");
    }
  };

  const next = () => {
    if (step === 0) saveBackendChoice(selectedBackend);
    if (step === 1) saveVoiceSetting(selectedVoice, selectedEngine);
    if (step === 2 && selectedBackend === "ollama") saveModel();
    if (step === 2 && selectedBackend === "llama_cpp") {
      const settings = { llm_speed_mode: MODE_KEYS[sliderPos] };
      if (selectedModel) {
        settings.ollama_model = selectedModel;
      }
      fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }).catch(() => {});
    }
    if (step === 2 && selectedBackend === "openai_compatible" && selectedModel) {
      fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollama_model: selectedModel }),
      }).catch(() => {});
    }
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const prev = () => setStep((p) => Math.max(p - 1, 0));

  const btnClass =
    "px-5 py-2.5 text-sm font-medium transition-all nox-btn-primary rounded-lg";
  const btnPrimary = btnClass;
  const btnSecondary =
    "px-5 py-2.5 text-sm font-medium transition-all nox-btn-secondary rounded-lg";
  const btnDisabled =
    "px-5 py-2.5 text-sm font-medium transition-all nox-btn-secondary opacity-40 cursor-not-allowed rounded-lg";

  return (
    <div className="flex flex-col h-full w-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-nox-border bg-nox-surface/30 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <NoxAvatar size={24} />
          <h2 className="text-base font-semibold text-nox-text nox-heading">{s.title || "Set up Nox"}</h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="nox-label text-sm">
            {String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
          </span>
          {step === 0 && (
            <button
              onClick={() => window.nox?.closeWindow?.()}
              className="text-nox-textDim hover:text-nox-text transition-colors p-1 rounded-md hover:bg-nox-surface"
              title={s.closeApp || "Close"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-nox-border shrink-0">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${((step + 1) / steps.length) * 100}%`,
            background: 'var(--nox-gradient)',
            boxShadow: '0 0 8px var(--nox-shadow-accent)',
          }}
        />
      </div>

      {/* Content — full width, scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-8" style={{ overflow: openDropdown ? 'hidden' : undefined }}>
        {/* Step 0: Welcome + Language selection + Backend selection */}
        {step === 0 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-8">
            {/* Welcome section */}
            <div className="flex flex-col items-center gap-4 text-center pt-4">
              <NoxAvatar size={144} glowing />
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-nox-text nox-heading">{s.welcomeTitle || "Welcome to Nox"}</h3>
                <p className="text-base text-nox-textDim max-w-lg leading-relaxed">
                  {s.welcomeText || "Nox is your local AI assistant. Let us set it up in a few steps."}
                </p>
              </div>
            </div>

            {/* Language selector */}
            {voiceCatalog && (
              <div className="flex justify-center">
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
                  label={s.selectLanguage || "Select language"}
                  onOpenChange={setOpenDropdown}
                />
              </div>
            )}

            {/* Wake word language warning for non-German languages */}
            {selectedLang && !selectedLang.startsWith("de") && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <span className="text-amber-400 flex-shrink-0 mt-0.5"><IconWarning size={15} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-400 mb-0.5">{s.wakeWordLangWarningTitle || "Wake word limitation"}</p>
                  <p className="text-xs text-amber-300/80 leading-relaxed">
                    {s.wakeWordLangWarning || "The wake word \"Hey Nox\" is optimized for German. In other languages it is active but likely won't work reliably."}
                  </p>
                  <p className="text-xs text-amber-300/60 leading-relaxed mt-1.5">
                    {s.wakeWordLangWarningHelp || "Help us improve: Send your voice recordings via a ticket on our Discord server to train the wake word for your language."}{" "}
                    <a href="https://discord.com/invite/P2RQNYjWbp" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline hover:text-amber-300">Discord</a>
                  </p>
                </div>
              </div>
            )}

            {/* Backend selection */}
            <div className="space-y-3">
              <p className="text-sm text-nox-textDim text-left">
                {s.backendSelectHint || "Choose which AI engine Nox should use:"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => selectBackend("ollama")}
                className={`text-left px-4 py-3.5 rounded-xl text-sm transition-all border ${
                  selectedBackend === "ollama"
                    ? "bg-nox-accent/10 border-nox-accent shadow-md shadow-nox-accent/20"
                    : "bg-nox-surface border-nox-border hover:border-nox-accent/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-nox-text text-base">Ollama</span>
                    {recommendedBackend === "ollama" && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Recommended</span>
                    )}
                  </div>
                  {selectedBackend === "ollama" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendOllamaDesc || "Local AI engine — easy to install, many models."}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/15 text-nox-phosphor font-medium leading-none">Lokal</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/10 text-nox-phosphor font-medium leading-none">Nvidia (CUDA)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-red/10 text-nox-red font-medium leading-none">AMD (beta)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-red/10 text-nox-red font-medium leading-none">Intel (beta)</span>
                </div>
              </button>
              <button
                onClick={() => selectBackend("llama_cpp")}
                className={`text-left px-4 py-3.5 rounded-xl text-sm transition-all border ${
                  selectedBackend === "llama_cpp"
                    ? "bg-nox-accent/10 border-nox-accent shadow-md shadow-nox-accent/20"
                    : "bg-nox-surface border-nox-border hover:border-nox-accent/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-nox-text text-base">Nox</span>
                    {recommendedBackend === "llama_cpp" && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Recommended</span>
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium leading-none">Experimental</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-nox-phosphor/15 text-nox-phosphor font-medium leading-none">Fastest</span>
                  </div>
                  {selectedBackend === "llama_cpp" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendNoxDesc || "Built-in AI engine (llama.cpp) — no external software needed. Experimental."}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/15 text-nox-phosphor font-medium leading-none">Lokal</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/10 text-nox-phosphor font-medium leading-none">Nvidia (CUDA)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/10 text-nox-phosphor font-medium leading-none">AMD (ROCm)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/10 text-nox-phosphor font-medium leading-none">Intel (OneAPI)</span>
                </div>
              </button>
              <button
                onClick={() => selectBackend("openai_compatible")}
                className={`text-left px-4 py-3.5 rounded-xl text-sm transition-all border ${
                  selectedBackend === "openai_compatible"
                    ? "bg-nox-accent/10 border-nox-accent shadow-md shadow-nox-accent/20"
                    : "bg-nox-surface border-nox-border hover:border-nox-accent/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-nox-text text-base">{s.otherSelectProvider ? "Andere" : "Other"}</span>
                  {recommendedBackend === "openai_compatible" && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Recommended</span>
                  )}
                  {selectedBackend === "openai_compatible" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendOtherDesc || "Use an external OpenAI-compatible server of your choice."}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-phosphor/15 text-nox-phosphor font-medium leading-none">Lokal</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Cloud</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-textDim/10 text-nox-textDim font-medium leading-none">Depends on server</span>
                </div>
              </button>
              </div>
            </div>

            {/* Conditional content based on selected backend */}
            {selectedBackend === "ollama" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 py-2.5 nox-console-card text-sm">
                  <span className="nox-label">Ollama</span>
                  {ollamaOk === null ? (
                    <span className="text-nox-textDim text-xs font-mono">…</span>
                  ) : ollamaOk ? (
                    <span className="text-nox-phosphor text-xs font-mono flex items-center gap-1.5"><span className="nox-status-dot" /> {s.available || "Available"}</span>
                  ) : (
                    <span className="text-nox-red text-xs font-mono flex items-center gap-1"><IconX size={12} /> {s.missing || "Not found"}</span>
                  )}
                </div>
                {gpuInfo && (
                  <div className="flex items-center justify-between px-3 py-2.5 nox-console-card text-sm">
                    <span className="nox-label">{s.gpu || "GPU"}</span>
                    <span className={`text-xs font-mono ${
                      gpuInfo.gpu_vendor === "nvidia" ? "text-nox-phosphor" :
                      gpuInfo.gpu_vendor === "amd" ? "text-nox-amber" :
                      gpuInfo.gpu_vendor === "intel" ? "text-nox-accent" :
                      "text-nox-textDim"
                    } flex items-center gap-1.5`}>
                      {gpuInfo.gpu_vendor !== "unknown" && gpuInfo.gpu_vendor !== "cpu"
                        ? <><span className="nox-status-dot" /> {gpuInfo.gpu_name || gpuInfo.gpu_vendor} ({gpuInfo.gpu_backend?.toUpperCase()})</>
                        : <>CPU-Modus</>}
                    </span>
                  </div>
                )}
                {gpuInfo && gpuInfo.gpu_vendor === "unknown" && (
                  <p className="text-xs text-yellow-400 px-3">
                    {s.gpuCpuFallback || "Keine GPU erkannt — Nox läuft im CPU-Modus. Sprache wird langsamer sein, Text-Chat funktioniert normal."}
                  </p>
                )}
                {!ollamaOk && ollamaOk !== null && ollamaInstallPhase === "idle" && (
                  <div className="space-y-2">
                    <button onClick={startOllamaInstall} className={btnPrimary + " w-full"}>
                      {s.installOllama || "Install Ollama automatically"}
                    </button>
                    <p className="text-xs text-nox-textDim px-3">
                      {s.ollamaManualHint || "Or install manually from "}
                      <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-nox-accent underline">
                        ollama.com/download
                      </a>
                    </p>
                    <button onClick={checkOllama} className={btnSecondary + " w-full"}>
                      {s.retry || "Check again"}
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
                  <p className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1"><IconCheck size={14} /> {s.ollamaInstalled || "Ollama installed!"}</p>
                )}
                {ollamaInstallPhase === "error" && (
                  <div className="space-y-2">
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {ollamaInstallError === "timeout"
                        ? (s.ollamaInstallTimeout || "Installation timed out.")
                        : (s.ollamaInstallFailed || "Automatische Installation fehlgeschlagen.")}
                    </p>
                    <p className="text-xs text-nox-textDim">
                      {s.ollamaManualHint || "Bitte manuell installieren von "}
                      <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-nox-accent underline">
                        ollama.com/download
                      </a>
                    </p>
                    <button onClick={checkOllama} className={btnSecondary + " w-full"}>
                      {s.retry || "Check again"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {selectedBackend === "openai_compatible" && (
              <div className="space-y-4">
                <p className="text-sm text-nox-textDim text-left">
                  {s.otherSelectProvider || "Choose your provider:"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {OPENAI_PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => selectProvider(provider.id)}
                      className={`text-left px-3.5 py-3 rounded-lg text-sm transition-all border ${
                        selectedProvider === provider.id
                          ? "bg-nox-accent/10 border-nox-accent"
                          : "bg-nox-surface border-nox-border hover:border-nox-accent/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-medium text-nox-text">{s[provider.nameKey] || provider.id}</span>
                        {selectedProvider === provider.id && (
                          <svg className="w-3.5 h-3.5 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        )}
                      </div>
                      <p className="text-xs text-nox-textDim leading-relaxed">{s[provider.descKey] || ""}</p>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {provider.type === "both" ? (
                          <>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-nox-phosphor/15 text-nox-phosphor font-medium leading-none">Lokal</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Cloud</span>
                          </>
                        ) : (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium leading-none ${
                            provider.type === "cloud"
                              ? "bg-nox-accent/15 text-nox-accent"
                              : "bg-nox-phosphor/15 text-nox-phosphor"
                          }`}>
                            {PROVIDER_TYPE_LABELS[provider.type] || provider.type}
                          </span>
                        )}
                        {(provider.gpus || []).filter(g => g !== "Cloud").map((g) => (
                          <span key={g} className={`text-[9px] px-1.5 py-0.5 rounded font-medium leading-none ${gpuBadgeClass(g)}`}>{g}</span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedProvider === "custom" && (
                  <div className="px-4 py-4 nox-console-card space-y-2">
                    <label className="nox-label">{s.otherCustomEndpoint || "Custom server address"}</label>
                    <input
                      type="text"
                      value={lmStudioEndpoint}
                      onChange={(e) => setLmStudioEndpoint(e.target.value)}
                      onBlur={() => saveBackendChoice("openai_compatible")}
                      placeholder="http://localhost:1234/v1"
                      className="w-full bg-nox-bg text-nox-text text-sm rounded-lg px-3 py-2.5 border border-nox-border focus:outline-none focus:border-nox-accent font-mono"
                    />
                    <p className="text-xs text-nox-textDim">
                      {s.otherCustomHint || "Enter the URL of your OpenAI-compatible server."}
                    </p>
                  </div>
                )}

                {selectedProvider !== "custom" && (() => {
                  const prov = OPENAI_PROVIDERS.find(p => p.id === selectedProvider);
                  if (!prov) return null;
                  if (prov.type === "cloud") {
                    return (
                      <div className="px-4 py-3 nox-console-card">
                        <div className="flex items-center justify-between">
                          <span className="nox-label">{s[prov.nameKey] || prov.id}</span>
                          <span className="text-nox-accent text-xs font-mono flex items-center gap-1.5">
                            <span className="nox-status-dot" /> {s.cloudProvider || "Cloud"}
                          </span>
                        </div>
                        <p className="text-xs text-nox-textDim mt-2">
                          {s.cloudProviderHint || "Starte die Software und Nox verbindet sich automatisch."}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center justify-between px-3 py-2.5 nox-console-card text-sm">
                      <span className="nox-label">{s[prov.nameKey] || prov.id}</span>
                      {providerStatus === null ? (
                        <span className="text-nox-textDim text-xs font-mono">{s.otherProviderHint || "Starte die Software und Nox verbindet sich automatisch."}</span>
                      ) : providerStatus === "checking" ? (
                        <span className="text-nox-textDim text-xs font-mono">…</span>
                      ) : providerStatus ? (
                        <span className="text-nox-phosphor text-xs font-mono flex items-center gap-1.5"><span className="nox-status-dot" /> {s.available || "Available"}</span>
                      ) : (
                        <span className="text-nox-red text-xs font-mono flex items-center gap-1"><IconX size={12} /> {s.missing || "Not found"}</span>
                      )}
                    </div>
                  );
                })()}

                {selectedProvider !== "custom" && providerStatus === false && (() => {
                  const prov = OPENAI_PROVIDERS.find(p => p.id === selectedProvider);
                  if (!prov || prov.type !== "lokal") return null;
                  return (
                    <button onClick={() => checkProvider(selectedProvider)} className={btnSecondary + " w-full"}>
                      {s.retry || "Check again"}
                    </button>
                  );
                })()}

                {(() => {
                  const prov = OPENAI_PROVIDERS.find((p) => p.id === selectedProvider);
                  if (!prov?.needsKey) return null;
                  return (
                    <div className="px-4 py-3 nox-console-card">
                      <label className="nox-label">API-Key</label>
                      <input
                        type="password"
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        onBlur={() => saveBackendChoice("openai_compatible")}
                        placeholder={selectedProvider === "kimi" ? "sk-kimi-…" : "sk-…"}
                        className="w-full bg-nox-bg text-nox-text text-sm rounded-lg px-3 py-2.5 border border-nox-border focus:outline-none focus:border-nox-accent font-mono"
                      />
                      <p className="text-xs text-nox-textDim mt-2">
                        {s.apiKeyHint || "Wird lokal in der Nox-Konfiguration gespeichert und nur an den Anbieter übertragen."}
                      </p>
                    </div>
                  );
                })()}

                {gpuInfo && (
                  <div className="flex items-center justify-between px-3 py-2.5 nox-console-card text-sm">
                    <span className="nox-label">{s.gpu || "GPU"}</span>
                    <span className={`text-xs font-mono ${gpuInfo.cuda_available ? "text-nox-phosphor" : "text-nox-amber"} flex items-center gap-1.5`}>
                      {gpuInfo.cuda_available
                        ? <><span className="nox-status-dot" /> {gpuInfo.gpu_name || "GPU"}</>
                        : "CPU-Modus"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {selectedBackend === "llama_cpp" && (
              <div className="space-y-3">
                <div className="px-4 py-4 nox-console-card space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400"><IconWarning size={16} /></span>
                    <span className="text-sm text-nox-text font-medium">{s.noxExperimental || "Experimental"}</span>
                  </div>
                  <p className="text-xs text-nox-textDim leading-relaxed">
                    {s.noxExperimentalHint || "The built-in engine loads GGUF models directly in the Nox process. No external software needed. Note: This feature is still experimental and may contain bugs."}
                  </p>
                </div>
                {gpuInfo && (
                  <div className="flex items-center justify-between px-3 py-2.5 nox-console-card text-sm">
                    <span className="nox-label">{s.gpu || "GPU"}</span>
                    <span className={`text-xs font-mono ${
                      gpuInfo.gpu_vendor === "nvidia" ? "text-nox-phosphor" :
                      gpuInfo.gpu_vendor === "amd" ? "text-nox-amber" :
                      gpuInfo.gpu_vendor === "intel" ? "text-nox-accent" :
                      "text-nox-textDim"
                    } flex items-center gap-1.5`}>
                      {gpuInfo.gpu_vendor !== "unknown"
                        ? <><span className="nox-status-dot" /> {gpuInfo.gpu_name || gpuInfo.gpu_vendor} ({gpuInfo.gpu_backend?.toUpperCase()})</>
                        : <>CPU-Modus</>}
                    </span>
                  </div>
                )}
                {gpuInfo && gpuInfo.gpu_vendor !== "unknown" && gpuInfo.llama_cpp_build && (
                  <p className="text-xs text-nox-textDim px-3">
                    {gpuInfo.llama_cpp_build.description}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Voice selection */}
        {step === 1 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-nox-text nox-heading">{s.selectVoice || "Select voice"}</h3>
              {selectedLang && voiceCatalog && (
                <span className="flex items-center gap-1.5 text-xs text-nox-textDim">
                  <FlagIcon code={selectedLang} size={14} />
                  {voiceCatalog[selectedLang]?.language_native}
                </span>
              )}
            </div>
            <p className="text-sm text-nox-textDim">
              {s.voiceHintOnly || "Choose a voice for Nox."}
            </p>

            {/* Wake word language warning for non-German languages */}
            {selectedLang && !selectedLang.startsWith("de") && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <span className="text-amber-400 flex-shrink-0 mt-0.5"><IconWarning size={15} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-400 mb-0.5">{s.wakeWordLangWarningTitle || "Wake word limitation"}</p>
                  <p className="text-xs text-amber-300/80 leading-relaxed">
                    {s.wakeWordLangWarning || "The wake word \"Hey Nox\" is optimized for German. In other languages it is active but likely won't work reliably."}
                  </p>
                  <p className="text-xs text-amber-300/60 leading-relaxed mt-1.5">
                    {s.wakeWordLangWarningHelp || "Help us improve: Send your voice recordings via a ticket on our Discord server to train the wake word for your language."}{" "}
                    <a href="https://discord.com/invite/P2RQNYjWbp" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline hover:text-amber-300">Discord</a>
                  </p>
                </div>
              </div>
            )}

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
                                isPreviewing ? "bg-nox-accent text-nox-accentFg" : "bg-nox-border/50 text-nox-textDim hover:bg-nox-accent/20 hover:text-nox-text"
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
                  <span className="text-red-600 dark:text-red-400 text-sm flex-shrink-0"><IconWarning size={14} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-red-600 dark:text-red-300 break-words">{previewError}</p>
                  </div>
                  <button
                    onClick={() => setPreviewError(null)}
                    className="text-red-600/60 dark:text-red-400/60 hover:text-red-600 dark:hover:text-red-400 text-xs flex-shrink-0"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Model selection / pull */}
        {step === 2 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            <h3 className="text-base font-semibold text-nox-text">{s.chooseModel || "Choose AI model"}</h3>
            {selectedBackend === "ollama" || selectedBackend === "llama_cpp" ? (
              <>
                <p className="text-sm text-nox-textDim">
                  {selectedBackend === "llama_cpp"
                    ? (s.modelHintNox || "Wähle ein GGUF-Modell aus der Liste unten. Der Slider steuert die Generierungsgeschwindigkeit.")
                    : (s.modelHint || "Select the Ollama model Nox should use.")}
                </p>

            {/* Speed/Quality mode slider — picks model based on VRAM and mode */}
            {(() => {
              const vram = gpuInfo?.vram_mb || 0;
              const gpuMode = gpuInfo?.cuda_available ? "GPU" : "CPU";

              const tier = MODEL_TABLE.find(t => vram >= t.range[0] && vram < t.range[1]) || MODEL_TABLE[0];
              const modeKey = MODE_KEYS[sliderPos];
              const entry = tier.modes[modeKey];
              const ggufEquivalent = GGUF_FILENAMES[entry.model] || "";
              const isInstalled = selectedBackend === "ollama"
                ? models.some(m => m === entry.model || m.startsWith(entry.model))
                : selectedBackend === "llama_cpp"
                  ? models.some(m => m === ggufEquivalent)
                  : false;

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
                      max={3}
                      step={1}
                      value={sliderPos}
                      onChange={(e) => setSliderPos(parseInt(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer bg-nox-border accent-nox-accent"
                      style={{
                        background: `linear-gradient(to right, var(--color-nox-accent, #6366f1) ${(sliderPos / 3) * 100}%, var(--color-nox-border, #2a2a2e) ${(sliderPos / 3) * 100}%)`,
                      }}
                    />
                    <div className="flex justify-between mt-1.5">
                      {MODE_LABELS.map((item, i) => (
                        <span
                          key={i}
                          className={`flex items-center gap-1 text-xs transition-colors ${sliderPos === i ? "text-nox-accent font-medium" : "text-nox-textDim"}`}
                        >
                          {item.icon}
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Selected mode info */}
                  <div className="px-3 py-3 rounded-lg bg-nox-surface border border-nox-border space-y-2">
                    {/* Model name, size, description — shown for both backends */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-nox-text">{entry.label}</span>
                      <span className="text-xs text-nox-textDim">{entry.size}</span>
                    </div>
                    <p className="text-xs text-nox-textDim">{entry.desc}</p>
                    {entry.warning && (
                      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                        <span className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5"><IconWarning size={14} /></span>
                        <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 leading-relaxed">{entry.warning}</p>
                      </div>
                    )}
                    {/* Nox engine: storage location for downloaded models */}
                    {selectedBackend === "llama_cpp" && modelsDir.dir && (
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-nox-bgSolid border border-nox-border">
                        <div className="min-w-0">
                          <p className="text-[10px] text-nox-textDim">Speicherort</p>
                          <p className="text-[11px] text-nox-text truncate font-mono" title={modelsDir.dir}>{modelsDir.dir}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {modelsDir.custom && (
                            <button
                              onClick={resetModelsDir}
                              className="px-2 py-1 rounded text-[10px] text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover border border-nox-border transition-colors"
                            >
                              Standard
                            </button>
                          )}
                          <button
                            onClick={changeModelsDir}
                            className="px-2 py-1 rounded text-[10px] font-medium text-nox-accent hover:bg-nox-accent/10 border border-nox-accent/30 transition-colors"
                          >
                            Ändern
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Ollama: installed / download */}
                    {selectedBackend === "ollama" && (
                      <>
                        {isInstalled ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            <span>{s.alreadyInstalled || "Bereits installiert – ausgewählt als Modell"}</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => startModelPull(entry.model)}
                            disabled={pullRunning}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              pullRunning && pullModel === entry.model
                                ? "bg-nox-accent/30 text-nox-textDim"
                                : "bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg"
                            }`}
                          >
                            {pullRunning && pullModel === entry.model
                              ? `${pullPaused ? "Pausiert" : (s.downloading || "Lade herunter")}… ${Math.round(pullProgress * 100)}%`
                              : <span className="flex items-center justify-center gap-1.5"><IconArrowDown size={16} /> {entry.label} {s.downloadModelLabel || "herunterladen"}</span>}
                          </button>
                        )}
                        {!isInstalled && !pullRunning && (
                          <div className="flex items-center gap-1.5 text-xs text-nox-textDim">
                            <IconWarning size={14} />
                            <span>{s.modelNotInstalled || "Modell nicht installiert — bitte herunterladen oder ein installiertes Modell aus der Liste wählen."}</span>
                          </div>
                        )}
                        {pullRunning && pullModel === entry.model && (
                          <div className="relative rounded-lg overflow-hidden border border-nox-border bg-nox-bgSolid">
                            {/* Speed graph fills entire background */}
                            <div className="absolute inset-0">
                              <SpeedGraph history={speedHistory} paused={pullPaused} />
                            </div>
                            {/* Overlay controls on top of graph */}
                            <div className="relative h-36 flex flex-col justify-between p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 px-2 py-1 rounded-md bg-nox-bgSolid/70 backdrop-blur-sm">
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />
                                    <span className="text-xs text-blue-400 font-semibold">{(pullBytes.speed / 1048576).toFixed(1)} MB/s</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-500" />
                                    <span className="text-xs text-yellow-400 font-semibold">{(pullBytes.writeSpeed / 1048576).toFixed(1)} MB/s</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={togglePause}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-nox-bgSolid/80 backdrop-blur-sm border border-nox-border text-nox-text hover:bg-nox-surface-hover transition-colors"
                                  >
                                    {pullPaused ? "▶ Fortsetzen" : "❚❚ Pause"}
                                  </button>
                                  <button
                                    onClick={cancelPull}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors"
                                  >
                                    ✕ Abbrechen
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-1 px-2 py-1.5 rounded-md bg-nox-bgSolid/70 backdrop-blur-sm">
                                <div className="w-full h-2 rounded-full bg-nox-border/60 overflow-hidden">
                                  <div
                                    className="h-full transition-all duration-300 rounded-full"
                                    style={{
                                      width: `${Math.round(pullProgress * 100)}%`,
                                      background: "linear-gradient(to bottom, var(--nox-glow-3, #a5b4fc) 0%, var(--nox-accent, #6366f1) 45%, color-mix(in srgb, var(--nox-accent, #6366f1) 55%, transparent) 100%)",
                                    }}
                                  />
                                </div>
                                <div className="flex justify-between text-[11px] text-nox-textDim">
                                  <span>
                                    {pullBytes.completed > 0
                                      ? `${(pullBytes.completed / 1048576).toFixed(0)} / ${(pullBytes.total / 1048576).toFixed(0)} MB`
                                      : `${Math.round(pullProgress * 100)}%`}
                                  </span>
                                  <span>{pullPaused ? "⏸ Pausiert" : `${Math.round(pullProgress * 100)}%`}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {pullRunning && pullModel === entry.model && pullBytes.total === 0 && pullStatusText && (
                          <p className="text-xs text-nox-textDim">{pullStatusText}…</p>
                        )}
                        {pullError && pullModel === entry.model && (
                          <p className="text-xs text-red-600 dark:text-red-400">{s.pullFailed || "Download fehlgeschlagen:"} {pullError}</p>
                        )}
                      </>
                    )}
                    {/* llama_cpp: installed / not installed */}
                    {selectedBackend === "llama_cpp" && (
                      <>
                        {isInstalled ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            <span>{s.alreadyInstalled || "Bereits installiert – ausgewählt als Modell"}</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => startModelPull(entry.model)}
                            disabled={pullRunning}
                            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              pullRunning && pullModel === entry.model
                                ? "bg-nox-accent/30 text-nox-textDim"
                                : "bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg"
                            }`}
                          >
                            {pullRunning && pullModel === entry.model
                              ? `${pullPaused ? "Pausiert" : (s.downloading || "Lade herunter")}… ${Math.round(pullProgress * 100)}%`
                              : <span className="flex items-center justify-center gap-1.5"><IconArrowDown size={16} /> {entry.label} {s.downloadModelLabel || "herunterladen"}</span>}
                          </button>
                        )}
                        {!isInstalled && !pullRunning && (
                          <div className="flex items-center gap-1.5 text-xs text-nox-textDim">
                            <IconWarning size={14} />
                            <span>{s.modelNotInstalled || "Modell nicht installiert — bitte herunterladen oder ein installiertes Modell aus der Liste wählen."}</span>
                          </div>
                        )}
                        {pullRunning && pullModel === entry.model && (
                          <div className="relative rounded-lg overflow-hidden border border-nox-border bg-nox-bgSolid">
                            {/* Speed graph fills entire background */}
                            <div className="absolute inset-0">
                              <SpeedGraph history={speedHistory} paused={pullPaused} />
                            </div>
                            {/* Overlay controls on top of graph */}
                            <div className="relative h-36 flex flex-col justify-between p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 px-2 py-1 rounded-md bg-nox-bgSolid/70 backdrop-blur-sm">
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" />
                                    <span className="text-xs text-blue-400 font-semibold">{(pullBytes.speed / 1048576).toFixed(1)} MB/s</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-500" />
                                    <span className="text-xs text-yellow-400 font-semibold">{(pullBytes.writeSpeed / 1048576).toFixed(1)} MB/s</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={togglePause}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-nox-bgSolid/80 backdrop-blur-sm border border-nox-border text-nox-text hover:bg-nox-surface-hover transition-colors"
                                  >
                                    {pullPaused ? "▶ Fortsetzen" : "❚❚ Pause"}
                                  </button>
                                  <button
                                    onClick={cancelPull}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors"
                                  >
                                    ✕ Abbrechen
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-1 px-2 py-1.5 rounded-md bg-nox-bgSolid/70 backdrop-blur-sm">
                                <div className="w-full h-2 rounded-full bg-nox-border/60 overflow-hidden">
                                  <div
                                    className="h-full transition-all duration-300 rounded-full"
                                    style={{
                                      width: `${Math.round(pullProgress * 100)}%`,
                                      background: "linear-gradient(to bottom, var(--nox-glow-3, #a5b4fc) 0%, var(--nox-accent, #6366f1) 45%, color-mix(in srgb, var(--nox-accent, #6366f1) 55%, transparent) 100%)",
                                    }}
                                  />
                                </div>
                                <div className="flex justify-between text-[11px] text-nox-textDim">
                                  <span>
                                    {pullBytes.completed > 0
                                      ? `${(pullBytes.completed / 1048576).toFixed(0)} / ${(pullBytes.total / 1048576).toFixed(0)} MB`
                                      : `${Math.round(pullProgress * 100)}%`}
                                  </span>
                                  <span>{pullPaused ? "⏸ Pausiert" : `${Math.round(pullProgress * 100)}%`}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {pullRunning && pullModel === entry.model && pullBytes.total === 0 && pullStatusText && (
                          <p className="text-xs text-nox-textDim">{pullStatusText}…</p>
                        )}
                        {pullError && pullModel === entry.model && (
                          <p className="text-xs text-red-600 dark:text-red-400">{s.pullFailed || "Download fehlgeschlagen:"} {pullError}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Installed models — Ollama only (GGUF files belong to the Nox engine) */}
            {selectedBackend === "ollama" && models.filter(m => !m.endsWith(".gguf")).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-nox-textDim px-1">
                  {s.installedModels || "Installierte Modelle"} ({models.filter(m => !m.endsWith(".gguf")).length})
                </p>
                <div className="space-y-1">
                  {models.filter(m => !m.endsWith(".gguf")).map((m) => {
                    const { name, tag } = parseModelBadge(m);
                    const cloud = isCloudModel(m);
                    return (
                      <button
                        key={m}
                        title={m}
                        onClick={() => setSelectedModel(m)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                      >
                        <span className="font-medium truncate">{name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none shrink-0 ${cloud ? "bg-blue-500/15 text-blue-400" : selectedModel === m ? "bg-nox-accentFg/20 text-nox-accentFg" : "bg-nox-border/50 text-nox-textDim"}`}>{tag}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* GGUF models — llama_cpp only (strict: no Ollama models, no cloud models) */}
            {selectedBackend === "llama_cpp" && models.filter(m => m.endsWith(".gguf")).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-nox-textDim px-1">
                  {s.installedModels || "Verfügbare GGUF-Modelle"} ({models.filter(m => m.endsWith(".gguf")).length})
                </p>
                <div className="space-y-1">
                  {models.filter(m => m.endsWith(".gguf")).map((m) => {
                    const { name, tag } = parseModelBadge(m);
                    return (
                      <button
                        key={m}
                        title={m}
                        onClick={() => setSelectedModel(m)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                      >
                        <span className="font-medium truncate">{name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none shrink-0 ${selectedModel === m ? "bg-nox-accentFg/20 text-nox-accentFg" : "bg-nox-border/50 text-nox-textDim"}`}>{tag}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No models at all — manual download (Ollama only) */}
            {selectedBackend === "ollama" && models.length === 0 && (
              <div className="px-3 py-4 rounded-lg glass-card space-y-3">
                <p className="text-sm text-nox-textDim">
                  {s.noModels || "No models found. Download a model using the slider above."}
                </p>
              </div>
            )}

            {/* No GGUF models found — llama_cpp only */}
            {selectedBackend === "llama_cpp" && models.length === 0 && (
              <div className="px-3 py-4 rounded-lg glass-card space-y-3">
                <p className="text-sm text-nox-textDim">
                  Keine GGUF-Modelle gefunden. Lege eine .gguf-Datei im Models-Verzeichnis ab oder verwende Ollama.
                </p>
              </div>
            )}
              </>
            ) : (
              /* openai_compatible: model is managed externally */
              <div className="space-y-3">
                <div className="px-3 py-4 rounded-lg glass-card space-y-2">
                  <p className="text-sm text-nox-textDim">
                    {selectedBackend === "openai_compatible"
                      ? (s.modelHintLmStudio || "Lade ein Modell in LM Studio herunter und aktiviere es. Nox verwendet das aktuell aktive Modell.")
                      : (s.modelHintNox || "Select a GGUF model in the settings. You can skip this step and configure it later.")}
                  </p>
                  {selectedBackend === "openai_compatible" && models.length > 0 && (
                    <div className="space-y-1 pt-2">
                      <p className="text-xs text-nox-textDim">{s.installedModels || "Installierte Modelle"}:</p>
                      {models.map((m) => {
                        const { name, tag } = parseModelBadge(m);
                        return (
                          <button
                            key={m}
                            title={m}
                            onClick={() => setSelectedModel(m)}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                          >
                            <span className="font-medium truncate">{name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium leading-none shrink-0 ${selectedModel === m ? "bg-nox-accentFg/20 text-nox-accentFg" : "bg-nox-border/50 text-nox-textDim"}`}>{tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Audio device selection */}
        {step === 3 && (() => {
          const VIRTUAL_PATTERNS = ["soundmapper", "primärer sound", "primary sound", "directsound", "wave mapper", "s/w synth", "sw synth", "stereo mix", "stereomix", "windows direct", "primary audio", "primäres audio", "loopback", "wave out", "midi", "sonicstudio", "sonic studio", "bthhfenum", "system32", "hands-free", "hands free"];
          const filterVirtual = (devices) => devices.filter(d => {
            const n = d.name.toLowerCase();
            return !VIRTUAL_PATTERNS.some(p => n.includes(p));
          });
          const filteredInput = filterVirtual(audioDevices.input);
          const filteredOutput = filterVirtual(audioDevices.output);

          const MicIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>;
          const SpeakerIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>;

          return (
            <div className="max-w-3xl mx-auto flex flex-col gap-5">
              <h3 className="text-base font-bold text-nox-text nox-heading">{s.audioDevices || "Select audio devices"}</h3>
              <p className="text-sm text-nox-textDim">
                {s.audioDevicesHint || "Select which microphone and speakers Nox should use."}
              </p>
              <div className="space-y-4">
                {/* Input device */}
                <div className="px-4 py-4 glass-card space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-nox-accent/10 text-nox-accent shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-nox-text">{s.audioInput || "Eingang (Mikrofon)"}</label>
                      <p className="text-xs text-nox-textDim mt-0.5">{s.audioInputHint || "Mikrofon für Spracheingabe"}</p>
                    </div>
                  </div>
                  <AudioDeviceDropdown
                    devices={filteredInput}
                    selected={selectedInput}
                    onSelect={setSelectedInput}
                    defaultLabel={s.audioDefault || "Standardgerät"}
                    iconSvg={MicIcon}
                    accentClass="text-nox-accent"
                  />
                </div>

                {/* Output device */}
                <div className="px-4 py-4 glass-card space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-nox-glow3/10 text-nox-glow3 shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-nox-text">{s.audioOutput || "Ausgang (Lautsprecher)"}</label>
                      <p className="text-xs text-nox-textDim mt-0.5">{s.audioOutputHint || "Lautsprecher für Sprachausgabe"}</p>
                    </div>
                  </div>
                  <AudioDeviceDropdown
                    devices={filteredOutput}
                    selected={selectedOutput}
                    onSelect={setSelectedOutput}
                    defaultLabel={s.audioDefault || "Standardgerät"}
                    iconSvg={SpeakerIcon}
                    accentClass="text-nox-glow3"
                  />
                </div>
              </div>
              {filteredInput.length === 0 && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <span className="text-amber-400 flex-shrink-0 mt-0.5"><IconWarning size={15} /></span>
                  <p className="text-xs text-amber-300/80 leading-relaxed">
                    {s.noAudioDevices || "No audio devices found. You can use Nox via text."}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Step 4: Wake word calibration */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            <div className="text-center space-y-2">
              <h3 className="text-base font-bold text-nox-text nox-heading">{s.wakeTitle || "Wake word calibration"}</h3>
              <p className="text-sm text-nox-textDim">
                {s.wakeHint || "Sage 3× 'Hey Nox', um die Erkennung zu testen."}
              </p>
            </div>

            {wakeOk === null ? (
              <div className="px-4 py-8 glass-card flex items-center justify-center">
                <span className="text-nox-textDim text-sm animate-pulse">Wake-Word-Modell wird geprüft…</span>
              </div>
            ) : !wakeOk ? (
              <div className="px-4 py-5 glass-card space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                    <IconWarning size={18} />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-nox-text">{s.wakeModelMissing || "Wake word model not found"}</span>
                    <p className="text-xs text-nox-textDim mt-0.5 leading-relaxed">
                      {s.wakeModelHint || "Place 'hey_nox.onnx' in the models/ folder. You can skip this step and use Nox via text or the mic button."}
                    </p>
                  </div>
                </div>
              </div>
            ) : wakeAttempts >= 3 ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full bg-nox-phosphor/15 flex items-center justify-center" style={{ animation: "nox-bubble-in 0.4s ease-out" }}>
                  <IconCheck size={32} />
                </div>
                <p className="text-sm text-nox-phosphor font-medium">{s.wakeCalibrated || "Kalibrierung erfolgreich!"}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6 py-2">
                {/* Animated pulsing orb */}
                <div className="relative flex items-center justify-center w-32 h-32">
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "var(--nox-gradient-soft)",
                      animation: "nox-orb-idle 2.5s ease-in-out infinite",
                    }}
                  />
                  <div
                    className="absolute inset-2 rounded-full border-2 border-nox-accent/20"
                    style={{ animation: "nox-orb-ripple 2s ease-out infinite" }}
                  />
                  <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-nox-surface backdrop-blur-md border border-nox-border">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-nox-accent">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </div>
                </div>

                {/* 3 progress indicators */}
                <div className="flex items-center gap-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-1.5 transition-all"
                      style={{ transition: "all 0.4s var(--nox-ease-liquid)" }}
                    >
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
                          i < wakeAttempts
                            ? "bg-nox-accent/15 border-nox-accent text-nox-accent shadow-md shadow-nox-accent/20"
                            : i === wakeAttempts
                            ? "bg-nox-surface border-nox-accent/40 text-nox-accent"
                            : "bg-nox-surface/50 border-nox-border text-nox-textFaint"
                        }`}
                        style={{
                          transform: i < wakeAttempts ? "scale(1)" : i === wakeAttempts ? "scale(1.08)" : "scale(1)",
                          animation: i === wakeAttempts ? "nox-bubble-in 0.5s ease-out" : undefined,
                        }}
                      >
                        {i < wakeAttempts ? (
                          <IconCheck size={18} />
                        ) : (
                          <span className="text-xs font-mono font-medium">{i + 1}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-nox-textDim text-center">
                  {s.wakeSay || "Sage 'Hey Nox' in dein Mikrofon…"}
                </p>
                <span className="text-xs text-nox-textFaint font-mono">{wakeAttempts} / 3</span>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Done */}
        {step === 5 && (() => {
          const engineLabel =
            selectedBackend === "ollama"
              ? "Ollama"
              : selectedBackend === "llama_cpp"
                ? "Nox-Engine"
                : (s[OPENAI_PROVIDERS.find((p) => p.id === selectedProvider)?.nameKey] || "OpenAI-kompatibel");
          const summaryChips = [
            { label: engineLabel },
            selectedModel ? { label: parseModelBadge(selectedModel).name } : null,
            selectedVoice ? { label: prettyVoiceName(selectedVoice) || selectedVoice } : null,
          ].filter(Boolean);
          return (
            <div className="max-w-3xl mx-auto flex flex-col items-center justify-center h-full gap-7 text-center">
              {/* Success mark with pulsing halo */}
              <div className="relative flex items-center justify-center" style={{ animation: "nox-bubble-in 0.5s ease-out both" }}>
                <span className="absolute w-28 h-28 rounded-full bg-green-500/10 animate-ping" style={{ animationDuration: "2.6s" }} />
                <span className="absolute w-24 h-24 rounded-full bg-green-500/5" />
                <div
                  className="relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/30 ring-1 ring-green-400/40"
                  style={{ background: "linear-gradient(135deg, #34d399 0%, #16a34a 100%)" }}
                >
                  <IconCheck size={30} weight={7} />
                </div>
              </div>
              <div className="space-y-2" style={{ animation: "nox-bubble-in 0.5s ease-out 0.12s both" }}>
                <h3 className="text-xl font-semibold text-nox-text">{s.setupComplete || "Einrichtung abgeschlossen"}</h3>
                <p className="text-sm text-nox-textDim max-w-md leading-relaxed">
                  {s.setupCompleteText || "Nox ist bereit. Du kannst jetzt Fragen stellen, Sprache verwenden und Kontext erfassen lassen."}
                </p>
              </div>
              {/* Setup summary */}
              {summaryChips.length > 0 && (
                <div className="flex items-center justify-center gap-2 flex-wrap" style={{ animation: "nox-bubble-in 0.5s ease-out 0.24s both" }}>
                  {summaryChips.map((chip, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-nox-surface/70 border border-nox-border text-xs text-nox-textDim"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-nox-phosphor shrink-0" />
                      {chip.label}
                    </span>
                  ))}
                </div>
              )}
              {/* Analytics opt-in */}
              <label
                className="flex items-start gap-3 px-4 py-3 rounded-xl bg-nox-surface/50 border border-nox-border cursor-pointer hover:border-nox-accent/40 transition-colors text-left max-w-md"
                style={{ animation: "nox-bubble-in 0.5s ease-out 0.36s both" }}
              >
                <input
                  type="checkbox"
                  checked={analyticsOptIn}
                  onChange={(e) => setAnalyticsOptIn(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-nox-accent shrink-0"
                />
                <span className="text-xs text-nox-textDim leading-relaxed">
                  {s.analyticsOptIn || "Anonyme Nutzungs-Analyse erlauben (hilft Nox zu verbessern, keine Inhalte/IPs)"}
                </span>
              </label>
            </div>
          );
        })()}
      </div>

      {/* Navigation — Back left, dots center, Next right */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-nox-border shrink-0">
        <div className="flex-1 flex justify-start">
          {step > 0 ? (
            <button
              onClick={prev}
              className={btnSecondary}
            >
              {s.back || "Back"}
            </button>
          ) : (
            <button
              onClick={() => window.nox?.closeWindow?.()}
              className={btnSecondary}
            >
              {s.closeApp || "Close"}
            </button>
          )}
        </div>
        <div className="flex-1 flex justify-center gap-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-nox-accent" : i < step ? "w-1.5 bg-nox-accent/40" : "w-1.5 bg-nox-border"}`}
            />
          ))}
        </div>
        <div className="flex-1 flex justify-end">
          {step < steps.length - 1 ? (
            <button
              onClick={next}
              disabled={(step === 0 && (!selectedBackend || (selectedBackend === "ollama" && !ollamaOk) || (selectedBackend === "openai_compatible" && !lmStudioOk) || (selectedBackend === "llama_cpp" && !noxBackendOk))) || (step === 1 && !selectedVoice) || (step === 2 && (selectedBackend === "ollama" || selectedBackend === "llama_cpp") && (!selectedModel || !models.some(m => m === selectedModel || m.startsWith(selectedModel) || selectedModel.startsWith(m))))}
              className={(step === 0 && (!selectedBackend || (selectedBackend === "ollama" && !ollamaOk) || (selectedBackend === "openai_compatible" && !lmStudioOk) || (selectedBackend === "llama_cpp" && !noxBackendOk))) || (step === 1 && !selectedVoice) || (step === 2 && (selectedBackend === "ollama" || selectedBackend === "llama_cpp") && (!selectedModel || !models.some(m => m === selectedModel || m.startsWith(selectedModel) || selectedModel.startsWith(m)))) ? btnDisabled : btnPrimary}
            >
              {s.next || "Next"}
            </button>
          ) : (
            <button onClick={finish} className={btnPrimary}>
              {s.finish || "Finish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnboardingWizard;
