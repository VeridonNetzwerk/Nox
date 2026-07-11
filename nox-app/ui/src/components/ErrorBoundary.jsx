import React, { Component } from "react";
import noxIcon from "../assets/nox-icon.png";

const GITHUB_ISSUES_URL = "https://github.com/VeridonNetzwerk/Nox/issues/new";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("[Nox ErrorBoundary]", error, errorInfo);
    try {
      fetch("http://127.0.0.1:8420/api/log/ui-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: String(error),
          stack: error?.stack || "",
          componentStack: errorInfo?.componentStack || "",
          url: window.location?.href || "",
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReport = () => {
    const { error, errorInfo } = this.state;
    const body = `## Fehler (UI Crash)\n\n**Fehler:** \`${String(error)}\`\n\n**Stack:**\n\`\`\`\n${error?.stack || "N/A"}\n\`\`\`\n\n**Component Stack:**\n\`\`\`\n${errorInfo?.componentStack || "N/A"}\n\`\`\`\n\n**Zeit:** ${new Date().toISOString()}\n\n## Schritte zum Reproduzieren\n\n1. \n2. \n3. \n`;
    const url = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent("[UI-Crash] " + String(error).slice(0, 80))}&body=${encodeURIComponent(body)}&labels=bug,ui-crash`;
    window.open(url, "_blank");
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-4 p-6 nox-window-bg backdrop-blur-xl border border-nox-border rounded-2xl">
          <img src={noxIcon} alt="Nox" className="w-12 h-12 rounded-full opacity-80" />
          <div className="text-center max-w-sm">
            <h2 className="text-sm font-semibold text-red-400 mb-1">
              Nox ist auf ein Problem gestossen
            </h2>
            <p className="text-xs text-nox-text mb-3">
              Die UI hat einen unerwarteten Fehler erkannt. Du kannst Nox neu laden oder einen Fehlerbericht erstellen.
            </p>
            <pre className="text-[10px] text-red-300 bg-nox-surface rounded-lg p-2 max-h-32 overflow-y-auto text-left mb-3 break-all border border-red-500/20">
              {String(this.state.error).slice(0, 500)}
            </pre>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReload}
                className="px-3 py-1.5 rounded-lg bg-nox-accent text-white text-xs hover:bg-nox-accentHover transition-colors"
              >
                Neu laden
              </button>
              <button
                onClick={this.handleReport}
                className="px-3 py-1.5 rounded-lg bg-nox-surface border border-nox-border text-nox-text text-xs hover:border-nox-accent transition-colors inline-flex items-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.225.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                Auf GitHub melden
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
