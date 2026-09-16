import React, { useEffect, useState } from "react";
import { IconCheck, IconArrowDown, IconSpinner, IconX } from "../../shared/Icon.jsx";
import FamilyLogo from "./FamilyLogo.jsx";
import { formatGb, formatPulls, formatUpdated, FIT_STYLES } from "./marketFormat.js";

export default function ModelDetailModal({ entry, fit, engine, installed, active, downloading, updateAvailable, realSizeBytes, onInstall, onActivate, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [entry]);

  const fitStyle = fit !== "unknown" ? FIT_STYLES[fit] : null;

  const stats = [
    { label: "Größe", value: installed && realSizeBytes ? formatGb(realSizeBytes) : entry.sizeGb ? `~${entry.sizeGb} GB` : "–" },
    { label: "VRAM-Bedarf", value: entry.vramGb ? `${entry.vramGb} GB (GPU)` : "–" },
    { label: "Kontext", value: entry.context || "–" },
    { label: "Lizenz", value: entry.license || (entry.lib ? "Siehe Modellseite" : "–") },
    ...(entry.external ? [] : [
      { label: "Downloads", value: formatPulls(entry.pulls) },
      { label: "Aktualisiert", value: formatUpdated(entry.updatedDays) },
    ]),
  ].filter((s) => s.value && s.value !== "–");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative max-w-2xl w-full max-h-[85vh] overflow-y-auto custom-scrollbar rounded-2xl border border-nox-border bg-nox-surface-raised shadow-2xl animate-bubble-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden">
          <div className={`absolute inset-0 bg-gradient-to-br ${entry.gradient} opacity-10`} />
          <div className="relative px-6 pt-5 pb-4 flex items-start gap-4">
            <FamilyLogo family={entry.family} name={entry.key} size={56} className="rounded-2xl" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-nox-text">{entry.name}</h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-border/50 text-nox-textDim font-medium">{entry.params}</span>
                {updateAvailable && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-nox-amber/15 text-nox-amber font-medium">Update verfügbar</span>
                )}
                {active && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-nox-accent/15 text-nox-accent font-medium">
                    <IconCheck size={10} /> Aktiv
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[11px] text-nox-textDim">{entry.family}</span>
                {fit !== "unknown" && (
                  <span className={`flex items-center gap-1.5 text-[11px] font-medium ${fitStyle.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${fitStyle.dot}`} />
                    {fitStyle.label}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors shrink-0"
              title="Schließen (Esc)"
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5">
          <p className="text-sm text-nox-text leading-relaxed">{entry.longDesc}</p>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-nox-border bg-nox-surface/50 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-nox-textFaint font-medium">{s.label}</div>
                <div className="text-xs text-nox-text font-medium tabular-nums mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Benchmarks */}
          {(entry.benchmarks || []).length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-nox-textFaint mb-2">Benchmarks</div>
              <div className="space-y-2.5">
                {(entry.benchmarks || []).map((b) => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-nox-textDim">{b.label}</span>
                      <span className="text-nox-text font-medium tabular-nums">{b.value}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-nox-border/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-nox-accent to-nox-glow3 transition-all duration-500"
                        style={{ width: `${b.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-nox-textFaint mt-2">Benchmark-Richtwerte, gerundet – je nach Quantisierung und Aufgabe abweichend.</p>
            </div>
          )}

          {/* Tags */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(entry.tags || []).map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-nox-accent/10 text-nox-accent font-medium">{t}</span>
            ))}
          </div>

          {/* Quantization hint (GGUF engine only, curated models) */}
          {engine === "llama_cpp" && !entry.lib && (
            <div className="rounded-xl border border-nox-border bg-nox-surface/50 p-3 text-[11px] text-nox-textDim leading-relaxed">
              <span className="font-semibold text-nox-text">Quantisierung: </span>
              Nox lädt GGUF-Modelle standardmäßig in <span className="text-nox-text font-medium">Q4_K_M</span> – der beste
              Kompromiss aus Dateigröße und Qualität. "Q4" steht für 4 Bit pro Gewicht, "_K_M" für eine moderne
              Mixed-Precision-Methode mit gutem Qualitätsverhalten.
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="sticky bottom-0 px-6 py-4 border-t border-nox-border bg-nox-surface-raised/95 backdrop-blur-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {installed && !active && (
              confirmDelete ? (
                <button
                  onClick={() => { setConfirmDelete(false); onDelete(); }}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-nox-red border border-nox-red/40 hover:bg-nox-red/10 transition-colors"
                >
                  Wirklich löschen?
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-nox-textDim border border-nox-border hover:text-nox-red hover:border-nox-red/40 transition-colors"
                >
                  Löschen
                </button>
              )
            )}
            <span className="text-[11px] text-nox-textDim">
              {installed
                ? (active ? "Dieses Modell ist gerade aktiv." : updateAvailable ? "Neue Version verfügbar." : entry.external ? "Bereit – wird über den Server verwendet." : "Bereits installiert – bereit zum Aktivieren.")
                : downloading ? "Download läuft…" : entry.lib ? "Wird über Ollama installiert." : `Download: ~${entry.sizeGb} GB`}
            </span>
          </div>
          {installed ? (
            active ? (
              <span className="flex items-center gap-1.5 text-xs text-nox-accent font-medium px-4 py-2 rounded-xl bg-nox-accent/10">
                <IconCheck size={14} /> Aktiv
              </span>
            ) : (
              <button
                onClick={onActivate}
                className="px-4 py-2 rounded-xl text-xs font-medium nox-btn-secondary"
              >
                {entry.external ? "Verwenden" : updateAvailable ? "Aktualisieren & Aktivieren" : "Aktivieren"}
              </button>
            )
          ) : (
            <button
              onClick={onInstall}
              disabled={downloading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium nox-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {downloading ? <IconSpinner size={13} className="animate-spin" /> : <IconArrowDown size={14} weight={2.5} />}
              {downloading ? "Lädt…" : updateAvailable ? "Update installieren" : "Installieren"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
