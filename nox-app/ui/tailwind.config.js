/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nox: {
          bg: "var(--nox-bg)",
          surface: "var(--nox-surface)",
          surfaceHover: "var(--nox-surface-hover)",
          surfaceRaised: "var(--nox-surface-raised)",
          border: "var(--nox-border)",
          borderHover: "var(--nox-border-hover)",
          borderAccent: "var(--nox-border-accent)",
          text: "var(--nox-text)",
          textDim: "var(--nox-text-dim)",
          textFaint: "var(--nox-text-faint)",
          accent: "var(--nox-accent)",
          accentHover: "var(--nox-accent-hover)",
          violet: "var(--nox-violet)",
          phosphor: "var(--nox-phosphor)",
          phosphorDim: "var(--nox-phosphor-dim)",
          amber: "var(--nox-amber)",
          red: "var(--nox-red)",
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
