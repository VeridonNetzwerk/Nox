import React, { useState, useEffect, useCallback, useRef } from "react";
import noxLogoGlowing from "../assets/nox-logo-glowing.png";

const API_BASE = "http://127.0.0.1:8420";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

function OnboardingWizard({ locale, onComplete }) {
  const s = locale.onboarding || {};
  const [step, setStep] = useState(0);
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

  // Ollama install state
  const [ollamaInstallPhase, setOllamaInstallPhase] = useState("idle");
  const [ollamaInstallProgress, setOllamaInstallProgress] = useState(0);
  const [ollamaInstallError, setOllamaInstallError] = useState(null);

  // Model pull state
  const [pullProgress, setPullProgress] = useState(0);
  const [pullRunning, setPullRunning] = useState(false);
  const [pullError, setPullError] = useState(null);
  const [pullModel, setPullModel] = useState("");

  // Model download state (Whisper/Piper)
  const [dlProgress, setDlProgress] = useState(0);
  const [dlRunning, setDlRunning] = useState(false);
  const [dlError, setDlError] = useState(null);
  const [dlType, setDlType] = useState("");
  const [dlComplete, setDlComplete] = useState(false);

  const pollRef = useRef(null);
  const wsRef = useRef(null);
  const wakeTestActiveRef = useRef(false);

  const steps = [
    s.welcome || "Willkommen",
    s.modelSelect || "Modell wählen",
    s.audioDevices || "Audio-Geräte",
    s.wakeCalibration || "Wake-Word-Kalibrierung",
    s.done || "Fertig",
  ];

  // WebSocket listener for wake_detected events during onboarding
  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8420/ws/chat");
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "voice_event" && data.state === "wake_detected") {
          setWakeAttempts((prev) => prev + 1);
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, []);

  // Start/stop wake word test when entering/leaving step 3
  useEffect(() => {
    if (step === 3 && wakeOk) {
      // Start wake word test
      fetch(`${API_BASE}/api/onboarding/test-wake-word`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_device: selectedInput }),
      }).then(() => {
        wakeTestActiveRef.current = true;
      }).catch((err) => console.error("Failed to start wake word test:", err));
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
      }
      try {
        const gpuRes = await fetch(`${API_BASE}/api/onboarding/gpu-check`);
        setGpuInfo(await gpuRes.json());
      } catch (err) {
        console.error("GPU check failed:", err);
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
      }
    };
    fetchAudioDevices();
  }, []);

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

  const startModelDownload = async (type, url, filename) => {
    setDlType(type);
    setDlProgress(0);
    setDlRunning(true);
    setDlError(null);
    setDlComplete(false);
    try {
      await fetch(`${API_BASE}/api/onboarding/download-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, url, filename }),
      });
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/download-status`);
          const data = await res.json();
          setDlProgress(data.progress || 0);
          if (data.running) {
            pollRef.current = setTimeout(poll, 1000);
          } else {
            setDlRunning(false);
            if (data.error) {
              setDlError(data.error);
            } else {
              setDlComplete(true);
            }
          }
        } catch {
          pollRef.current = setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setDlError(String(err));
      setDlRunning(false);
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
    }
  };

  const next = () => {
    if (step === 1) saveModel();
    if (step === 2) saveAudioDevices();
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const prev = () => setStep((p) => Math.max(p - 1, 0));

  const btnClass =
    "px-4 py-2 rounded-lg text-sm font-medium transition-colors";
  const btnPrimary = btnClass + " bg-nox-accent hover:bg-nox-accentHover text-white";
  const btnSecondary = btnClass + " bg-nox-surface hover:bg-nox-border text-nox-text";
  const btnDisabled = btnClass + " bg-nox-border text-nox-textDim cursor-not-allowed";

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-nox-border">
        <div className="flex items-center gap-2">
          <img src={noxLogoGlowing} alt="Nox" className="w-5 h-5 rounded-full" />
          <h2 className="text-sm font-semibold text-nox-text">{s.title || "Nox einrichten"}</h2>
        </div>
        <span className="text-xs text-nox-textDim">
          {step + 1} / {steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-nox-border">
        <div
          className="h-full bg-nox-accent transition-all duration-300"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {/* Step 0: Welcome + Ollama check/install + GPU info */}
        {step === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <img src={noxLogoGlowing} alt="Nox" className="w-48 h-auto rounded-xl" />
            <h3 className="text-lg font-semibold text-nox-text">{s.welcomeTitle || "Willkommen bei Nox"}</h3>
            <p className="text-sm text-nox-textDim max-w-xs">
              {s.welcomeText || "Nox ist dein lokaler KI-Assistent. Lass uns ihn in wenigen Schritten einrichten."}
            </p>
            <div className="mt-4 space-y-3 w-full max-w-xs">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-nox-surface text-sm">
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
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-nox-surface text-sm">
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

        {/* Step 1: Model selection / pull */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.chooseModel || "KI-Modell wählen"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.modelHint || "Wähle das Ollama-Modell, das Nox verwenden soll."}
            </p>
            {models.length > 0 ? (
              <div className="space-y-1">
                {models.map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedModel(m)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      selectedModel === m
                        ? "bg-nox-accent text-white"
                        : "bg-nox-surface text-nox-text hover:bg-nox-border"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 rounded-lg bg-nox-surface space-y-3">
                <p className="text-sm text-nox-textDim">
                  {s.noModels || "Keine Modelle gefunden. Lade ein Modell herunter:"}
                </p>
                <div className="flex flex-col gap-2">
                  {["llama3.1", "qwen2.5", "mistral"].map((m) => (
                    <button
                      key={m}
                      onClick={() => startModelPull(m)}
                      disabled={pullRunning}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        pullRunning && pullModel === m
                          ? "bg-nox-accent/30 text-nox-textDim"
                          : "bg-nox-bg text-nox-text hover:bg-nox-border"
                      }`}
                    >
                      {pullRunning && pullModel === m
                        ? `Lade ${m}… ${Math.round(pullProgress * 100)}%`
                        : `ollama pull ${m}`}
                    </button>
                  ))}
                </div>
                {pullRunning && (
                  <div className="w-full h-2 rounded-full bg-nox-border overflow-hidden">
                    <div className="h-full bg-nox-accent transition-all duration-300 rounded-full" style={{ width: `${Math.round(pullProgress * 100)}%` }} />
                  </div>
                )}
                {pullError && (
                  <p className="text-xs text-red-400">
                    {s.pullFailed || "Download fehlgeschlagen:"} {pullError}
                  </p>
                )}
              </div>
            )}
            {/* Voice model info */}
            <div className="pt-2 border-t border-nox-border">
              <h4 className="text-xs font-medium text-nox-textDim uppercase tracking-wide mb-2">
                {s.voiceModels || "Voice-Modelle"}
              </h4>
              <p className="text-xs text-nox-textDim">
                {s.wakeWordBuiltin || "Wake-Word-Modell ist integriert (Hey Jarvis). Du kannst die Kalibrierung im nächsten Schritt testen."}
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Audio device selection */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.audioDevices || "Audio-Geräte wählen"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.audioDevicesHint || "Wähle welches Mikrofon und welche Lautsprecher Nox verwenden soll."}
            </p>
            <div className="space-y-3">
              <div className="px-3 py-3 rounded-lg bg-nox-surface space-y-2">
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
              <div className="px-3 py-3 rounded-lg bg-nox-surface space-y-2">
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

        {/* Step 3: Wake word calibration */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-nox-text">{s.wakeTitle || "Wake-Word-Kalibrierung"}</h3>
            <p className="text-sm text-nox-textDim">
              {s.wakeHint || "Sage 3× 'Hey Jarvis', um die Erkennung zu testen."}
            </p>
            <div className="px-3 py-4 rounded-lg bg-nox-surface">
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
                      {s.wakeSay || "Sage 'Hey Jarvis' in dein Mikrofon…"}
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

        {/* Step 4: Done */}
        {step === 4 && (
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
      <div className="flex items-center justify-between px-4 py-3 border-t border-nox-border">
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
            disabled={step === 0 && !ollamaOk}
            className={step === 0 && !ollamaOk ? btnDisabled : btnPrimary}
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
