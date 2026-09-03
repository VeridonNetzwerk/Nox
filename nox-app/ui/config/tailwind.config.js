import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(__dirname, "..");

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    join(uiRoot, "index.html"),
    join(uiRoot, "src", "**", "*.{js,jsx,ts,tsx}"),
  ],
  theme: {
    extend: {
      colors: {
        nox: {
          bg: "var(--nox-bg)",
          bgSolid: "var(--nox-bg-solid)",
          "bg-solid": "var(--nox-bg-solid)",
          surface: "var(--nox-surface)",
          surfaceHover: "var(--nox-surface-hover)",
          "surface-hover": "var(--nox-surface-hover)",
          surfaceRaised: "var(--nox-surface-raised)",
          "surface-raised": "var(--nox-surface-raised)",
          border: "var(--nox-border)",
          borderHover: "var(--nox-border-hover)",
          "border-hover": "var(--nox-border-hover)",
          borderAccent: "var(--nox-border-accent)",
          "border-accent": "var(--nox-border-accent)",
          text: "var(--nox-text)",
          textDim: "var(--nox-text-dim)",
          "text-dim": "var(--nox-text-dim)",
          textFaint: "var(--nox-text-faint)",
          "text-faint": "var(--nox-text-faint)",
          accent: "var(--nox-accent)",
          accentHover: "var(--nox-accent-hover)",
          "accent-hover": "var(--nox-accent-hover)",
          accentFg: "var(--nox-accent-fg)",
          "accent-fg": "var(--nox-accent-fg)",
          violet: "var(--nox-violet)",
          phosphor: "var(--nox-phosphor)",
          phosphorDim: "var(--nox-phosphor-dim)",
          "phosphor-dim": "var(--nox-phosphor-dim)",
          amber: "var(--nox-amber)",
          red: "var(--nox-red)",
          shadow: "var(--nox-shadow)",
          shadowStrong: "var(--nox-shadow-strong)",
          "shadow-strong": "var(--nox-shadow-strong)",
          backdrop: "var(--nox-backdrop)",
          pillBg: "var(--nox-pill-bg)",
          "pill-bg": "var(--nox-pill-bg)",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Consolas", "monospace"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
