import React, { useState, useEffect, useRef } from "react";
import noxLogoGlowing from "../../assets/nox-logo-glowing.png";

const STATUS_STEPS = [
  { label: "Initialisiere Backend…", pct: 15 },
  { label: "Lade KI-Modell…", pct: 45 },
  { label: "Starte Spracherkennung…", pct: 70 },
  { label: "Verbinde…", pct: 90 },
  { label: "Bereit", pct: 100 },
];

export default function LoadingScreen({ backendReady }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState(STATUS_STEPS[0].label);
  const [displayPct, setDisplayPct] = useState(0);
  const stepRef = useRef(0);
  const rafRef = useRef(null);

  // Animate progress towards target
  useEffect(() => {
    if (backendReady) {
      setProgress(100);
      setStatusText("Bereit");
      return;
    }

    // Simulate progress through startup steps
    const timers = STATUS_STEPS.map((step, i) => {
      return setTimeout(() => {
        stepRef.current = i;
        setProgress(step.pct);
        setStatusText(step.label);
      }, i * 2000);
    });

    return () => timers.forEach(clearTimeout);
  }, [backendReady]);

  // Smooth animate the displayed percentage towards target progress
  useEffect(() => {
    const animate = () => {
      setDisplayPct((prev) => {
        const diff = progress - prev;
        if (Math.abs(diff) < 0.5) return progress;
        return prev + diff * 0.08;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [progress]);

  const pct = Math.round(displayPct);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: "radial-gradient(ellipse at center, #1a1a1e 0%, #0d0d0f 100%)",
      }}
    >
      {/* Logo with glow */}
      <div className="flex flex-col items-center gap-8 mb-16">
        <img
          src={noxLogoGlowing}
          alt="Nox"
          className="w-32 h-auto"
          style={{
            filter: "drop-shadow(0 0 30px rgba(99, 102, 241, 0.4))",
            animation: "breathe 3s ease-in-out infinite",
          }}
        />
      </div>

      {/* Progress bar */}
      <div className="w-64 space-y-3">
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
              boxShadow: "0 0 10px rgba(99, 102, 241, 0.5)",
            }}
          />
        </div>

        {/* Status text (below bar, left-aligned) */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40 font-medium tracking-wide">
            {statusText}
          </span>
          {/* Percentage (bottom-right) */}
          <span className="text-xs text-white/60 font-mono tabular-nums">
            {pct}%
          </span>
        </div>
      </div>

      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.05); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
