import React, { useState } from "react";

export default function ImageCard({ data, onClose, addToast }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleDownload = () => {
    fetch(data.url)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nox-image-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        addToast({ type: "info", title: "Download", message: "Bild heruntergeladen", duration: 2000 });
      })
      .catch(() => addToast({ type: "warning", title: "Download", message: "Download fehlgeschlagen", duration: 3000 }));
  };

  const handleOpenExternal = () => {
    window.open(data.url, "_blank");
  };

  return (
    <div className="max-w-md rounded-xl border border-nox-border bg-nox-surface overflow-hidden animate-bubble-in">
      <div className="px-3 py-2 border-b border-nox-border bg-nox-surface-hover/30 flex items-center justify-between">
        <span className="text-xs text-nox-textDim font-medium">Generiertes Bild</span>
        <button onClick={onClose} className="text-nox-textDim hover:text-nox-text text-xs">✕</button>
      </div>
      <div className="relative bg-nox-bg" style={{ minHeight: 200 }}>
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-xs text-nox-textDim">
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
              <span>Bild wird generiert…</span>
            </div>
          </div>
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-nox-red">
            Bild konnte nicht geladen werden
          </div>
        ) : (
          <img
            src={data.url}
            alt={data.prompt}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            className="w-full h-auto"
            style={{ display: loaded ? "block" : "none" }}
          />
        )}
      </div>
      <div className="px-3 py-2 border-t border-nox-border">
        <p className="text-xs text-nox-textDim mb-2 truncate" title={data.prompt}>{data.prompt}</p>
        <div className="flex items-center gap-2">
          <button onClick={handleDownload} className="nox-btn-secondary px-2 py-1 text-[10px]">Download</button>
          <button onClick={handleOpenExternal} className="nox-btn-secondary px-2 py-1 text-[10px]">Im Browser öffnen</button>
        </div>
      </div>
    </div>
  );
}
