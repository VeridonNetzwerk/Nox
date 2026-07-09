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
          border: "var(--nox-border)",
          text: "var(--nox-text)",
          textDim: "var(--nox-text-dim)",
          accent: "var(--nox-accent)",
          accentHover: "var(--nox-accent-hover)",
        },
      },
    },
  },
  plugins: [],
};
