import React, { useState, useEffect, useRef, useCallback } from "react";
import NoxAvatar from "./NoxAvatar.jsx";
import { API_BASE } from "../../shared/constants.jsx";

const IconCheck = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const IconX = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const IconAlert = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const IconSpinner = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="nox-loading-spinner"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
);

const STEPS = [
  { key: "backend", label: "Backend", pct: 20 },
  { key: "llm", label: "KI-Modell", pct: 45 },
  { key: "voice", label: "Sprachpipeline", pct: 70 },
  { key: "eye", label: "Kontext-Erfassung", pct: 85 },
  { key: "connect", label: "Verbindung", pct: 100 },
];

export default function LoadingScreen({ backendReady }) {
  const [displayPct, setDisplayPct] = useState(0);
  const [targetPct, setTargetPct] = useState(0);
  const [statusText, setStatusText] = useState("Warte auf Backend…");
  const [checks, setChecks] = useState({});
  const [errors, setErrors] = useState([]);
  const [backendReachable, setBackendReachable] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const pollRef = useRef(null);
  const elapsedRef = useRef(0);
  const reachableRef = useRef(false);
  const stoppedRef = useRef(false);

  // Track elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      elapsedRef.current = sec;
      setElapsed(sec);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll backend health — stable ref, no deps that change every second
  const pollBackend = useCallback(async () => {
    if (stoppedRef.current) return;

    // Step 1: Check if backend process is alive
    if (!reachableRef.current) {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          reachableRef.current = true;
          setBackendReachable(true);
          setStatusText("Backend erreichbar – initialisiere Komponenten…");
        }
      } catch {
        setStatusText(`Warte auf Backend… (${elapsedRef.current}s)`);
      }
      pollRef.current = setTimeout(pollBackend, 1000);
      return;
    }

    // Step 2: Backend is alive — fetch real component status
    let newChecks = {};
    let newErrors = [];
    let pct = 20;
    let text = "Initialisiere Komponenten…";

    try {
      const [statusRes, ollamaRes, voiceRes, eyeRes] = await Promise.all([
        fetch(`${API_BASE}/api/status`),
        fetch(`${API_BASE}/health/ollama`),
        fetch(`${API_BASE}/health/voice`),
        fetch(`${API_BASE}/health/eye`),
      ]);

      const statusData = await statusRes.json();
      const ollamaData = await ollamaRes.json();
      const voiceData = await voiceRes.json();
      const eyeData = await eyeRes.json();

      // LLM backend check
      const llmOk = ollamaData.status === "ok";
      newChecks.llm = llmOk ? "ok" : "error";
      if (!llmOk && ollamaData.error) {
        newErrors.push({ component: "KI-Modell", message: ollamaData.error });
      }
      pct = llmOk ? 45 : 20;
      text = llmOk ? `KI-Modell: ${ollamaData.backend_type || "ok"}` : "KI-Modell nicht verfügbar";

      // Voice pipeline check
      const voiceOk = voiceData.available !== false;
      newChecks.voice = voiceOk ? "ok" : "warning";
      if (!voiceOk && voiceData.reason) {
        newErrors.push({ component: "Sprachpipeline", message: voiceData.reason, severity: "warning" });
      }
      pct = voiceOk ? 70 : pct;

      // Eye/context check
      const eyeOk = eyeData.available !== false;
      newChecks.eye = eyeOk ? "ok" : "warning";
      if (!eyeOk && eyeData.reason) {
        newErrors.push({ component: "Kontext-Erfassung", message: eyeData.reason, severity: "warning" });
      }
      pct = eyeOk ? 85 : pct;

      // Microphone check
      const micOk = statusData?.microphone?.available === true;
      newChecks.mic = micOk ? "ok" : "warning";
      if (!micOk) {
        newErrors.push({ component: "Mikrofon", message: "Kein Mikrofon erkannt – Spracheingabe deaktiviert", severity: "warning" });
      }

      // Wake word check
      const wakeOk = statusData?.wake_word?.model_exists === true;
      newChecks.wake = wakeOk ? "ok" : "warning";
      if (!wakeOk) {
        newErrors.push({ component: "Wake Word", message: "Kein Wake-Word-Modell gefunden – Sprachaktivierung deaktiviert", severity: "warning" });
      }

      // If LLM is ok, we're essentially ready for WebSocket
      if (llmOk) {
        pct = 90;
        text = "Verbinde WebSocket…";
        newChecks.connect = "pending";
      }

      setChecks(newChecks);
      setErrors(newErrors);
      setTargetPct(pct);
      setStatusText(text);
    } catch (err) {
      setTargetPct(20);
      setStatusText("Komponenten-Status konnte nicht abgerufen werden");
      setErrors([{ component: "Backend", message: `Status-Abfrage fehlgeschlagen: ${err.message}` }]);
    }

    if (!stoppedRef.current) {
      pollRef.current = setTimeout(pollBackend, 2000);
    }
  }, []);

  useEffect(() => {
    if (backendReady) {
      stoppedRef.current = true;
      setTargetPct(100);
      setStatusText("Bereit");
      setChecks((prev) => ({ ...prev, connect: "ok" }));
      if (pollRef.current) clearTimeout(pollRef.current);
      return;
    }
    stoppedRef.current = false;
    pollBackend();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [backendReady, pollBackend]);

  // Smooth animate displayed percentage
  useEffect(() => {
    const animate = () => {
      setDisplayPct((prev) => {
        const diff = targetPct - prev;
        if (Math.abs(diff) < 0.5) return targetPct;
        return prev + diff * 0.06;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [targetPct]);

  const pct = Math.round(displayPct);
  const hasErrors = errors.filter(e => e.severity !== "warning").length > 0;
  const hasWarnings = errors.some(e => e.severity === "warning");

  const renderCheckIcon = (status) => {
    if (status === "ok") return <IconCheck size={14} />;
    if (status === "error") return <IconX size={14} />;
    if (status === "warning") return <IconAlert size={14} />;
    if (status === "pending") return <IconSpinner size={14} />;
    return null;
  };

  const checkColor = (status) => {
    if (status === "ok") return "#5bb97c";
    if (status === "error") return "#f28b82";
    if (status === "warning") return "#f29800";
    return "rgba(255,255,255,0.4)";
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: "radial-gradient(ellipse at center, #1a1525 0%, #0d0a14 100%)",
      }}
    >
      {/* Logo with glow */}
      <div className="flex flex-col items-center gap-8 mb-12">
        <NoxAvatar
          size={128}
          glowing
        />
      </div>

      {/* Progress bar */}
      <div className="w-72 space-y-3">
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden backdrop-blur-sm">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: hasErrors
                ? "linear-gradient(90deg, #f28b82, #f29800)"
                : "linear-gradient(90deg, #e930f0, #8b2df5, #2b6cf0, #1fe0e0)",
              boxShadow: hasErrors
                ? "0 0 10px rgba(242, 139, 130, 0.5)"
                : "0 0 12px rgba(139, 45, 245, 0.5)",
            }}
          />
        </div>

        {/* Status text + percentage */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40 font-medium tracking-wide truncate max-w-[200px]">
            {statusText}
          </span>
          <span className="text-xs text-white/60 font-mono tabular-nums shrink-0">
            {pct}%
          </span>
        </div>
      </div>

      {/* Component checks — real status indicators */}
      <div className="mt-8 w-72 space-y-1.5">
        {STEPS.map((step) => {
          const status = checks[step.key];
          return (
            <div key={step.key} className="flex items-center gap-2.5 text-xs backdrop-blur-sm">
              <span
                className="shrink-0 flex items-center justify-center w-4 h-4"
                style={{ color: checkColor(status) }}
              >
                {renderCheckIcon(status)}
              </span>
              <span className="text-white/50 font-medium">{step.label}</span>
              {status === "error" && (
                <span className="text-white/30 ml-auto text-[10px]">Fehler</span>
              )}
              {status === "warning" && (
                <span className="text-white/30 ml-auto text-[10px]">Eingeschränkt</span>
              )}
              {status === "ok" && (
                <span className="text-white/30 ml-auto text-[10px]">OK</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Visual error messages */}
      {errors.length > 0 && (
        <div className="mt-6 w-72 space-y-2">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-xs backdrop-blur-sm"
              style={{
                background: err.severity === "warning"
                  ? "rgba(242, 152, 0, 0.08)"
                  : "rgba(242, 139, 130, 0.08)",
                border: `1px solid ${err.severity === "warning"
                  ? "rgba(242, 152, 0, 0.2)"
                  : "rgba(242, 139, 130, 0.2)"}`,
              }}
            >
              <span
                className="shrink-0 mt-0.5"
                style={{ color: err.severity === "warning" ? "#f29800" : "#f28b82" }}
              >
                {err.severity === "warning" ? <IconAlert size={14} /> : <IconX size={14} />}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-white/80">{err.component}</div>
                <div className="text-white/50 mt-0.5 break-words">{err.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Elapsed time + retry hint */}
      <div className="mt-6 flex items-center gap-4 text-[10px] text-white/25">
        <span>{elapsed}s</span>
        {!backendReachable && elapsed > 10 && (
          <span>• Stelle sicher, dass das Backend läuft (Port 8420)</span>
        )}
      </div>

      <style>{`
        @keyframes nox-loading-spin {
          to { transform: rotate(360deg); }
        }
        .nox-loading-spinner {
          animation: nox-loading-spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
