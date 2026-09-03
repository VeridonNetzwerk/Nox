import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogoGlowing from "../../assets/nox-logo-glowing.png";
import noxIcon from "../../assets/nox-icon.png";
import { useToast } from "../common/Toast.jsx";
import { API_BASE, FlagIcon, LanguageDropdown } from "../../shared/constants.jsx";
import { IconWarning, IconArrowDown, IconCheck, IconX } from "../../shared/Icon.jsx";
import { prettyModelName } from "../../shared/prettyNames.jsx";

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
  { id: "lmstudio",      nameKey: "providerLMStudio",      descKey: "providerLMStudioDesc",      endpoint: "http://localhost:1234/v1" },
  { id: "llamacpp",      nameKey: "providerLlamaCpp",      descKey: "providerLlamaCppDesc",      endpoint: "http://127.0.0.1:8080/v1" },
  { id: "jan",           nameKey: "providerJan",           descKey: "providerJanDesc",           endpoint: "http://127.0.0.1:1337/v1" },
  { id: "gpt4all",       nameKey: "providerGPT4All",       descKey: "providerGPT4AllDesc",       endpoint: "http://localhost:4891/v1" },
  { id: "koboldcpp",     nameKey: "providerKoboldCpp",     descKey: "providerKoboldCppDesc",     endpoint: "http://localhost:5001/v1" },
  { id: "ollama_compat", nameKey: "providerOllamaCompat",  descKey: "providerOllamaCompatDesc",  endpoint: "http://localhost:11434/v1" },
  { id: "vllm",          nameKey: "providerVLLM",          descKey: "providerVLLMDesc",          endpoint: "http://localhost:8000/v1" },
  { id: "textgen_webui", nameKey: "providerTextGenWebUI",  descKey: "providerTextGenWebUIDesc",  endpoint: "http://127.0.0.1:5000/v1" },
  { id: "custom",        nameKey: "providerCustom",        descKey: "providerCustomDesc",        endpoint: "" },
];

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
  const [lmStudioOk, setLmStudioOk] = useState(null);
  const [noxBackendOk, setNoxBackendOk] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("lmstudio");
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
  const [pullError, setPullError] = useState(null);
  const [pullModel, setPullModel] = useState("");
  const [pullBytes, setPullBytes] = useState({ completed: 0, total: 0, speed: 0 });
  const [pullStatusText, setPullStatusText] = useState("");
  const [sliderPos, setSliderPos] = useState(2); // default: balance
  const [showInstalledModels, setShowInstalledModels] = useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = useState(true);

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

  // Model table: (vram_min_mb, vram_max_mb) -> {mode: {model, label, desc, size}}
  const MODEL_TABLE = [
    { range: [0, 4096], modes: {
      superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", desc: "Kleinstes Modell – blitzschnell, auch auf CPU.", size: "~1.3 GB", warning: "Sehr kleines Modell – kann ungenaue oder seltsame Antworten geben, Tool-Aufrufe fehlerhaft auslösen. Nur für einfache Aufgaben geeignet." },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Kompakt und schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      balance:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Bester Tool-User für begrenzte Hardware – Thinking Mode.", size: "~2.2 GB" },
      qualitaet:    { model: "phi4-mini:3.8b", label: "Phi-4 mini 3.8B", desc: "Beste Qualität für sehr begrenzte Hardware.", size: "~3.0 GB", warning: "Kompaktes Modell – bei komplexeren Aufgaben können Fehler auftreten." },
    }},
    { range: [4096, 8192], modes: {
      superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", desc: "Blitzschnell – ideal für einfache Aufgaben.", size: "~1.3 GB", warning: "Sehr kleines Modell – kann ungenaue oder seltsame Antworten geben, Tool-Aufrufe fehlerhaft auslösen. Nur für einfache Aufgaben geeignet." },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Schnell und kompakt – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      balance:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Gute Balance für 4-8 GB VRAM – Tool-Calling.", size: "~4.0 GB" },
      qualitaet:    { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Qualität für 4-8 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
    }},
    { range: [8192, 12288], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Sehr schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Schnell und kompakt – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Balance für 8-12 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
      qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Hohe Qualität für 8-12 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
    }},
    { range: [12288, 16384], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Blitzschnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~4.0 GB" },
      balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Balance für 12-16 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
      qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Höchste Qualität für 12-16 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
    }},
    { range: [16384, 20480], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Sehr schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
      schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~4.0 GB" },
      balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Beste Balance für 16-20 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
      qualitaet:    { model: "gemma4:26b", label: "Gemma 4 26B", desc: "Höchste Qualität für 16-20 GB VRAM – MoE, native FC.", size: "~15 GB" },
    }},
    { range: [20480, 24576], modes: {
      superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Sehr schnell – gut für einfache Aufgaben.", size: "~4.0 GB" },
      schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~6.5 GB" },
      balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Beste Balance für 20-24 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
      qualitaet:    { model: "qwen3.8:27b", label: "Qwen 3.8 27B", desc: "Höchste Qualität für 20-24 GB VRAM – hybrid Attention, agentic Coding.", size: "~18 GB" },
    }},
    { range: [24576, 32768], modes: {
      superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Sehr schnell – gut für einfache Aufgaben.", size: "~4.0 GB" },
      schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
      balance:      { model: "gemma4:26b", label: "Gemma 4 26B", desc: "Beste Balance für 24-32 GB VRAM – MoE, native FC.", size: "~15 GB" },
      qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Höchste Qualität für 24-32 GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
    }},
    { range: [32768, 40960], modes: {
      superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
      schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Schnell mit hoher Qualität – Tool-Calling.", size: "~9.0 GB" },
      balance:      { model: "qwen3.8:27b", label: "Qwen 3.8 27B", desc: "Beste Balance für 32-40 GB VRAM – hybrid Attention, agentic Coding.", size: "~18 GB" },
      qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Höchste Qualität für 32-40 GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
    }},
    { range: [40960, 999999], modes: {
      superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
      schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Schnell mit hoher Qualität – Tool-Calling.", size: "~9.0 GB" },
      balance:      { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Beste Balance für 40+ GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
      qualitaet:    { model: "granite4.2:30b", label: "Granite 4.2 30B", desc: "Höchste Qualität für 40+ GB VRAM – Thinking Mode, bester Tool-Use.", size: "~18 GB" },
    }},
  ];

  const MODE_KEYS = ["superschnell", "schnell", "balance", "qualitaet"];
  const MODE_LABELS = [
    { icon: <IconLightning />, label: s.modeSuperFast || "Superschnell" },
    { icon: <IconRocket />, label: s.modeFast || "Schnell" },
    { icon: <IconScale />, label: s.modeBalanced || "Balance" },
    { icon: <IconStar />, label: s.modeQuality || "Qualität" },
  ];

  // Auto-select model when slider position changes and the tier's model is installed
  useEffect(() => {
    if (step !== 2 || !gpuInfo) return;
    const vram = gpuInfo?.vram_mb || 0;
    const tier = MODEL_TABLE.find(t => vram >= t.range[0] && vram < t.range[1]) || MODEL_TABLE[0];
    const modeKey = MODE_KEYS[sliderPos];
    const entry = tier.modes[modeKey];
    if (entry && entry.model) {
      // Check if model is installed (exact or prefix match)
      const installed = models.find(m => m === entry.model || m.startsWith(entry.model));
      if (installed) {
        setSelectedModel(installed);
      }
    }
  }, [sliderPos, step, gpuInfo, models]);

  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
      const data = await res.json();
      setPullProgress(data.progress || 0);
      setPullBytes({ completed: data.completed || 0, total: data.total || 0, speed: data.speed || 0 });
      setPullStatusText(data.status_text || "");
      setPullModel(data.model || "");
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
          if (data.model) setSelectedModel(data.model);
        }
      }
    } catch {
      pollRef.current = setTimeout(poll, 2000);
    }
  };

  // Resume polling on mount if a pull is already running (e.g. after HMR)
  useEffect(() => {
    if (pullRunning) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
        const data = await res.json();
        if (!cancelled && data.running) {
          setPullRunning(true);
          setPullModel(data.model || "");
          setPullProgress(data.progress || 0);
          setPullBytes({ completed: data.completed || 0, total: data.total || 0, speed: data.speed || 0 });
          setPullStatusText(data.status_text || "");
          pollRef.current = setTimeout(poll, 1000);
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
        // Check if a backend is already configured
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

  const selectProvider = (providerId) => {
    setSelectedProvider(providerId);
    const provider = OPENAI_PROVIDERS.find(p => p.id === providerId);
    if (provider) {
      setLmStudioEndpoint(provider.endpoint);
      saveBackendChoice("openai_compatible", provider.endpoint);
    }
    setLmStudioOk(true);
  };

  const selectBackend = (backend) => {
    setSelectedBackend(backend);
    setOllamaOk(null);
    setLmStudioOk(null);
    setNoxBackendOk(null);
    if (backend === "ollama") {
      saveBackendChoice("ollama").then(() => checkOllama());
    } else if (backend === "openai_compatible") {
      const provider = OPENAI_PROVIDERS.find(p => p.id === selectedProvider);
      if (provider && provider.endpoint) {
        setLmStudioEndpoint(provider.endpoint);
      }
      setLmStudioOk(true);
      saveBackendChoice("openai_compatible");
    } else if (backend === "llama_cpp") {
      setNoxBackendOk(true);
      saveBackendChoice(backend);
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
    setPullStatusText("starting");
    try {
      await fetch(`${API_BASE}/api/onboarding/pull-ollama-model`, {
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
      fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm_speed_mode: MODE_KEYS[sliderPos] }),
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-nox-border shrink-0">
        <div className="flex items-center gap-3">
          <img src={noxIcon} alt="Nox" className="w-6 h-6 rounded-full" />
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
            background: 'linear-gradient(90deg, var(--nox-accent), var(--nox-violet))',
            boxShadow: '0 0 8px rgba(99, 102, 241, 0.4)',
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
              <img src={noxLogoGlowing} alt="Nox" className="w-36 h-auto" style={{ filter: 'drop-shadow(0 0 24px rgba(99, 102, 241, 0.35))' }} />
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-nox-text text-base">Ollama</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium leading-none">Recommended</span>
                  </div>
                  {selectedBackend === "ollama" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendOllamaDesc || "Local AI engine — easy to install, many models."}</p>
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-nox-text text-base">Nox</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium leading-none">Experimental</span>
                  </div>
                  {selectedBackend === "llama_cpp" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendNoxDesc || "Built-in AI engine (llama.cpp) — no external software needed. Experimental."}</p>
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
                  {selectedBackend === "openai_compatible" && (
                    <svg className="w-4 h-4 text-nox-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <p className="text-xs text-nox-textDim leading-relaxed">{s.backendOtherDesc || "Use an external OpenAI-compatible server of your choice."}</p>
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
                    <span className={`text-xs font-mono ${gpuInfo.cuda_available ? "text-nox-phosphor" : "text-nox-amber"} flex items-center gap-1.5`}>
                      {gpuInfo.cuda_available
                        ? <><span className="nox-status-dot" /> {gpuInfo.gpu_name || "GPU"}</>
                        : gpuInfo.nvidia_driver_present
                        ? <><IconWarning size={12} /> CPU-Fallback</>
                        : "CPU-Modus"}
                    </span>
                  </div>
                )}
                {gpuInfo && !gpuInfo.cuda_available && (
                  <p className="text-xs text-yellow-400 px-3">
                    {s.gpuCpuFallback || "CUDA not available — Nox runs in CPU mode. Voice will be slower, text chat works normally."}
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
                      {s.retryCheck || "Check again"}
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
                      {s.retryCheck || "Check again"}
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
                      {provider.endpoint && (
                        <p className="text-[10px] text-nox-textDim/60 font-mono mt-1 truncate">{provider.endpoint}</p>
                      )}
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

                {selectedProvider !== "custom" && (
                  <div className="px-4 py-3 nox-console-card">
                    <label className="nox-label">{s.lmStudioEndpoint || "Server address"}</label>
                    <input
                      type="text"
                      value={lmStudioEndpoint}
                      onChange={(e) => setLmStudioEndpoint(e.target.value)}
                      onBlur={() => saveBackendChoice("openai_compatible")}
                      className="w-full bg-nox-bg text-nox-text text-sm rounded-lg px-3 py-2.5 border border-nox-border focus:outline-none focus:border-nox-accent font-mono"
                    />
                    <p className="text-xs text-nox-textDim mt-2">
                      {s.otherProviderHint || "Start the server in your software and select it here. Nox connects automatically."}
                    </p>
                  </div>
                )}

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
                    <span className={`text-xs font-mono ${gpuInfo.cuda_available ? "text-nox-phosphor" : "text-nox-amber"} flex items-center gap-1.5`}>
                      {gpuInfo.cuda_available
                        ? <><span className="nox-status-dot" /> {gpuInfo.gpu_name || "GPU"}</>
                        : "CPU-Modus"}
                    </span>
                  </div>
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
                    ? (s.modelHintNox || "Select a GGUF model in the settings. You can skip this step and configure it later.")
                    : (s.modelHint || "Select the Ollama model Nox should use.")}
                </p>

            {/* Speed/Quality mode slider — picks model based on VRAM and mode */}
            {(() => {
              const vram = gpuInfo?.vram_mb || 0;
              const gpuMode = gpuInfo?.cuda_available ? "GPU" : "CPU";

              const tier = MODEL_TABLE.find(t => vram >= t.range[0] && vram < t.range[1]) || MODEL_TABLE[0];
              const modeKey = MODE_KEYS[sliderPos];
              const entry = tier.modes[modeKey];
              const isInstalled = selectedBackend === "ollama" && models.some(m => m === entry.model || m.startsWith(entry.model));

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
                              ? `${s.downloading || "Lade herunter"}… ${Math.round(pullProgress * 100)}%`
                              : <span className="flex items-center justify-center gap-1.5"><IconArrowDown size={16} /> {entry.label} {s.downloadModelLabel || "herunterladen"}</span>}
                          </button>
                        )}
                        {pullRunning && pullModel === entry.model && (
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
                        {pullRunning && pullModel === entry.model && pullBytes.total === 0 && pullStatusText && (
                          <p className="text-xs text-nox-textDim">{pullStatusText}…</p>
                        )}
                        {pullError && pullModel === entry.model && (
                          <p className="text-xs text-red-600 dark:text-red-400">{s.pullFailed || "Download fehlgeschlagen:"} {pullError}</p>
                        )}
                      </>
                    )}
                    {selectedBackend === "llama_cpp" && (
                      <div className="flex items-center gap-1.5 text-xs text-nox-accent">
                        <IconCheck size={14} />
                        <span>{s.speedModeSelected || "Speed mode selected — applies to generation parameters."}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Collapsible installed models — Ollama only */}
            {selectedBackend === "ollama" && models.length > 0 && (
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
                    <span className="text-xs text-nox-accent font-medium">{prettyModelName(selectedModel)}</span>
                  )}
                </button>
                {showInstalledModels && (
                  <div className="space-y-1 pt-1">
                    {models.map((m) => (
                      <button
                        key={m}
                        onClick={() => setSelectedModel(m)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                      >
                        {prettyModelName(m)}
                      </button>
                    ))}
                  </div>
                )}
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
                      {models.map((m) => (
                        <button
                          key={m}
                          onClick={() => setSelectedModel(m)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedModel === m ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-text hover:bg-nox-border"}`}
                        >
                          {prettyModelName(m)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Audio device selection */}
        {step === 3 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            <h3 className="text-base font-bold text-nox-text nox-heading">{s.audioDevices || "Select audio devices"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.audioDevicesHint || "Select which microphone and speakers Nox should use."}
            </p>
            <div className="space-y-3">
              <div className="px-3 py-3 nox-console-card space-y-2">
                <label className="nox-label">
                  {s.audioInput || "Eingang (Mikrofon)"}
                </label>
                <select
                  className="w-full bg-nox-bg text-nox-text text-sm rounded px-3 py-2 border border-nox-border focus:outline-none focus:border-nox-accent font-mono"
                  value={selectedInput}
                  onChange={(e) => setSelectedInput(e.target.value)}
                >
                  <option value="default">{s.audioDefault || "Default device"}</option>
                  {audioDevices.input.map((d) => (
                    <option key={d.index} value={d.name}>
                      {d.name}{d.is_default ? " (Standard)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="px-3 py-3 nox-console-card space-y-2">
                <label className="nox-label">
                  {s.audioOutput || "Ausgang (Lautsprecher)"}
                </label>
                <select
                  className="w-full bg-nox-bg text-nox-text text-sm rounded px-3 py-2 border border-nox-border focus:outline-none focus:border-nox-accent font-mono"
                  value={selectedOutput}
                  onChange={(e) => setSelectedOutput(e.target.value)}
                >
                  <option value="default">{s.audioDefault || "Default device"}</option>
                  {audioDevices.output.map((d) => (
                    <option key={d.index} value={d.name}>
                      {d.name}{d.is_default ? " (Standard)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {audioDevices.input.length === 0 && (
              <p className="text-xs text-yellow-400">
                {s.noAudioDevices || "No audio devices found. You can use Nox via text."}
              </p>
            )}
          </div>
        )}

        {/* Step 4: Wake word calibration */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            <h3 className="text-base font-bold text-nox-text nox-heading">{s.wakeTitle || "Wake word calibration"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.wakeHint || "Sage 3× 'Hey Nox', um die Erkennung zu testen."}
            </p>
            <div className="px-3 py-4 nox-console-card">
              {wakeOk === null ? (
                <span className="text-nox-textDim text-sm">…</span>
              ) : wakeOk ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600 dark:text-green-500"><IconCheck size={18} /></span>
                    <span className="text-sm text-nox-text">{s.wakeModelFound || "Wake word model found"}</span>
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
                    <p className="text-xs text-green-600 dark:text-green-500">
                      {s.wakeCalibrated || "Kalibrierung erfolgreich!"}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-600 dark:text-yellow-500"><IconWarning size={18} /></span>
                    <span className="text-sm text-nox-text">{s.wakeModelMissing || "Wake word model not found"}</span>
                  </div>
                  <p className="text-xs text-nox-textDim">
                    {s.wakeModelHint || "Place 'hey_nox.onnx' in the models/ folder. You can skip this step and use Nox via text or the mic button."}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Done */}
        {step === 5 && (
          <div className="max-w-3xl mx-auto flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-600/20 dark:bg-green-500/20 flex items-center justify-center">
              <IconCheck size={32} />
            </div>
            <h3 className="text-lg font-semibold text-nox-text">{s.setupComplete || "Einrichtung abgeschlossen"}</h3>
            <p className="text-sm text-nox-textDim max-w-md">
              {s.setupCompleteText || "Nox ist bereit. Du kannst jetzt Fragen stellen, Sprache verwenden und Kontext erfassen lassen."}
            </p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={analyticsOptIn}
                onChange={(e) => setAnalyticsOptIn(e.target.checked)}
                className="w-4 h-4 rounded accent-nox-accent"
              />
              <span className="text-xs text-nox-textDim text-left max-w-xs">
                {s.analyticsOptIn || "Anonyme Nutzungs-Analyse erlauben (hilft Nox zu verbessern, keine Inhalte/IPs)"}
              </span>
            </label>
          </div>
        )}
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
              disabled={(step === 0 && (!selectedBackend || (selectedBackend === "ollama" && !ollamaOk) || (selectedBackend === "openai_compatible" && !lmStudioOk) || (selectedBackend === "llama_cpp" && !noxBackendOk))) || (step === 1 && !selectedVoice) || (step === 2 && selectedBackend === "ollama" && selectedModel && !models.includes(selectedModel))}
              className={(step === 0 && (!selectedBackend || (selectedBackend === "ollama" && !ollamaOk) || (selectedBackend === "openai_compatible" && !lmStudioOk) || (selectedBackend === "llama_cpp" && !noxBackendOk))) || (step === 1 && !selectedVoice) || (step === 2 && selectedBackend === "ollama" && selectedModel && !models.includes(selectedModel)) ? btnDisabled : btnPrimary}
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
