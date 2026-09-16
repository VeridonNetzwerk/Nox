import React, { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../../shared/constants.jsx";
import { parseModelBadge, GGUF_FILENAMES } from "../../shared/prettyNames.jsx";
import { IconCheck, IconArrowDown, IconSpinner, IconX } from "../../shared/Icon.jsx";
import { formatGb, formatSpeed } from "../main/marketFormat.js";

// Catalog of downloadable models — mirrors GGUF_DOWNLOAD_URLS in the backend.
// `key` is the Ollama model name; the GGUF filename comes from the shared GGUF_FILENAMES map.
const CATALOG = [
  { key: "qwen3.5:0.8b", name: "Qwen 3.5 0.8B", params: "0.8B", sizeGb: 1.3, tags: ["Tool-Calling"], desc: "Kleinstes Modell – blitzschnell, auch auf CPU.", warning: "Sehr kleines Modell – nur für einfache Aufgaben geeignet." },
  { key: "granite4.2:3b", name: "Granite 4.2 3B", params: "3B", sizeGb: 2.2, tags: ["Thinking", "Tool-Calling"], desc: "Kompakt und schnell – exzellent für Tool-Use." },
  { key: "phi4-mini:3.8b", name: "Phi-4 mini 3.8B", params: "3.8B", sizeGb: 3.0, tags: ["Reasoning"], desc: "Beste Qualität für sehr begrenzte Hardware.", warning: "Kompaktes Modell – bei komplexeren Aufgaben können Fehler auftreten." },
  { key: "qwen3.5:4b", name: "Qwen 3.5 4B", params: "4B", sizeGb: 4.0, tags: ["Tool-Calling"], desc: "Gute Balance für schwächere GPUs." },
  { key: "gemma4:e4b", name: "Gemma 4 E4B", params: "E4B", sizeGb: 5.0, tags: ["MoE"], desc: "Effiziente Gemma-Variante mit aktivem Expertenrouting." },
  { key: "qwen3.5:9b", name: "Qwen 3.5 9B", params: "9B", sizeGb: 6.5, tags: ["Tool-Calling"], desc: "Beste Balance für 8-16 GB VRAM." },
  { key: "qwen3.5:14b", name: "Qwen 3.5 14B", params: "14B", sizeGb: 9.0, tags: ["Tool-Calling"], desc: "Hohe Qualität für 12-20 GB VRAM." },
  { key: "gemma4:26b", name: "Gemma 4 26B A4B", params: "26B A4B", sizeGb: 15, tags: ["MoE", "Tool-Calling"], desc: "MoE-Modell – 26B Parameter, 4B aktiv, native FC." },
  { key: "granite4.2:30b", name: "Granite 4.2 30B", params: "30B", sizeGb: 18, tags: ["Thinking", "Tool-Calling"], desc: "Höchste Qualität – bester Tool-Use für Workstations." },
  { key: "qwen3.8:27b", name: "Qwen 3.8 27B", params: "27B", sizeGb: 18, tags: ["Hybrid Attention", "Agentic Coding"], desc: "Starkes Modell für High-End-GPUs." },
  { key: "qwen3.6:35b-a3b", name: "Qwen 3.6 35B A3B", params: "35B A3B", sizeGb: 23, tags: ["MoE", "Agentic Coding"], desc: "Höchste Qualität – MoE mit 3B aktiven Parametern." },
];

export default function ModelCatalog({ engine, installedModels, currentModel, onSelectModel, onModelsChanged, addToast }) {
  const [filter, setFilter] = useState("all"); // all | installed | available
  const [pull, setPull] = useState(null);
  // Poll on mount to catch a download started elsewhere, then keep polling only while active
  const [pollActive, setPollActive] = useState(true);
  // Optimistically installed catalog keys — bridges the gap until the models list refreshes
  const [justInstalled, setJustInstalled] = useState(() => new Set());
  const wasRunningRef = useRef(false);

  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models`);
      const data = await res.json();
      if (data.status === "ok") {
        onModelsChanged(data.available_models || [], data.backend_type || "");
      }
    } catch {}
  }, [onModelsChanged]);

  useEffect(() => {
    if (!pollActive) return undefined;
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
          // Download just finished (or failed) — notify once, then refresh
          wasRunningRef.current = false;
          setPull(null);
          if (data.error) {
            addToast({ type: "error", title: "Download fehlgeschlagen", message: `${parseModelBadge(data.model).name}: ${data.error}`, duration: 6000 });
          } else if (data.status_text === "done" || data.progress >= 1) {
            // Mark installed immediately so the download button never flashes back
            if (data.model) setJustInstalled((prev) => new Set(prev).add(data.model));
            addToast({ type: "success", title: "Download abgeschlossen", message: parseModelBadge(data.model).name, duration: 4000 });
          }
          await refreshModels();
          setJustInstalled(new Set()); // real models list is authoritative now
        } else {
          setPollActive(false); // idle — stop polling until a download starts
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 600);
    return () => clearInterval(iv);
  }, [pollActive, refreshModels, addToast]);

  const startDownload = async (entry) => {
    const endpoint = engine === "llama_cpp" ? "/api/onboarding/pull-gguf-model" : "/api/onboarding/pull-ollama-model";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: entry.key }),
      });
      const data = await res.json();
      if (data.status === "started") {
        setPull({ model: entry.key, progress: 0, completed: 0, total: 0, speed: 0, paused: false, status_text: "downloading" });
        wasRunningRef.current = true;
        setPollActive(true);
      } else if (data.status === "queued") {
        addToast({ type: "info", title: "KI-Katalog", message: `${entry.name} zur Warteschlange hinzugefügt (Position ${data.position})` });
      } else if (data.status === "error") {
        addToast({ type: "error", title: "KI-Katalog", message: data.error || "Download nicht möglich" });
      }
    } catch (err) {
      addToast({ type: "error", title: "KI-Katalog", message: "Download konnte nicht gestartet werden", detail: String(err) });
    }
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

  if (engine !== "ollama" && engine !== "llama_cpp") {
    return (
      <div className="mt-4 px-4 py-5 rounded-xl border border-nox-border bg-nox-surface/30 text-center">
        <p className="text-sm text-nox-textDim">
          Wähle oben eine Engine (Ollama oder Nox-Engine), um den KI-Katalog zu nutzen.
        </p>
      </div>
    );
  }

  const isInstalled = (entry) => {
    if (justInstalled.has(entry.key)) return true;
    return engine === "llama_cpp"
      ? installedModels.includes(GGUF_FILENAMES[entry.key])
      : installedModels.some((m) => m === entry.key || m.startsWith(entry.key));
  };

  const modelIdFor = (entry) => (engine === "llama_cpp" ? GGUF_FILENAMES[entry.key] : entry.key);

  const installedEntries = CATALOG.filter(isInstalled);
  const availableEntries = CATALOG.filter((e) => !isInstalled(e));
  // Installed models that are not part of the curated catalog (custom pulls / own GGUF files)
  const customInstalled = installedModels.filter((m) => {
    if (engine === "llama_cpp") return !Object.values(GGUF_FILENAMES).includes(m);
    return !CATALOG.some((e) => m === e.key || m.startsWith(e.key));
  });
  const installedCount = installedEntries.length + customInstalled.length;

  const isActive = (entry) => {
    if (currentModel === modelIdFor(entry)) return true;
    return engine === "ollama" && currentModel && currentModel.startsWith(entry.key);
  };

  return (
    <div className="mt-4 space-y-2.5">
      {/* Header with filter chips */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-nox-text">KI-Katalog</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/10 text-nox-accent border border-nox-accent/20 font-medium">
            {engine === "llama_cpp" ? "Nox-Engine" : "Ollama"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {[
            { id: "all", label: `Alle (${installedCount + availableEntries.length})` },
            { id: "installed", label: `Installiert (${installedCount})` },
            { id: "available", label: `Verfügbar (${availableEntries.length})` },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border ${
                filter === f.id
                  ? "border-nox-accent bg-nox-accent/10 text-nox-accent"
                  : "border-nox-border text-nox-textDim hover:text-nox-text hover:bg-nox-surface"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active download — Steam-style progress banner */}
      {pull && (
        <div className="rounded-xl border border-nox-accent/40 bg-nox-accent/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <IconSpinner size={14} className="text-nox-accent animate-spin shrink-0" />
              <span className="text-sm font-medium text-nox-text truncate">
                {parseModelBadge(pull.model).name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium shrink-0">
                {pull.paused ? "Pausiert" : "Wird heruntergeladen"}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={togglePause}
                className="px-2.5 py-1 rounded-lg text-xs text-nox-text hover:bg-nox-surface-hover border border-nox-border transition-colors"
              >
                {pull.paused ? "Fortsetzen" : "Pause"}
              </button>
              <button
                onClick={cancelDownload}
                title="Download abbrechen"
                className="flex items-center justify-center w-7 h-7 rounded-lg text-nox-textDim hover:text-nox-red hover:bg-nox-surface-hover transition-all"
              >
                <IconX size={14} />
              </button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-nox-border/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-nox-accent to-nox-glow3 shadow-sm shadow-nox-shadow-accent transition-all duration-300"
              style={{ width: `${Math.round((pull.progress || 0) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-nox-textDim tabular-nums">
            <span>
              {formatGb(pull.completed)}{pull.total ? ` / ${formatGb(pull.total)}` : ""} · {Math.round((pull.progress || 0) * 100)}%
            </span>
            {!pull.paused && pull.speed > 0 && <span>{formatSpeed(pull.speed)}</span>}
          </div>
        </div>
      )}

      {/* Model list */}
      <div className="space-y-1.5">
        {(filter === "all" || filter === "installed") && (
          <>
            {installedCount === 0 && (
              <p className="text-xs text-nox-textDim px-1 py-1">Noch keine Modelle installiert.</p>
            )}
            {installedEntries.map((entry) => (
              <ModelCard
                key={entry.key}
                entry={entry}
                installed
                active={isActive(entry)}
                onActivate={() => onSelectModel(modelIdFor(entry))}
              />
            ))}
            {customInstalled.map((m) => {
              const { name, tag } = parseModelBadge(m);
              return (
                <div
                  key={m}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-all ${
                    currentModel === m
                      ? "border-nox-accent/60 bg-nox-accent/5"
                      : "border-nox-border bg-nox-surface/40 hover:bg-nox-surface-hover/60"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-nox-text truncate">{name}</span>
                      {tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-border/50 text-nox-textDim font-medium">{tag}</span>}
                    </div>
                    <p className="text-xs text-nox-textDim mt-0.5">Eigene Installation</p>
                  </div>
                  {currentModel === m ? (
                    <span className="flex items-center gap-1.5 text-xs text-nox-accent font-medium shrink-0">
                      <IconCheck size={13} /> Aktiv
                    </span>
                  ) : (
                    <button
                      onClick={() => onSelectModel(m)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium nox-btn-secondary shrink-0"
                    >
                      Aktivieren
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {(filter === "all" || filter === "available") && availableEntries.map((entry) => (
          <ModelCard
            key={entry.key}
            entry={entry}
            installed={false}
            onDownload={() => startDownload(entry)}
          />
        ))}
      </div>
    </div>
  );
}

function ModelCard({ entry, installed, active, onActivate, onDownload }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-all ${
        active
          ? "border-nox-accent/60 bg-nox-accent/5"
          : "border-nox-border bg-nox-surface/40 hover:bg-nox-surface-hover/60 hover:border-nox-borderHover"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-nox-text truncate">{entry.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-border/50 text-nox-textDim font-medium">{entry.params}</span>
          {(entry.tags || []).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/10 text-nox-accent font-medium">{t}</span>
          ))}
        </div>
        <p className="text-xs text-nox-textDim mt-0.5 truncate">{entry.desc}</p>
        {entry.warning && (
          <p className="text-[10px] text-yellow-600/90 dark:text-yellow-400/90 mt-0.5 truncate">{entry.warning}</p>
        )}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-xs text-nox-textDim tabular-nums">~{entry.sizeGb} GB</span>
        {installed ? (
          active ? (
            <span className="flex items-center gap-1.5 text-xs text-nox-accent font-medium">
              <IconCheck size={13} /> Aktiv
            </span>
          ) : (
            <button onClick={onActivate} className="px-3 py-1.5 rounded-lg text-xs font-medium nox-btn-secondary">
              Aktivieren
            </button>
          )
        ) : (
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium nox-btn-primary"
          >
            <IconArrowDown size={13} /> Herunterladen
          </button>
        )}
      </div>
    </div>
  );
}
