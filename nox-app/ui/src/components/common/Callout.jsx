import React from "react";
import { IconWarning, IconInfo, IconCheckCircle } from "../../shared/Icon.jsx";

const TYPES = {
  error: { accentVar: "--nox-red", icon: <IconWarning size={15} weight={24} /> },
  warning: { accentVar: "--nox-amber", icon: <IconWarning size={15} weight={24} /> },
  info: { accentVar: "--nox-accent", icon: <IconInfo size={15} weight={24} /> },
  success: { accentVar: "--nox-phosphor", icon: <IconCheckCircle size={15} weight={24} /> },
};

export default function Callout({ type = "error", title, children, actionLabel, onAction, className = "" }) {
  const c = TYPES[type] || TYPES.error;
  return (
    <div
      className={`relative rounded-xl pl-4 pr-3 py-2.5 text-xs overflow-hidden ${className}`}
      style={{
        background: `color-mix(in srgb, var(${c.accentVar}) 15%, var(--nox-surface))`,
        border: `1px solid color-mix(in srgb, var(${c.accentVar}) 50%, var(--nox-border))`,
        boxShadow: `0 4px 24px color-mix(in srgb, var(${c.accentVar}) 15%, transparent)`,
      }}
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: `var(${c.accentVar})` }} />
      <div className="flex items-start gap-2.5">
        <span
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
          style={{
            background: `color-mix(in srgb, var(${c.accentVar}) 30%, transparent)`,
            color: `var(${c.accentVar})`,
            border: `1px solid color-mix(in srgb, var(${c.accentVar}) 50%, transparent)`,
          }}
        >
          {c.icon}
        </span>
        <div className="flex-1 min-w-0">
          {title && (
            <div className="font-semibold mb-0.5" style={{ color: `var(${c.accentVar})` }}>
              {title}
            </div>
          )}
          <div className="break-words leading-relaxed" style={{ color: "var(--nox-text)" }}>
            {children}
          </div>
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            style={{
              color: `var(${c.accentVar})`,
              border: `1px solid color-mix(in srgb, var(${c.accentVar}) 35%, transparent)`,
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
