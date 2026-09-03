import React, { useState, useEffect, useRef } from "react";

const TOOL_META = {
  dateien_suchen: {
    label: "Lokale Dateien",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    color: "text-nox-accent",
    bgColor: "bg-nox-accent/10",
    borderColor: "border-nox-accent/30",
  },
  search_web: {
    label: "Web-Suche",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    borderColor: "border-blue-400/30",
  },
  kontext_suche: {
    label: "Bildschirmkontext",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    borderColor: "border-purple-400/30",
  },
};

const PHASE_LABELS = {
  searching: "Durchsucht",
  found: "Gefunden",
  done: "Fertig",
  error: "Fehler",
};

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function SearchCard({ stream, onRemove }) {
  const meta = TOOL_META[stream.tool] || {
    label: stream.tool,
    icon: null,
    color: "text-nox-textDim",
    bgColor: "bg-nox-surface",
    borderColor: "border-nox-border",
  };

  const isSearching = stream.phase === "searching";
  const isDone = stream.phase === "done" || stream.phase === "error";
  const isError = stream.phase === "error";

  return (
    <div
      className={`rounded-lg border ${meta.borderColor} ${meta.bgColor} px-3 py-2 transition-all duration-300 ${
        isDone ? "opacity-70" : "opacity-100"
      }`}
      style={{
        animation: "searchCardSlideIn 0.3s ease-out",
      }}
    >
      <div className="flex items-center gap-2">
        <span className={meta.color}>{meta.icon}</span>
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
        <span className="text-xs text-nox-textFaint">·</span>
        <span className="text-xs text-nox-textDim truncate flex-1">{stream.query}</span>
        <span className={`flex items-center gap-1 text-[10px] ${isError ? "text-red-400" : isDone ? "text-green-400" : meta.color}`}>
          {isSearching && <Spinner />}
          {isDone && !isError && <CheckIcon />}
          {isError && <ErrorIcon />}
          {isSearching && (stream.source || PHASE_LABELS[stream.phase] || "")}
          {isDone && !isError && `${stream.count || 0} Ergebnisse`}
          {isError && "Fehler"}
        </span>
      </div>

      {isDone && !isError && stream.results && stream.results.length > 0 && (
        <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
          {stream.results.slice(0, 5).map((r, i) => (
            <div key={i} className="text-[10px] text-nox-textDim flex items-start gap-1.5">
              <span className="text-nox-textFaint mt-0.5">·</span>
              <span className="truncate">
                {r.title || r.name || r.url || ""}
                {r.snippet ? <span className="text-nox-textFaint"> — {r.snippet.substring(0, 60)}</span> : null}
              </span>
            </div>
          ))}
          {stream.results.length > 5 && (
            <div className="text-[10px] text-nox-textFaint pl-3">
              +{stream.results.length - 5} weitere
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchStream({ streams, onClear }) {
  if (!streams || streams.length === 0) return null;

  const active = streams.filter(s => s.phase === "searching" || s.phase === "found");
  const done = streams.filter(s => s.phase === "done" || s.phase === "error");

  return (
    <div className="my-2 space-y-1.5">
      <style>{`
        @keyframes searchCardSlideIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes searchPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {active.length > 0 && (
        <div className="space-y-1.5">
          {active.map(s => (
            <SearchCard key={s.id} stream={s} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-1.5">
          {done.slice(-3).map(s => (
            <SearchCard key={s.id} stream={s} />
          ))}
        </div>
      )}

      {done.length > 0 && active.length === 0 && (
        <button
          onClick={onClear}
          className="text-[10px] text-nox-textFaint hover:text-nox-textDim transition-colors"
        >
          Suchverlauf ausblenden
        </button>
      )}
    </div>
  );
}
