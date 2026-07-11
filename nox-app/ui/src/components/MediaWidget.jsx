import React from "react";

export default function MediaWidget({ visible, micState, locale }) {
  if (!visible) return null;

  const isSpeaking = micState === "speaking";
  const isListening = micState === "listening";
  const isProcessing = micState === "processing";

  const label = isSpeaking
    ? (locale?.app?.speaking || "Nox spricht…")
    : isListening
    ? (locale?.app?.listening || "Höre zu…")
    : isProcessing
    ? (locale?.app?.thinking || "Verarbeite…")
    : "";

  if (!label) return null;

  return (
    <div className="px-4 pb-1">
      <div className="glass-card px-3 py-2 flex items-center gap-3">
        {/* Animated bars */}
        <div className="flex items-end gap-0.5 h-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-nox-accent"
              style={{
                height: isSpeaking ? "100%" : isListening ? "60%" : "30%",
                animation: isSpeaking
                  ? `nox-orb-speaking 0.6s ease-in-out infinite`
                  : isListening
                  ? `nox-orb-listening 1.2s ease-in-out infinite`
                  : "none",
                animationDelay: `${i * 0.1}s`,
                opacity: 0.8,
              }}
            />
          ))}
        </div>
        <span className="text-xs text-nox-textDim flex-1">{label}</span>
        {isSpeaking && (
          <button
            onClick={() => window.nox?.stopSpeaking?.()}
            className="text-xs text-nox-textDim hover:text-red-400 transition-colors px-2 py-0.5 rounded-full hover:bg-red-500/10"
          >
            ⏹
          </button>
        )}
      </div>
    </div>
  );
}
