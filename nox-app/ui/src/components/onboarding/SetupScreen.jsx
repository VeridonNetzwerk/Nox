import React, { useState, useEffect, useRef } from "react";
import noxLogoGlowing from "../../assets/nox-logo-glowing.png";

const BOOTSTRAP_URL = "http://127.0.0.1:8421";

function formatBytes(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function formatTime(s) {
  if (s <= 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}

export default function SetupScreen({ onComplete }) {
  const [phase, setPhase] = useState("checking"); // checking, idle, installing, done, error
  const [progress, setProgress] = useState(0);
  const [currentPkg, setCurrentPkg] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalPackages, setTotalPackages] = useState(0);
  const [speedMbs, setSpeedMbs] = useState(0);
  const [etaS, setEtaS] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);
  const [totalEstMb, setTotalEstMb] = useState(0);
  const [hasNvidia, setHasNvidia] = useState(false);
  const [gpuName, setGpuName] = useState("");
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState(null);
  const [postInstallTask, setPostInstallTask] = useState("");
  const pollRef = useRef(null);

  // Check status on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${BOOTSTRAP_URL}/api/bootstrap/status`);
        const data = await res.json();
        setHasNvidia(data.has_nvidia);
        setGpuName(data.gpu_name || "");
        if (data.deps_installed) {
          // Already installed — notify main.js and proceed
          window.nox?.depsInstalled?.();
          onComplete();
        } else if (data.installing) {
          // Installation already in progress — resume polling
          setPhase("installing");
          setProgress(data.progress);
          setCurrentPkg(data.current_package);
          setCurrentIndex(data.current_index);
          setTotalPackages(data.total_packages);
          setSpeedMbs(data.speed_mbs);
          setEtaS(data.eta_s);
          setElapsedS(data.elapsed_s);
          setTotalEstMb(data.total_estimate_mb);
          setLogLines(data.log || []);
          setPostInstallTask(data.post_install_task);
          pollRef.current = setTimeout(poll, 1000);
        } else {
          setPhase("idle");
        }
      } catch (err) {
        // Bootstrap server not yet ready — retry
        setTimeout(checkStatus, 2000);
      }
    };
    checkStatus();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const poll = async () => {
    try {
      const res = await fetch(`${BOOTSTRAP_URL}/api/bootstrap/status`);
      const data = await res.json();
      setPhase(data.installing ? "installing" : data.phase);
      setProgress(data.progress);
      setCurrentPkg(data.current_package);
      setCurrentIndex(data.current_index);
      setTotalPackages(data.total_packages);
      setSpeedMbs(data.speed_mbs);
      setEtaS(data.eta_s);
      setElapsedS(data.elapsed_s);
      setTotalEstMb(data.total_estimate_mb);
      setLogLines(data.log || []);
      setPostInstallTask(data.post_install_task);
      if (data.error) setError(data.error);

      if (data.installing) {
        pollRef.current = setTimeout(poll, 1000);
      } else if (data.phase === "done") {
        // Installation complete — notify main.js to start real backend
        setPhase("done");
        setTimeout(() => {
          window.nox?.depsInstalled?.();
          onComplete();
        }, 2000);
      } else if (data.phase === "error") {
        setPhase("error");
      }
    } catch {
      pollRef.current = setTimeout(poll, 2000);
    }
  };

  const startInstall = async () => {
    setPhase("installing");
    setLogLines([]);
    setError(null);
    setProgress(0);
    try {
      await fetch(`${BOOTSTRAP_URL}/api/bootstrap/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      pollRef.current = setTimeout(poll, 1000);
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  };

  const pct = Math.round(progress);
  const currentPkgDisplay = postInstallTask || currentPkg;

  return (
    <div className="flex flex-col h-full items-center justify-center gap-6 px-6 py-8 text-center">
      {/* Logo */}
      <img
        src={noxLogoGlowing}
        alt="Nox"
        className="w-32 h-auto"
        style={{ filter: "drop-shadow(0 0 20px rgba(99, 102, 241, 0.3))" }}
      />

      {/* Title */}
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-nox-text nox-heading">
          {phase === "done" ? "Setup abgeschlossen!" :
           phase === "installing" ? "Nox wird eingerichtet…" :
           phase === "error" ? "Setup fehlgeschlagen" :
           "Nox einrichten"}
        </h2>
        <p className="text-xs text-nox-textDim max-w-xs leading-relaxed">
          {phase === "done"
            ? "Alle Komponenten installiert. Nox startet in Kürze…"
            : phase === "installing"
            ? `Installiere ${totalPackages > 0 ? `${currentIndex + 1} von ${totalPackages}` : ""} Komponenten${currentPkgDisplay ? ` — ${currentPkgDisplay}` : ""}`
            : phase === "error"
            ? error || "Ein Fehler ist aufgetreten."
            : "Nox benötigt zusätzliche Komponenten. Klicke auf 'Installieren', um zu beginnen."}
        </p>
      </div>

      {/* GPU info */}
      {hasNvidia && gpuName && phase === "idle" && (
        <div className="px-3 py-2 nox-console-card text-xs flex items-center gap-2">
          <span className="text-nox-phosphor">⚡ NVIDIA GPU erkannt: {gpuName}</span>
        </div>
      )}

      {/* Progress bar */}
      {phase === "installing" && (
        <div className="w-full max-w-xs space-y-3">
          {/* Main progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-nox-textDim font-mono">{pct}%</span>
              <span className="text-nox-textDim font-mono">
                {speedMbs > 0 ? `${speedMbs.toFixed(1)} MB/s` : ""}
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-nox-border overflow-hidden">
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, var(--nox-accent), var(--nox-violet))",
                }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="px-2 py-1.5 nox-console-card rounded text-center">
              <div className="text-nox-textDim text-[10px] uppercase tracking-wide">Verbleibend</div>
              <div className="text-nox-text font-mono font-semibold">{formatTime(etaS)}</div>
            </div>
            <div className="px-2 py-1.5 nox-console-card rounded text-center">
              <div className="text-nox-textDim text-[10px] uppercase tracking-wide">Verstrichen</div>
              <div className="text-nox-text font-mono font-semibold">{formatTime(elapsedS)}</div>
            </div>
            <div className="px-2 py-1.5 nox-console-card rounded text-center">
              <div className="text-nox-textDim text-[10px] uppercase tracking-wide">Gesamt</div>
              <div className="text-nox-text font-mono font-semibold">{formatBytes(totalEstMb)}</div>
            </div>
          </div>

          {/* Log */}
          <div className="max-h-28 overflow-y-auto nox-console-card p-2 text-[11px] font-mono text-nox-textDim space-y-0.5 text-left">
            {logLines.slice(-12).map((line, i) => (
              <div key={i} className={line.includes("✓") ? "text-nox-phosphor" : line.includes("✗") ? "text-nox-red" : ""}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Done state */}
      {phase === "done" && (
        <div className="w-16 h-16 rounded-full bg-green-600/20 dark:bg-green-500/20 flex items-center justify-center">
          <span className="text-green-600 dark:text-green-500 text-3xl">✓</span>
        </div>
      )}

      {/* Install button */}
      {phase === "idle" && (
        <button
          onClick={startInstall}
          className="px-6 py-2.5 text-sm font-medium transition-all nox-btn-primary"
        >
          Installieren
        </button>
      )}

      {/* Error state */}
      {phase === "error" && (
        <div className="space-y-3 w-full max-w-xs">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <span className="text-red-500 text-3xl">✗</span>
          </div>
          {error && (
            <div className="px-3 py-2 nox-console-card rounded text-xs font-mono text-red-400 text-left max-h-24 overflow-y-auto">
              {error}
            </div>
          )}
          <button
            onClick={startInstall}
            className="px-6 py-2.5 text-sm font-medium transition-all nox-btn-primary w-full"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {/* Checking state */}
      {phase === "checking" && (
        <div className="flex items-center gap-2 text-xs text-nox-textDim">
          <span className="animate-pulse">Prüfe System…</span>
        </div>
      )}
    </div>
  );
}
