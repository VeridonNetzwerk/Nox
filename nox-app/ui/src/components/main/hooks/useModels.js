import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../../../shared/constants.jsx";
import { GGUF_FILENAMES, prettyModelName } from "../../../shared/prettyNames.jsx";
import { MODEL_TABLE } from "../../../shared/modelTable.js";
import { MODE_KEYS } from "../constants.js";

export function useModels(addToast) {
  const [availableModels, setAvailableModels] = useState([]);
  const [currentModel, setCurrentModel] = useState("");
  const [currentModelMode, setCurrentModelMode] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [pullState, setPullState] = useState({ running: false, model: "", progress: 0 });

  const modelsBackendTypeRef = useRef("");
  const modelInitRef = useRef(false);
  const pullPollRef = useRef(null);
  const modelDropdownRef = useRef(null);

  const MODE_LABELS = {
    superschnell: "Superschnell",
    schnell: "Schnell",
    balance: "Balance",
    qualitaet: "Qualität",
  };

  const getRecommendedModels = useCallback(() => {
    const vram = gpuInfo?.vram_mb || 0;
    const tier = MODEL_TABLE.find(t => vram >= t.range[0] && vram < t.range[1]) || MODEL_TABLE[0];
    return MODE_KEYS.map(key => ({
      modeKey: key,
      ...tier.modes[key],
    }));
  }, [gpuInfo?.vram_mb]);

  const applyModels = useCallback((list, backendType) => {
    if (backendType) {
      modelsBackendTypeRef.current = backendType;
    }
    const bt = backendType || modelsBackendTypeRef.current;
    const all = list || [];
    setAvailableModels(
      bt === "llama_cpp" ? all.filter(m => m.endsWith(".gguf"))
        : bt === "ollama" ? all.filter(m => !m.endsWith(".gguf"))
        : all
    );
  }, []);

  const isModelInstalled = (model) =>
    availableModels.some(m => m === model || m.startsWith(model));

  const engineModelId = (key) =>
    modelsBackendTypeRef.current === "llama_cpp" ? (GGUF_FILENAMES[key] || key) : key;

  const handleModelSwitch = async (model, modeKey) => {
    try {
      const body = { ollama_model: model };
      if (modeKey) body.ollama_model_mode = modeKey;
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setCurrentModel(model);
      if (modeKey) setCurrentModelMode(modeKey);
      setModelDropdownOpen(false);
    } catch (err) {
      addToast({ type: "warning", title: "Modell", message: "Modell konnte nicht gewechselt werden", duration: 4000 });
    }
  };

  const handleModelPull = async (model) => {
    if (pullState.running) return;
    const isLlama = modelsBackendTypeRef.current === "llama_cpp";
    const pullId = isLlama ? (GGUF_FILENAMES[model] || model) : model;
    setPullState({ running: true, model: pullId, progress: 0 });
    try {
      await fetch(`${API_BASE}/api/onboarding/${isLlama ? "pull-gguf-model" : "pull-ollama-model"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: pullId }),
      });
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
          const data = await res.json();
          setPullState({ running: data.running, model: data.model || pullId, progress: data.progress || 0 });
          if (data.running) {
            pullPollRef.current = setTimeout(poll, 1000);
          } else {
            const modelsRes = await fetch(`${API_BASE}/api/models`);
            const modelsData = await modelsRes.json();
            applyModels(modelsData.available_models || [], modelsData.backend_type);
            setPullState({ running: false, model: "", progress: 0 });
          }
        } catch {
          pullPollRef.current = setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setPullState({ running: false, model: "", progress: 0 });
      addToast({ type: "warning", title: "Download", message: "Modell konnte nicht heruntergeladen werden", duration: 4000 });
    }
  };

  // Fetch available models + GPU info
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models`);
        const data = await res.json();
        if (data.available_models) applyModels(data.available_models, data.backend_type);
        if (data.current_model && !modelInitRef.current) {
          setCurrentModel(data.current_model);
          modelInitRef.current = true;
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      }
    };
    fetchModels();
    const interval = setInterval(fetchModels, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch GPU info once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/gpu-check`);
        setGpuInfo(await res.json());
      } catch {}
    })();
  }, []);

  // Fetch current model mode from settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (data.status === "ok" && data.settings?.ollama_model_mode) {
          setCurrentModelMode(data.settings.ollama_model_mode);
        }
      } catch {}
    };
    fetchSettings();
  }, []);

  // Cleanup pull poll on unmount
  useEffect(() => {
    return () => {
      if (pullPollRef.current) clearTimeout(pullPollRef.current);
    };
  }, []);

  return {
    availableModels,
    currentModel,
    setCurrentModel,
    currentModelMode,
    setCurrentModelMode,
    modelDropdownOpen,
    setModelDropdownOpen,
    showAllModels,
    setShowAllModels,
    gpuInfo,
    pullState,
    modelDropdownRef,
    modelsBackendTypeRef,
    MODE_LABELS,
    getRecommendedModels,
    isModelInstalled,
    engineModelId,
    handleModelSwitch,
    handleModelPull,
  };
}
