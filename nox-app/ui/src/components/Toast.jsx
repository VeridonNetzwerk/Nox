import React, { createContext, useContext, useState, useCallback, useRef } from "react";

const GITHUB_ISSUES_URL = "https://github.com/VeridonNetzwerk/Nox/issues/new";

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { addToast: () => {} };
  return ctx;
}

function buildIssueUrl(title, body) {
  const params = new URLSearchParams({
    title: title || "Fehlerbericht: Nox",
    body: body || "",
    labels: "bug",
  });
  return `${GITHUB_ISSUES_URL}?${params.toString()}`;
}

function ToastItem({ toast, onDismiss }) {
  const colors = {
    error: {
      bg: "bg-red-500/15",
      border: "border-red-500/40",
      text: "text-red-400",
      icon: "⚠",
    },
    warning: {
      bg: "bg-yellow-500/15",
      border: "border-yellow-500/40",
      text: "text-yellow-400",
      icon: "⚠",
    },
    info: {
      bg: "bg-blue-500/15",
      border: "border-blue-500/40",
      text: "text-blue-400",
      icon: "ℹ",
    },
    success: {
      bg: "bg-green-500/15",
      border: "border-green-500/40",
      text: "text-green-400",
      icon: "✓",
    },
  };

  const c = colors[toast.type] || colors.error;
  const issueUrl = toast.reportable
    ? buildIssueUrl(
        `[${toast.type.toUpperCase()}] ${toast.title}`,
        `## Fehler\n\n**Titel:** ${toast.title}\n**Beschreibung:** ${toast.message}\n**Zeit:** ${new Date().toISOString()}\n**Details:**\n\`\`\`\n${toast.detail || "N/A"}\n\`\`\`\n\n## Schritte zum Reproduzieren\n\n1. \n2. \n3. \n\n## System\n\n- Nox Version: ${toast.version || "unknown"}\n- OS: ${navigator.userAgent}\n`
      )
    : null;

  return (
    <div
      className={`${c.bg} ${c.border} ${c.text} border rounded-xl px-3 py-2.5 text-xs shadow-lg backdrop-blur-md max-w-sm animate-slide-in`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 text-sm leading-tight">{c.icon}</span>
        <div className="flex-1 min-w-0">
          {toast.title && (
            <div className="font-semibold mb-0.5 truncate">{toast.title}</div>
          )}
          <div className="break-words">{toast.message}</div>
          {toast.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                Details
              </summary>
              <pre className="mt-1 text-[10px] opacity-70 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {toast.detail}
              </pre>
            </details>
          )}
          {issueUrl && (
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-[10px] underline hover:no-underline opacity-80 hover:opacity-100 transition-opacity"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.225.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              Auf GitHub melden
            </a>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity text-sm leading-none"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (opts) => {
      const id = ++idCounter.current;
      const toast = {
        id,
        type: opts.type || "error",
        title: opts.title || "",
        message: opts.message || "",
        detail: opts.detail || "",
        reportable: opts.reportable !== false,
        duration: opts.duration ?? (opts.type === "error" ? 0 : 5000),
      };
      setToasts((prev) => [...prev.slice(-3), toast]);
      if (toast.duration > 0) {
        setTimeout(() => dismiss(id), toast.duration);
      }
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ addToast, dismiss }}>
      {children}
      <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
