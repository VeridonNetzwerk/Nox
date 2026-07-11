import React from "react";

const STATE_CLASS = {
  idle: "orb-idle",
  listening: "orb-listening",
  processing: "orb-thinking",
  speaking: "orb-speaking",
};

export default function NoxOrb({ state = "idle", onClick, disabled = false, size = 56 }) {
  const animClass = STATE_CLASS[state] || STATE_CLASS.idle;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size * 2, height: size * 2 }}
    >
      {/* Ripple rings for listening state */}
      {state === "listening" && (
        <>
          <div
            className="absolute rounded-full orb-ripple"
            style={{
              width: size,
              height: size,
              border: "2px solid var(--nox-accent)",
              animationDelay: "0s",
            }}
          />
          <div
            className="absolute rounded-full orb-ripple"
            style={{
              width: size,
              height: size,
              border: "2px solid var(--nox-accent)",
              animationDelay: "0.5s",
            }}
          />
        </>
      )}

      {/* The orb itself */}
      <button
        onClick={onClick}
        disabled={disabled}
        className={`relative rounded-full ${animClass} ${
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-110"
        } transition-transform`}
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle at 35% 35%, var(--nox-accent-hover), var(--nox-accent) 60%, color-mix(in srgb, var(--nox-accent) 50%, black) 100%)`,
          border: "none",
        }}
        aria-label="Nox"
      >
        {/* Inner glow highlight */}
        <div
          className="absolute rounded-full"
          style={{
            top: "15%",
            left: "20%",
            width: "30%",
            height: "30%",
            background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />
      </button>
    </div>
  );
}
