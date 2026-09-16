import React, { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../../shared/constants.jsx";
import { GGUF_FILENAMES } from "../../shared/prettyNames.jsx";
import { getVramTier } from "../../shared/modelTable.js";
import { IconCheck, IconArrowDown, IconSpinner, IconX } from "../../shared/Icon.jsx";
import { useToast } from "../common/Toast.jsx";
import ModelDetailModal from "./ModelDetailModal.jsx";
import FamilyLogo, { familyOf } from "./FamilyLogo.jsx";
import { formatGb, formatSpeed, formatPulls, formatUpdated, FIT_STYLES } from "./marketFormat.js";

// Marketplace catalog — mirrors GGUF_DOWNLOAD_URLS in the backend.
// vramGb = VRAM needed for GPU inference; pulls/updatedDays = curated popularity data.
// benchmarks = rounded reference values from public sources (approximate).
const MARKET_CATALOG = [
  { key: "qwen3.5:0.8b",    family: "Qwen",    name: "Qwen 3.5 0.8B",    params: "0.8B",  sizeGb: 1.3, vramGb: 2,  context: "128K", pulls: 19.8, updatedDays: 7,   license: "Apache 2.0", tags: ["Tool-Calling", "Vision"],      desc: "Kleinstes Modell – blitzschnell, auch auf CPU.", gradient: "from-violet-500 to-fuchsia-500",
    longDesc: "Das kleinste Modell im Katalog. Reagiert nahezu verzögerungsfrei und läuft auch ohne dedizierte GPU flüssig. Gedacht für einfache Fragen, Kurzantworten und schnelle Befehle – bei komplexen Aufgaben und Tool-Aufrufen stößt es schnell an Grenzen.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 60 }, { label: "GSM8K (Mathe)", value: 55 }, { label: "HumanEval (Code)", value: 45 }] },
  { key: "granite4.2:3b",   family: "Granite", name: "Granite 4.2 3B",   params: "3B",    sizeGb: 2.2, vramGb: 4,  context: "128K", pulls: 24.5, updatedDays: 7,   tags: ["Thinking", "Tool-Calling"],    desc: "Kompakt und schnell – exzellent für Tool-Use.", gradient: "from-sky-500 to-cyan-400",
    license: "Apache 2.0",
    longDesc: "IBMs kompaktes Enterprise-Modell mit Thinking Mode. Überragend im Tool-Calling für seine Größe und erstaunlich präzise bei strukturierten Aufgaben. Der beste Kompromiss aus Geschwindigkeit und Zuverlässigkeit auf schwächerer Hardware.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 65 }, { label: "GSM8K (Mathe)", value: 70 }, { label: "BFCL (Tools)", value: 72 }] },
  { key: "phi4-mini:3.8b",  family: "Phi",     name: "Phi-4 mini 3.8B",  params: "3.8B",  sizeGb: 3.0, vramGb: 5,  context: "128K", pulls: 5.0,  updatedDays: 90,  tags: ["Reasoning"],                   desc: "Beste Qualität für sehr begrenzte Hardware.", gradient: "from-emerald-500 to-teal-400",
    license: "MIT",
    longDesc: "Microsofts effizientes Reasoning-Modell. Punktet mit ungewöhnlich guten Mathematik- und Logik-Fähigkeiten für seine Größe. Ideal, wenn auf alter Hardware maximale Antwortqualität gefragt ist.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 68 }, { label: "GSM8K (Mathe)", value: 80 }, { label: "HumanEval (Code)", value: 75 }] },
  { key: "qwen3.5:4b",      family: "Qwen",    name: "Qwen 3.5 4B",      params: "4B",    sizeGb: 4.0, vramGb: 6,  context: "128K", pulls: 19.8, updatedDays: 7,   tags: ["Tool-Calling", "Vision"],      desc: "Gute Balance für schwächere GPUs.", gradient: "from-violet-500 to-fuchsia-500",
    license: "Apache 2.0",
    longDesc: "Der Allrounder für Einsteiger-GPUs. Solide Sprachqualität, zuverlässiges Tool-Calling und multimodale Fähigkeiten (Vision) bei moderatem Speicherbedarf.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 70 }, { label: "GSM8K (Mathe)", value: 75 }, { label: "HumanEval (Code)", value: 65 }] },
  { key: "gemma4:e4b",      family: "Gemma",   name: "Gemma 4 E4B",      params: "E4B",   sizeGb: 5.0, vramGb: 6,  context: "128K", pulls: 24.5, updatedDays: 7,   tags: ["MoE", "Vision"],               desc: "Effiziente Gemma-Variante mit aktivem Expertenrouting.", gradient: "from-amber-500 to-orange-400",
    license: "Gemma Terms",
    longDesc: "Google Gemma 4 als effiziente MoE-Variante: große Wissensbasis, aber nur ein Bruchteil der Parameter ist pro Token aktiv. Fühlt sich größer an, als es ist – bei flinker Antwortgeschwindigkeit.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 68 }, { label: "GSM8K (Mathe)", value: 72 }, { label: "HumanEval (Code)", value: 60 }] },
  { key: "qwen3.5:9b",      family: "Qwen",    name: "Qwen 3.5 9B",      params: "9B",    sizeGb: 6.5, vramGb: 10, context: "128K", pulls: 19.8, updatedDays: 7,   tags: ["Tool-Calling", "Vision"],      desc: "Beste Balance für 8-16 GB VRAM.", gradient: "from-violet-500 to-fuchsia-500",
    license: "Apache 2.0",
    longDesc: "Der Sweet Spot für 8-16-GB-GPUs. Deutlich stärker in Reasoning, Code und Tool-Nutzung als die kleinen Varianten, ohne in Speicherdruck zu geraten. Die empfohlene Standardwahl für die meisten.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 75 }, { label: "GSM8K (Mathe)", value: 85 }, { label: "HumanEval (Code)", value: 75 }] },
  { key: "qwen3.5:14b",     family: "Qwen",    name: "Qwen 3.5 14B",     params: "14B",   sizeGb: 9.0, vramGb: 14, context: "128K", pulls: 19.8, updatedDays: 7,   tags: ["Tool-Calling", "Vision"],      desc: "Hohe Qualität für 12-20 GB VRAM.", gradient: "from-violet-500 to-fuchsia-500",
    license: "Apache 2.0",
    longDesc: "Für alle, die mehr wollen: spürbar besseres Reasoning, längere kohärente Antworten und robustes Tool-Calling. Braucht 12+ GB VRAM für vollen GPU-Betrieb.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 78 }, { label: "GSM8K (Mathe)", value: 88 }, { label: "HumanEval (Code)", value: 80 }] },
  { key: "gemma4:26b",      family: "Gemma",   name: "Gemma 4 26B A4B",  params: "26B",   sizeGb: 15,  vramGb: 20, context: "128K", pulls: 24.5, updatedDays: 7,   tags: ["MoE", "Tool-Calling", "Vision"], desc: "MoE-Modell – 26B Parameter, 4B aktiv, native FC.", gradient: "from-amber-500 to-orange-400",
    license: "Gemma Terms",
    longDesc: "Gemma 4 als MoE mit 4B aktiven Parametern: Wissensdichte eines 26B-Modells bei der Geschwindigkeit eines kleinen Modells. Native Function Calling und starke multimodale Fähigkeiten.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 80 }, { label: "GSM8K (Mathe)", value: 88 }, { label: "HumanEval (Code)", value: 78 }] },
  { key: "granite4.2:30b",  family: "Granite", name: "Granite 4.2 30B",  params: "30B",   sizeGb: 18,  vramGb: 24, context: "128K", pulls: 24.5, updatedDays: 7,   tags: ["Thinking", "Tool-Calling"],    desc: "Höchste Qualität – bester Tool-Use für Workstations.", gradient: "from-sky-500 to-cyan-400",
    license: "Apache 2.0",
    longDesc: "IBMs Flaggschiff für Workstations. Bester Tool-User im Katalog, Thinking Mode für durchdachte mehrstufige Antworten und Enterprise-taugliche Zuverlässigkeit.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 82 }, { label: "GSM8K (Mathe)", value: 90 }, { label: "BFCL (Tools)", value: 85 }] },
  { key: "qwen3.8:27b",     family: "Qwen",    name: "Qwen 3.8 27B",     params: "27B",   sizeGb: 18,  vramGb: 24, context: "256K", pulls: 1.6,  updatedDays: 21,  tags: ["Agentic Coding", "Vision"],    desc: "Starkes Modell für High-End-GPUs.", gradient: "from-violet-500 to-fuchsia-500",
    license: "Apache 2.0",
    longDesc: "Qwens Coding- und Agenten-Spezialist mit hybrider Attention und 256K Kontext. Gebaut für lange Coding-Sessions, mehrstufige Agenten-Workflows und große Dokumente.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 82 }, { label: "GSM8K (Mathe)", value: 90 }, { label: "HumanEval (Code)", value: 85 }] },
  { key: "qwen3.6:35b-a3b", family: "Qwen",    name: "Qwen 3.6 35B A3B", params: "35B",   sizeGb: 23,  vramGb: 28, context: "256K", pulls: 6.5,  updatedDays: 180, tags: ["MoE", "Agentic Coding", "Vision"], desc: "Höchste Qualität – MoE mit 3B aktiven Parametern.", gradient: "from-violet-500 to-fuchsia-500",
    license: "Apache 2.0",
    longDesc: "Das stärkste Modell im Katalog: MoE mit 35B Parametern, von denen nur 3B aktiv sind – maximale Qualität bei erstaunlich flinker Geschwindigkeit. Für High-End-Workstations.",
    benchmarks: [{ label: "MMLU (Wissen)", value: 84 }, { label: "GSM8K (Mathe)", value: 92 }, { label: "HumanEval (Code)", value: 88 }] },
];

const COLLECTIONS = [
  { id: "alle",      label: "Alle",                     match: () => true },
  { id: "passt",     label: "Passt auf meine Hardware",  hwOnly: true },
  { id: "coding",    label: "Für Coding",               match: (e) => e.tags.includes("Agentic Coding") },
  { id: "klein",     label: "Kleine Modelle",           match: (e) => e.sizeGb <= 5 },
  { id: "thinking",  label: "Thinking",                 match: (e) => e.tags.includes("Thinking") },
  { id: "tools",     label: "Tool-Calling",             match: (e) => e.tags.includes("Tool-Calling") },
  { id: "moe",       label: "MoE",                      match: (e) => e.tags.includes("MoE") },
  { id: "reasoning", label: "Reasoning",                match: (e) => e.tags.includes("Reasoning") },
  { id: "vision",    label: "Vision",                   match: (e) => e.tags.includes("Vision") },
];

const SORTS = [
  { id: "beliebt", label: "Beliebt" },
  { id: "neu", label: "Neu" },
  { id: "groesse", label: "Größe" },
];

// Capability filters for the Ollama library tab
const OLLAMA_COLLECTIONS = [
  { id: "alle", label: "Alle", match: () => true },
  { id: "vision", label: "Vision", match: (e) => e.tags.includes("Vision") },
  { id: "tools", label: "Tool-Calling", match: (e) => e.tags.includes("Tool-Calling") },
  { id: "thinking", label: "Thinking", match: (e) => e.tags.includes("Thinking") },
  { id: "embedding", label: "Embedding", match: (e) => e.tags.includes("Embedding") },
];

const ENGINE_HINTS = {
  llama_cpp: "GGUF-Modelle, direkt in Nox geladen – Download über die eingebaute Engine.",
  ollama: "Das komplette öffentliche Ollama-Angebot – Installation läuft über Ollama.",
  openai_compatible: "Modelle deines OpenAI-kompatiblen Servers (LM Studio, llamafile, …) – Verwaltung erfolgt dort.",
};

const PICK_MODES = [
  { key: "superschnell", label: "Superschnell", icon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
  )},
  { key: "balance", label: "Balance", icon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16l3-8 3 8c-2 1.5-4 1.5-6 0" /><path d="M2 16l3-8 3 8c-2 1.5-4 1.5-6 0" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></svg>
  )},
  { key: "qualitaet", label: "Qualität", icon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
  )},
];

export default function Marketplace({ onClose }) {
  const { addToast } = useToast();
  // Currently configured backend (from settings) — distinct from the selected tab (activeEngine)
  const [configuredEngine, setConfiguredEngine] = useState("ollama");
  const [installedModels, setInstalledModels] = useState([]);
  const [currentModel, setCurrentModel] = useState("");
  const [hw, setHw] = useState(null);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("alle");
  const [sortBy, setSortBy] = useState("beliebt");
  const [pull, setPull] = useState(null);
  const wasRunningRef = useRef(false);
  // Optimistically installed keys — bridges the gap until the models list refreshes
  const [justInstalled, setJustInstalled] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [modelDetails, setModelDetails] = useState({});
  // Engine tabs — only engines that actually respond on this system
  const [engines, setEngines] = useState([]);
  const [activeEngine, setActiveEngine] = useState(null);
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [openaiModels, setOpenaiModels] = useState([]);
  const [openaiLoading, setOpenaiLoading] = useState(false);

  const refreshModels = useCallback(async () => {
    try {
      const [modelsRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/settings`),
      ]);
      const modelsData = await modelsRes.json();
      const settingsData = await settingsRes.json();
      setInstalledModels(modelsData.available_models || []);
      setModelDetails(modelsData.model_details || {});
      const backend = settingsData.llm_backend || "ollama";
      setConfiguredEngine(backend === "llama_cpp" ? "llama_cpp" : backend === "openai_compatible" ? "openai_compatible" : "ollama");
      setCurrentModel(settingsData.ollama_model || "");
    } catch {}
  }, []);

  useEffect(() => {
    refreshModels();
    // Hardware profile for fit indicators and recommendations
    fetch(`${API_BASE}/api/onboarding/gpu-check`)
      .then((r) => r.json())
      .then((data) => { if (data.status === "ok") setHw(data); })
      .catch(() => {});
  }, [refreshModels]);

  // Detect which engines are actually available — only those get tabs.
  // Defaults to the currently configured backend.
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/marketplace/engines`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/api/settings`).then((r) => r.json()).catch(() => ({})),
    ]).then(([engData, settingsData]) => {
      const avail = (engData.engines || []).filter((e) => e.available);
      setEngines(avail);
      const configured = settingsData.llm_backend || "ollama";
      setActiveEngine(avail.find((e) => e.id === configured)?.id || avail[0]?.id || null);
    });
  }, []);

  // Load the full Ollama library catalog when the Ollama tab opens
  useEffect(() => {
    if (activeEngine !== "ollama" || library.length > 0 || libraryLoading) return;
    setLibraryLoading(true);
    fetch(`${API_BASE}/api/marketplace/ollama-library`)
      .then((r) => r.json())
      .then((data) => {
        const models = (data.models || []).map((m) => ({
          key: m.name,
          family: familyOf(m.name) || undefined,
          name: m.name,
          params: "",
          sizeGb: m.size_bytes ? +(m.size_bytes / 1e9).toFixed(1) : 0,
          vramGb: m.size_bytes ? +((m.size_bytes / 1e9) * 1.15).toFixed(1) : 0,
          context: "",
          pulls: m.pulls_m || 0,
          updatedDays: m.updated_days ?? 30,
          license: "",
          tags: (m.capabilities || []).map((c) => ({ vision: "Vision", tools: "Tool-Calling", thinking: "Thinking", embedding: "Embedding" }[c] || c)),
          desc: m.desc || "Modell aus der Ollama Bibliothek.",
          lib: true,
        }));
        setLibrary(models);
      })
      .catch(() => {})
      .finally(() => setLibraryLoading(false));
  }, [activeEngine, library.length, libraryLoading]);

  // Load models served by the OpenAI-compatible server (LM Studio, …) when its tab opens
  useEffect(() => {
    if (activeEngine !== "openai_compatible" || openaiModels.length > 0 || openaiLoading) return;
    setOpenaiLoading(true);
    fetch(`${API_BASE}/api/marketplace/openai-models`)
      .then((r) => r.json())
      .then((data) => {
        setOpenaiModels((data.models || []).map((id) => ({
          key: id,
          family: familyOf(id) || undefined,
          name: id,
          params: "",
          sizeGb: 0,
          vramGb: 0,
          context: "",
          pulls: 0,
          updatedDays: null,
          tags: [],
          desc: "Bereitgestellt über den OpenAI-kompatiblen Server.",
          external: true,
        })));
      })
      .catch(() => {})
      .finally(() => setOpenaiLoading(false));
  }, [activeEngine, openaiModels.length, openaiLoading]);

  // Poll download status while active
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
        const data = await res.json();
        if (data.running) {
          wasRunningRef.current = true;
          setPull(data);
          return;
        }
        if (wasRunningRef.current) {
          wasRunningRef.current = false;
          setPull(null);
          if (data.error) {
            addToast({ type: "error", title: "Download fehlgeschlagen", message: `${data.model}: ${data.error}`, duration: 6000 });
          } else if (data.status_text === "done" || data.progress >= 1) {
            if (data.model) setJustInstalled((prev) => new Set(prev).add(data.model));
            addToast({ type: "success", title: "Download abgeschlossen", message: data.model || "", duration: 4000 });
          }
          await refreshModels();
          setJustInstalled(new Set()); // real models list is authoritative now
        }
      } catch {}
    };
    const iv = setInterval(poll, 600);
    return () => clearInterval(iv);
  }, [refreshModels, addToast]);

  const modelIdFor = (entry) => {
    if (entry.external) return entry.key;
    if (entry.lib) {
      const match = installedModels.find((m) => m.split(":")[0] === entry.key);
      return match || entry.key;
    }
    return configuredEngine === "llama_cpp" ? GGUF_FILENAMES[entry.key] : entry.key;
  };

  const isInstalled = (entry) => {
    if (entry.external) return true; // served by the external server
    if (justInstalled.has(entry.key) || justInstalled.has(modelIdFor(entry))) return true;
    if (entry.lib) return installedModels.some((m) => m.split(":")[0] === entry.key);
    const id = modelIdFor(entry);
    return configuredEngine === "llama_cpp"
      ? installedModels.includes(id)
      : installedModels.some((m) => m === entry.key || m.startsWith(entry.key));
  };

  const isActive = (entry) => {
    if (entry.external) return configuredEngine === "openai_compatible" && currentModel === entry.key;
    const id = modelIdFor(entry);
    if (currentModel === id) return true;
    return configuredEngine === "ollama" && currentModel && currentModel.startsWith(entry.key);
  };

  // Hardware fit: "gpu" = fits in VRAM, "hybrid" = split between GPU + system RAM
  // (layer offloading), "cpu" = runs via RAM only (slower), "big" = won't run well
  const fitFor = useCallback((entry) => {
    if (!hw || entry.external) return "unknown";
    const vramGb = hw.mode === "gpu" && hw.vram_mb > 0 ? hw.vram_mb / 1024 : 0;
    const ramGb = hw.ram_gb || 0;
    if (vramGb >= entry.vramGb) return "gpu";
    // llama.cpp / Ollama offload layers to RAM — model must fit in combined memory
    if (ramGb > 0 && entry.sizeGb <= (ramGb + vramGb) * 0.75) return "hybrid";
    if (ramGb > 0 && entry.sizeGb <= ramGb * 0.7) return "cpu";
    return "big";
  }, [hw]);

  // Per-model disk details (real size, install time) from /api/models
  const detailFor = (entry) => {
    const id = modelIdFor(entry);
    const found = Object.entries(modelDetails).find(([name]) => {
      const l = id.toLowerCase();
      const k = name.toLowerCase();
      return k === l || k.startsWith(l) || l.startsWith(k);
    });
    return found ? found[1] : null;
  };

  // Update available: upstream catalog was refreshed after the local install
  const updateAvailable = (entry) => {
    const det = detailFor(entry);
    if (!det?.modified_at) return false;
    const ts = new Date(det.modified_at).getTime();
    if (!ts || Number.isNaN(ts)) return false;
    const installedAgeDays = (Date.now() - ts) / 86400000;
    return entry.updatedDays + 2 < installedAgeDays;
  };

  const realSizeFor = (entry) => detailFor(entry)?.size_bytes || 0;

  const startDownload = async (entry) => {
    const endpoint = entry.lib || configuredEngine !== "llama_cpp" ? "/api/onboarding/pull-ollama-model" : "/api/onboarding/pull-gguf-model";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: entry.key }),
      });
      const data = await res.json();
      if (data.status === "started") {
        setPull({ model: entry.key, progress: 0, completed: 0, total: 0, speed: 0, paused: false, status_text: "downloading", queue: [] });
        wasRunningRef.current = true;
      } else if (data.status === "queued") {
        addToast({ type: "info", title: "AI Marketplace", message: `${entry.name} zur Warteschlange hinzugefügt (Position ${data.position})` });
      } else if (data.status === "error") {
        addToast({ type: "error", title: "AI Marketplace", message: data.error || "Download nicht möglich" });
      }
    } catch (err) {
      addToast({ type: "error", title: "AI Marketplace", message: "Download konnte nicht gestartet werden", detail: String(err) });
    }
  };

  const deleteModel = async (entry) => {
    const id = modelIdFor(entry);
    try {
      const res = await fetch(`${API_BASE}/api/models/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        addToast({ type: "success", title: "AI Marketplace", message: `${entry.name} gelöscht`, duration: 3000 });
        setDetail(null);
        await refreshModels();
      } else {
        addToast({ type: "error", title: "AI Marketplace", message: data.error || "Löschen fehlgeschlagen" });
      }
    } catch (err) {
      addToast({ type: "error", title: "AI Marketplace", message: "Löschen fehlgeschlagen", detail: String(err) });
    }
  };

  const activate = async (entry) => {
    const id = modelIdFor(entry);
    try {
      const body = { ollama_model: id };
      if (entry.external) body.llm_backend = "openai_compatible";
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setCurrentModel(id);
      if (entry.external) setConfiguredEngine("openai_compatible");
      addToast({ type: "success", title: "AI Marketplace", message: `${entry.name} ist jetzt aktiv`, duration: 3000 });
    } catch {}
  };

  const cancelDownload = async () => {
    try { await fetch(`${API_BASE}/api/onboarding/pull-cancel`, { method: "POST" }); } catch {}
  };

  const togglePause = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/pull-pause`, { method: "POST" });
      const data = await res.json();
      setPull((prev) => (prev ? { ...prev, paused: !!data.paused } : prev));
    } catch {}
  };

  // ── Recommendations: VRAM-tier picks from the shared model table ──
  const vramMb = hw?.vram_mb || 0;
  const tier = hw ? getVramTier(vramMb) : null;
  const recSubtitle = hw
    ? hw.mode === "gpu" && vramMb > 0
      ? `Abgestimmt auf deine GPU mit ${Math.round(vramMb / 1024)} GB VRAM`
      : "CPU-Modus – kompakte Modelle werden empfohlen"
    : null;

  // ── Per-engine catalog + collections ──
  const activeEngineDef = engines.find((e) => e.id === activeEngine) || null;
  const platformLabel = activeEngineDef?.platform || "";
  const activeCatalog =
    activeEngine === "ollama" ? library
    : activeEngine === "openai_compatible" ? openaiModels
    : MARKET_CATALOG;
  const collectionsFor =
    activeEngine === "ollama" ? OLLAMA_COLLECTIONS
    : activeEngine === "llama_cpp" ? COLLECTIONS
    : [];

  // Recommendations resolved against the active engine's catalog.
  // For Ollama the tier's exact model tag is installed (e.g. "qwen3.5:9b").
  const enginePicks = (tier ? PICK_MODES.map((m) => ({ ...m, pick: tier.modes[m.key] })).filter((p) => p.pick) : [])
    .map((p) => {
      if (activeEngine === "llama_cpp") {
        const entry = MARKET_CATALOG.find((e) => e.key === p.pick.model);
        return entry ? { ...p, entry, installKey: entry.key } : null;
      }
      if (activeEngine === "ollama") {
        const famKey = p.pick.model.split(":")[0];
        const entry = library.find((e) => e.key === famKey);
        return entry ? { ...p, entry, installKey: p.pick.model } : null;
      }
      return null;
    })
    .filter(Boolean);

  // ── Filtering + sorting ──
  const filtered = activeCatalog.filter((entry) => {
    const col = collectionsFor.find((c) => c.id === collection);
    if (col) {
      if (col.hwOnly) {
        if (!hw) return false;
        const fit = fitFor(entry);
        if (fit !== "gpu" && fit !== "hybrid" && fit !== "cpu") return false;
      } else if (!col.match(entry)) {
        return false;
      }
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      return entry.name.toLowerCase().includes(q) || (entry.family || "").toLowerCase().includes(q) || (entry.tags || []).some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "neu") return (a.updatedDays ?? 9999) - (b.updatedDays ?? 9999);
    if (sortBy === "groesse") return a.sizeGb - b.sizeGb;
    return b.pulls - a.pulls;
  });
  const installedCount = activeCatalog.filter(isInstalled).length;
  const pullEntry = pull ? [...MARKET_CATALOG, ...library].find((e) => e.key === pull.model) : null;

  const FitBadge = ({ entry }) => {
    const fit = fitFor(entry);
    if (fit === "unknown") return null;
    const s = FIT_STYLES[fit];
    return (
      <span className={`flex items-center gap-1.5 text-[10px] font-medium ${s.text}`} title={s.label}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
    );
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      {/* Hero header */}
      <div className="relative shrink-0 overflow-hidden border-b border-nox-border">
        <div className="absolute inset-0 bg-gradient-to-r from-nox-accent/15 via-transparent to-nox-glow3/15" />
        <div className="absolute -top-16 -left-10 w-56 h-56 rounded-full bg-nox-accent/20 blur-3xl" />
        <div className="absolute -bottom-20 right-10 w-64 h-64 rounded-full bg-nox-glow3/15 blur-3xl" />
        <div className="relative px-6 pt-5 pb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-nox-accent to-nox-glow3 flex items-center justify-center shadow-lg shadow-nox-shadow-accent">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </span>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-nox-text via-nox-text to-nox-accent bg-clip-text text-transparent">AI Marketplace</h1>
            </div>
            <p className="text-sm text-nox-textDim mt-1.5">
              Entdecke und installiere lokale KI-Modelle – frei, privat, offline fähig.
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-nox-phosphor/10 text-nox-phosphor border border-nox-phosphor/20 font-medium">
                {installedCount} installiert
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-nox-surface text-nox-textDim border border-nox-border font-medium">
                {activeCatalog.length - installedCount} verfügbar
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-nox-accent/10 text-nox-accent border border-nox-accent/20 font-medium">
                {activeEngineDef?.name || "…"}
              </span>
              {hw && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-nox-surface text-nox-textDim border border-nox-border font-medium" title={hw.gpu_name || ""}>
                  {hw.mode === "gpu" && vramMb > 0 ? `${Math.round(vramMb / 1024)} GB VRAM` : "CPU-Modus"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors shrink-0"
            title="Schließen"
          >
            <IconX size={18} />
          </button>
        </div>
      </div>

      {/* Recommendations — resolved against the active engine */}
      {enginePicks.length > 0 && (
        <div className="shrink-0 px-6 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-nox-accent"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            <span className="text-sm font-semibold text-nox-text">Empfohlen für dich</span>
            <span className="text-[11px] text-nox-textDim">{recSubtitle}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {enginePicks.map(({ key, label, icon, pick, entry, installKey }) => {
              const pickEntry = { ...entry, key: installKey };
              const downloading = pull && (pull.model === installKey || pull.model === modelIdFor(pickEntry));
              return (
                <div
                  key={key}
                  className="relative rounded-2xl p-[1px] overflow-hidden"
                  style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--nox-accent) 60%, transparent), transparent 60%)" }}
                >
                  <div className="rounded-2xl bg-nox-surface-raised/95 backdrop-blur-xl p-3.5 h-full flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-nox-accent">
                        {icon} {label}
                      </span>
                      <span className="text-[10px] text-nox-textDim tabular-nums">{pick.size}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <FamilyLogo family={entry.family} name={entry.key} size={36} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-nox-text truncate">{pick.label}</div>
                        <FitBadge entry={pickEntry} />
                      </div>
                    </div>
                    <p className="text-[11px] text-nox-textDim leading-snug">{pick.desc}</p>
                    <div className="mt-auto flex justify-end">
                      {downloading ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-nox-accent">
                          <IconSpinner size={12} className="animate-spin" /> Lädt…
                        </span>
                      ) : isInstalled(pickEntry) ? (
                        isActive(pickEntry) ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-nox-accent font-medium px-3 py-1 rounded-lg bg-nox-accent/10">
                            <IconCheck size={11} /> Aktiv
                          </span>
                        ) : (
                          <button
                            onClick={() => activate(pickEntry)}
                            className="text-[11px] px-3 py-1 rounded-lg font-medium nox-btn-secondary"
                          >
                            Aktivieren
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => startDownload(pickEntry)}
                          className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-lg font-medium nox-btn-primary"
                        >
                          <IconArrowDown size={12} weight={2.5} /> Installieren
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + engine tabs + collections + sort */}
      <div className={`shrink-0 px-6 py-3 flex items-center gap-2 flex-wrap border-b border-nox-border bg-nox-surface/20 ${enginePicks.length > 0 ? "mt-4" : ""}`}>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-nox-surface border border-nox-border">
          {engines.map((e) => (
            <button
              key={e.id}
              onClick={() => { setActiveEngine(e.id); setCollection("alle"); }}
              title={ENGINE_HINTS[e.id] || ""}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                activeEngine === e.id ? "bg-nox-accent/15 text-nox-accent" : "text-nox-textDim hover:text-nox-text"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-40 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-nox-textDim" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Modelle durchsuchen…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-nox-bgSolid text-sm text-nox-text placeholder-nox-textDim border border-nox-border focus:border-nox-accent outline-none"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-nox-surface border border-nox-border">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSortBy(s.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                sortBy === s.id ? "bg-nox-accent/15 text-nox-accent" : "text-nox-textDim hover:text-nox-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {collectionsFor.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap basis-full">
            {collectionsFor.filter((c) => !c.hwOnly || hw).map((col) => (
              <button
                key={col.id}
                onClick={() => setCollection(col.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  collection === col.id
                    ? "border-nox-accent bg-nox-accent/10 text-nox-accent"
                    : "border-nox-border text-nox-textDim hover:text-nox-text hover:bg-nox-surface"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        )}
        {activeEngine && ENGINE_HINTS[activeEngine] && (
          <span className="text-[11px] text-nox-textDim basis-full">
            {ENGINE_HINTS[activeEngine]}
          </span>
        )}
      </div>

      {/* Active download banner */}
      {pull && (
        <div className="shrink-0 mx-6 mt-3 rounded-xl border border-nox-accent/40 bg-nox-accent/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <IconSpinner size={14} className="text-nox-accent animate-spin shrink-0" />
              <span className="text-sm font-medium text-nox-text truncate">{pullEntry?.name || pull.model}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium shrink-0">
                {pull.paused ? "Pausiert" : "Wird heruntergeladen"}
              </span>
              {pull.queue?.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-surface text-nox-textDim border border-nox-border font-medium shrink-0">
                  +{pull.queue.length} in Warteschlange
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={togglePause} className="px-2.5 py-1 rounded-lg text-xs text-nox-text hover:bg-nox-surface-hover border border-nox-border transition-colors">
                {pull.paused ? "Fortsetzen" : "Pause"}
              </button>
              <button onClick={cancelDownload} title="Download abbrechen" className="flex items-center justify-center w-7 h-7 rounded-lg text-nox-textDim hover:text-nox-red hover:bg-nox-surface-hover transition-all">
                <IconX size={14} />
              </button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-nox-border/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-nox-accent to-nox-glow3 transition-all duration-300"
              style={{ width: `${Math.round((pull.progress || 0) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-nox-textDim tabular-nums">
            <span>{formatGb(pull.completed)}{pull.total ? ` / ${formatGb(pull.total)}` : ""} · {Math.round((pull.progress || 0) * 100)}%</span>
            {!pull.paused && pull.speed > 0 && <span>{formatSpeed(pull.speed)}</span>}
          </div>
        </div>
      )}

      {/* Model grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
        {(activeEngine === "ollama" && libraryLoading) || (activeEngine === "openai_compatible" && openaiLoading) ? (
          <div className="flex items-center justify-center gap-2 text-sm text-nox-textDim py-16">
            <IconSpinner size={16} className="animate-spin" /> Lade Katalog…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-sm text-nox-textDim py-16">
            {activeEngine === "openai_compatible"
              ? "Keine Modelle auf dem Server geladen."
              : "Keine Modelle gefunden."}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sorted.map((entry) => {
              const installed = isInstalled(entry);
              const active = isActive(entry);
              const downloading = pull && (pull.model === entry.key || pull.model === modelIdFor(entry));
              return (
                <div
                  key={entry.key}
                  onClick={() => setDetail(entry)}
                  className={`group relative rounded-2xl border p-4 transition-all overflow-hidden cursor-pointer ${
                    active
                      ? "border-nox-accent/60 bg-nox-accent/5 shadow-lg shadow-nox-shadow-accent/10"
                      : "border-nox-border bg-nox-surface/40 hover:border-nox-borderHover hover:bg-nox-surface-hover/40 hover:-translate-y-0.5"
                  }`}
                >
                  {/* Hover glow — curated entries carry a family gradient */}
                  {entry.gradient && (
                    <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${entry.gradient} opacity-0 group-hover:opacity-15 blur-2xl transition-opacity`} />
                  )}
                  <div className="relative flex items-start gap-3">
                    {/* Family logo */}
                    <FamilyLogo family={entry.family} name={entry.key} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-nox-text">{entry.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-border/50 text-nox-textDim font-medium">{entry.params}</span>
                        {updateAvailable(entry) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-amber/15 text-nox-amber font-medium">Update</span>
                        )}
                        {active && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium">
                            <IconCheck size={10} /> Aktiv
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-nox-textDim mt-1 leading-relaxed">{entry.desc}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {(entry.tags || []).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-nox-accent/10 text-nox-accent font-medium">{t}</span>
                        ))}
                      </div>
                      {/* Meta row: platform, fit, size, context, popularity, freshness */}
                      <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px] text-nox-textDim">
                        {platformLabel && (
                          <span className="px-1.5 py-0.5 rounded bg-nox-surface border border-nox-border font-medium" title="Plattform / Engine">
                            {platformLabel}
                          </span>
                        )}
                        <FitBadge entry={entry} />
                        <span className="tabular-nums">{realSizeFor(entry) ? formatGb(realSizeFor(entry)) : entry.sizeGb ? `~${entry.sizeGb} GB` : ""}</span>
                        {entry.context && <span className="tabular-nums">{entry.context} Kontext</span>}
                        {!entry.external && <span className="tabular-nums" title="Downloads">{formatPulls(entry.pulls)} Downloads</span>}
                        {!entry.external && <span title="Zuletzt aktualisiert">{formatUpdated(entry.updatedDays)}</span>}
                      </div>
                    </div>
                  </div>
                  {/* Action row */}
                  <div className="relative mt-3 flex justify-end" onClick={(e) => e.stopPropagation()}>
                    {installed ? (
                      active ? (
                        <span className="flex items-center gap-1.5 text-xs text-nox-accent font-medium px-3 py-1.5 rounded-lg bg-nox-accent/10">
                          <IconCheck size={13} /> Aktiv
                        </span>
                      ) : (
                        <button
                          onClick={() => activate(entry)}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-medium nox-btn-secondary"
                        >
                          {entry.external ? "Verwenden" : "Aktivieren"}
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => startDownload(entry)}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold nox-btn-primary"
                      >
                        <IconArrowDown size={14} weight={2.5} /> {downloading ? "Lädt…" : "Installieren"}
                      </button>
                    )}
                  </div>
                  {/* Thin progress line while downloading */}
                  {downloading && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nox-border/40">
                      <div
                        className="h-full bg-gradient-to-r from-nox-accent to-nox-glow3 transition-all duration-300"
                        style={{ width: `${Math.round((pull.progress || 0) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Model detail modal */}
      {detail && (
        <ModelDetailModal
          entry={detail}
          fit={fitFor(detail)}
          engine={engine}
          installed={isInstalled(detail)}
          active={isActive(detail)}
          downloading={!!pull && (pull.model === detail.key || pull.model === modelIdFor(detail))}
          updateAvailable={updateAvailable(detail)}
          realSizeBytes={realSizeFor(detail)}
          onInstall={() => startDownload(detail)}
          onActivate={() => activate(detail)}
          onDelete={() => deleteModel(detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
