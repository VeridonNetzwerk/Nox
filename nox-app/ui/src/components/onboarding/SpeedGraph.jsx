import React, { useMemo } from "react";

// Catmull-Rom → cubic bezier: turns the polyline into a smooth curve
function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export default function SpeedGraph({ history, paused }) {
  const W = 100;
  const H = 100;

  const { dlPath, writePath, dlAreaPath, writeAreaPath } = useMemo(() => {
    if (!history || history.length === 0) {
      return { dlPath: "", writePath: "", dlAreaPath: "", writeAreaPath: "" };
    }

    const max = Math.max(
      ...history.map((p) => Math.max(p.dl || 0, p.write || 0)),
      1024 * 1024
    );

    const n = history.length;
    const toPoint = (i, val) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * W;
      const y = H - (val / max) * H * 0.85 - 8;
      return { x, y };
    };

    const dlPts = history.map((p, i) => toPoint(i, p.dl || 0));
    const writePts = history.map((p, i) => toPoint(i, p.write || 0));

    const dlPath = smoothPath(dlPts);
    const writePath = smoothPath(writePts);

    return {
      dlPath,
      writePath,
      dlAreaPath: `${dlPath} L ${W},${H} L 0,${H} Z`,
      writeAreaPath: `${writePath} L ${W},${H} L 0,${H} Z`,
    };
  }, [history]);

  if (!history || history.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-xs text-nox-textDim/30">
        {paused ? "⏸ Pausiert" : "Warte auf Speed-Daten…"}
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      <defs>
        <linearGradient id="dlFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="writeFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eab308" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0" y1={H * f} x2={W} y2={H * f}
          stroke="currentColor"
          strokeWidth="0.2"
          opacity="0.08"
        />
      ))}

      <path d={writeAreaPath} fill="url(#writeFill)" />
      <path
        d={writePath}
        fill="none"
        stroke="#eab308"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
        opacity="0.75"
      />

      <path d={dlAreaPath} fill="url(#dlFill)" />
      <path
        d={dlPath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
