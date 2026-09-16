// Shared formatting helpers + fit styles for the AI Marketplace.

export function formatGb(bytes) {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  const mb = bytesPerSec / (1024 * 1024);
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB/s`;
}

export function formatPulls(millions) {
  if (!millions && millions !== 0) return "";
  return millions >= 1 ? `${millions.toFixed(1).replace(".", ",")}M` : `${Math.round(millions * 1000)}K`;
}

export function formatUpdated(days) {
  if (days == null) return "";
  if (days < 2) return "gerade aktualisiert";
  if (days < 14) return `vor ${Math.round(days)} T.`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wo.`;
  if (days < 365) return `vor ${Math.round(days / 30)} Mon.`;
  return `vor ${Math.max(1, Math.round(days / 365))} J.`;
}

export const FIT_STYLES = {
  gpu: { dot: "bg-nox-phosphor", text: "text-nox-phosphor", label: "Läuft auf deiner GPU" },
  hybrid: { dot: "bg-nox-accent", text: "text-nox-accent", label: "Läuft mit GPU+RAM (etwas langsamer)" },
  cpu: { dot: "bg-nox-amber", text: "text-nox-amber", label: "Nur CPU – langsamer" },
  big: { dot: "bg-nox-red", text: "text-nox-red", label: "Zu groß für dieses System" },
};
