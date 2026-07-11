import React, { useState, useRef, useEffect, useCallback } from "react";
import SettingsPanel from "./components/SettingsPanel.jsx";
import OnboardingWizard from "./components/OnboardingWizard.jsx";
import { useToast } from "./components/Toast.jsx";
import noxIcon from "./assets/nox-icon.png";
import deLocale from "./locales/de.json";

const LOCALE_MAP = {
  "de_DE": () => Promise.resolve({ default: deLocale }),
  "en_US": () => import("./locales/en_US.json"),
  "en_GB": () => import("./locales/en_GB.json"),
  "fr_FR": () => import("./locales/fr_FR.json"),
  "es_ES": () => import("./locales/es_ES.json"),
  "es_MX": () => import("./locales/es_MX.json"),
  "it_IT": () => import("./locales/it_IT.json"),
  "ja_JP": () => import("./locales/ja_JP.json"),
  "zh_CN": () => import("./locales/zh_CN.json"),
  "nl_NL": () => import("./locales/nl_NL.json"),
  "pl_PL": () => import("./locales/pl_PL.json"),
  "pt_BR": () => import("./locales/pt_BR.json"),
  "pt_PT": () => import("./locales/pt_PT.json"),
  "ru_RU": () => import("./locales/ru_RU.json"),
  "tr_TR": () => import("./locales/tr_TR.json"),
  "sv_SE": () => import("./locales/sv_SE.json"),
  "da_DK": () => import("./locales/da_DK.json"),
  "cs_CZ": () => import("./locales/cs_CZ.json"),
  "fi_FI": () => import("./locales/fi_FI.json"),
  "uk_UA": () => import("./locales/uk_UA.json"),
  "vi_VN": () => import("./locales/vi_VN.json"),
  "ar_JO": () => import("./locales/ar_JO.json"),
  "hu_HU": () => import("./locales/hu_HU.json"),
  "ro_RO": () => import("./locales/ro_RO.json"),
  "sk_SK": () => import("./locales/sk_SK.json"),
  "el_GR": () => import("./locales/el_GR.json"),
  "hi": () => import("./locales/hi.json"),
};

const WS_URL = "ws://127.0.0.1:8420/ws/chat";
const API_BASE = "http://127.0.0.1:8420";

async function speakText(text, addToast) {
  try {
    const resp = await fetch(`${API_BASE}/api/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    if (data.status === "error") {
      addToast?.({ type: "error", title: "TTS", message: data.error || "Text-to-Speech fehlgeschlagen" });
    }
  } catch (err) {
    addToast?.({ type: "error", title: "TTS", message: "Text-to-Speech fehlgeschlagen", detail: String(err), reportable: true });
  }
}

function App() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [theme, setTheme] = useState("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [micState, setMicState] = useState("idle"); // idle | listening | processing | speaking
  const [animState, setAnimState] = useState("visible"); // hidden | animating-in | visible | animating-out
  const [systemStatus, setSystemStatus] = useState(null); // null = not fetched yet
  const [backendReady, setBackendReady] = useState(false);
  const [localeData, setLocaleData] = useState(deLocale);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const t = localeData;

  // Load locale based on system language from backend
  useEffect(() => {
    const loadLocale = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/voices/system-language`);
        const data = await res.json();
        if (data.status === "ok" && data.language_code) {
          const loader = LOCALE_MAP[data.language_code];
          if (loader) {
            const mod = await loader();
            setLocaleData(mod.default);
            return;
          }
        }
      } catch {
        // Backend not available yet
      }
      // Fallback to German
      const mod = await LOCALE_MAP["de_DE"]();
      setLocaleData(mod.default);
    };
    loadLocale();
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // WebSocket connection
  const wsReconnectRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);
  useEffect(() => {
    let destroyed = false;
    const connect = () => {
      // Close any existing connection before creating a new one
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("connected");
        setBackendReady(true);
        wsReconnectRef.current = 0;
        hasConnectedOnceRef.current = true;
      };
      ws.onclose = () => {
        if (destroyed) return;
        setConnectionStatus("disconnected");
        // Only show toast if we had a real connection before (not during startup)
        if (hasConnectedOnceRef.current && wsReconnectRef.current === 0) {
          addToast({ type: "warning", title: "Verbindung", message: "Verbindung zum Backend getrennt. Versuche erneut zu verbinden…", duration: 4000 });
        }
        // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
        const delay = Math.min(1000 * Math.pow(2, wsReconnectRef.current), 15000);
        wsReconnectRef.current++;
        setTimeout(connect, delay);
      };
      ws.onerror = () => {
        setConnectionStatus("error");
        // Only show toast if we had a real connection before (not during startup)
        if (hasConnectedOnceRef.current && wsReconnectRef.current === 0) {
          addToast({ type: "error", title: "Verbindung", message: "Verbindungsfehler zum Backend", reportable: true });
        }
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch (e) {
          console.error("Invalid WebSocket message:", e);
          return;
        }

        // Voice state events from backend
        if (data.type === "voice_event") {
          const stateMap = {
            wake_detected: "listening",
            listening: "listening",
            transcribing: "processing",
            thinking: "processing",
            speaking: "speaking",
            idle: "idle",
          };
          const newMicState = stateMap[data.state] || "idle";
          setMicState(newMicState);
          if (data.state === "wake_detected") {
            // Request Electron to show the window
            window.nox?.showWindow?.();
          }
          return;
        }

        // Voice transcript shown as user message
        if (data.type === "user_message") {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: data.content, streaming: false, voice: data.voice_input },
          ]);
          setIsStreaming(true);
          window.nox?.setThinkingState?.(true);
          return;
        }

        if (data.type === "tool_start") {
          // Clear the current streaming assistant message (tool-call text)
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              updated.pop();
            }
            return [...updated];
          });
          return;
        }

        if (data.type === "token") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              last.content += data.content;
              return [...updated];
            }
            return [
              ...updated,
              { role: "assistant", content: data.content, streaming: true },
            ];
          });
        } else if (data.type === "done") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              last.streaming = false;
            }
            return [...updated];
          });
          setIsStreaming(false);
          window.nox?.setThinkingState?.(false);
        } else if (data.type === "error") {
          setMessages((prev) => [
            ...prev,
            { role: "error", content: data.content, streaming: false },
          ]);
          setIsStreaming(false);
          window.nox?.setThinkingState?.(false);
          addToast({ type: "error", title: "Nox", message: data.content, reportable: true });
        }
      };
    };

    connect();
    return () => {
      destroyed = true;
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Fetch system status on mount + periodically
  useEffect(() => {
    let lastErrorTime = 0;
    const fetchStatus = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8420/api/status");
        const data = await res.json();
        if (data.status === "ok") setSystemStatus(data);
      } catch {
        // Only toast if backend was previously connected (not during startup)
        if (!hasConnectedOnceRef.current) return;
        const now = Date.now();
        if (now - lastErrorTime > 30000) {
          lastErrorTime = now;
          addToast({ type: "warning", title: "Status", message: "System-Status konnte nicht abgerufen werden", duration: 5000 });
        }
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check onboarding state on first mount + retry if backend is not yet ready
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 60; // up to ~180s wait for CUDA torch first-load

    const checkOnboarding = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8420/api/settings");
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "ok" && !data.settings.onboarding_completed) {
          setShowOnboarding(true);
          // Make sure window is visible when onboarding shows
          window.nox?.showWindow?.();
        }
      } catch {
        if (cancelled) return;
        // Silent retry — toast only after many failures AND only if we never connected
        if (retries === 10 && !hasConnectedOnceRef.current) {
          addToast({ type: "warning", title: "Backend", message: "Backend reagiert nicht. Nox versucht weiterhin eine Verbindung herzustellen…", duration: 6000 });
        }
        // Retry if backend is not yet reachable (e.g. AV sandbox delay)
        if (retries < MAX_RETRIES) {
          retries++;
          setTimeout(checkOnboarding, 3000);
        } else {
          // Backend never responded — keep showing loading screen, don't force onboarding
          console.log("Backend unreachable after retries — keeping loading screen");
        }
      }
    };
    checkOnboarding();
    return () => { cancelled = true; };
  }, []);

  // Electron IPC listeners
  useEffect(() => {
    const nox = window.nox;
    if (!nox) return;

    if (nox.onThemeChanged) {
      nox.onThemeChanged((t) => setTheme(t));
    }
    if (nox.onWindowShow) {
      nox.onWindowShow(() => {
        setAnimState("animating-in");
        setTimeout(() => setAnimState("visible"), 200);
      });
    }
    if (nox.onWindowHide) {
      nox.onWindowHide(() => {
        setAnimState("animating-out");
        setTimeout(() => setAnimState("hidden"), 200);
      });
    }
    if (nox.onOpenSettings) {
      nox.onOpenSettings(() => setShowSettings(true));
    }
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") {
        if (showSettings) {
          setShowSettings(false);
        } else {
          window.nox?.hideWindow?.();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showSettings]);

  const sendMessage = useCallback(() => {
    if (!input.trim() || isStreaming || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;

    const userMessage = input.trim();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage, streaming: false },
    ]);
    setInput("");
    setIsStreaming(true);

    wsRef.current.send(JSON.stringify({ message: userMessage }));
    window.nox?.setThinkingState?.(true);
  }, [input, isStreaming]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleMicClick = () => {
    // Click mic to manually trigger listening (sends a voice_trigger event)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (micState === "idle") {
        wsRef.current.send(JSON.stringify({ type: "voice_trigger" }));
      }
    } else {
      addToast({ type: "warning", title: "Mikrofon", message: "Nicht mit Backend verbunden. Bitte warte bis Nox verbunden ist.", duration: 4000 });
    }
  };

  // Derived error states
  const ollamaDown = systemStatus?.ollama?.status === "error";
  const micAvailable = systemStatus?.microphone?.available !== false;
  const wakeModelMissing = systemStatus?.wake_word?.model_exists === false;
  const voiceDisabled = !micAvailable || wakeModelMissing;

  const checkOllamaStatus = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8420/health/ollama");
      const data = await res.json();
      setSystemStatus((prev) => ({ ...prev, ollama: { status: data.status === "ok" ? "ok" : "error", host: data.ollama_host, error: data.error } }));
    } catch (err) {
      addToast({ type: "warning", title: "Ollama", message: "Ollama-Status konnte nicht geprüft werden", detail: String(err), duration: 4000 });
    }
  };

  const micColors = {
    idle: { ring: "border-nox-border", bg: "bg-nox-surface", text: "text-nox-textDim" },
    listening: { ring: "border-red-500", bg: "bg-red-500/10", text: "text-red-500" },
    processing: { ring: "border-yellow-500", bg: "bg-yellow-500/10", text: "text-yellow-500" },
    speaking: { ring: "border-green-500", bg: "bg-green-500/10", text: "text-green-500" },
  };

  const animClass =
    animState === "animating-in"
      ? "animate-slide-in"
      : animState === "animating-out"
      ? "animate-slide-out"
      : "";

  const connColor =
    connectionStatus === "connected"
      ? "text-green-500"
      : connectionStatus === "connecting"
      ? "text-yellow-500"
      : "text-red-500";

  const connText =
    connectionStatus === "connected"
      ? t.app.connected
      : connectionStatus === "connecting"
      ? t.app.connecting
      : t.app.disconnected;

  const backendStarting = !backendReady && connectionStatus !== "connected";

  return (
    <div
      data-theme={theme}
      className={`h-full w-full rounded-2xl overflow-hidden nox-window-bg backdrop-blur-xl border border-nox-border ${animClass}`}
    >
      <div className="flex flex-col h-full">
        {showOnboarding ? (
          <OnboardingWizard locale={t} onLocaleChange={async (langCode) => {
            const loader = LOCALE_MAP[langCode];
            if (loader) {
              const mod = await loader();
              setLocaleData(mod.default);
            }
          }} onComplete={() => {
            setShowOnboarding(false);
            window.nox?.onboardingComplete?.();
          }} />
        ) : showSettings ? (
          <SettingsPanel locale={t} onClose={() => setShowSettings(false)} />
        ) : backendStarting ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-nox-border" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-nox-accent animate-spin" />
            </div>
            <div className="flex items-center gap-2">
              <img src={noxIcon} alt="Nox" className="w-5 h-5 rounded-full" />
              <span className="text-sm text-nox-textDim">{t.app.starting || "Nox wird gestartet…"}</span>
            </div>
          </div>
        ) : (
          <>
            {/* Title bar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 border-b border-nox-border"
              style={{ WebkitAppRegion: "drag" }}
            >
              <div className="flex items-center gap-2">
                <img src={noxIcon} alt="Nox" className="w-6 h-6 rounded-full" />
                <span className="text-sm font-medium text-nox-text">{t.app.name}</span>
              </div>
              <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" }}>
                <span className={`text-xs ${connColor}`}>● {connText}</span>
                <button
                  onClick={() => setShowSettings(true)}
                  className="text-nox-textDim hover:text-nox-text transition-colors p-1 rounded"
                  aria-label={t.settings.title}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {/* Ollama error banner */}
              {ollamaDown && (
                <div className="bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl px-3 py-2.5 text-xs flex items-center justify-between gap-2">
                  <span>{t.errors.ollamaDown}</span>
                  <button
                    onClick={checkOllamaStatus}
                    className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors whitespace-nowrap"
                  >
                    {t.errors.checkOllama}
                  </button>
                </div>
              )}

              {/* Wake word model missing warning */}
              {wakeModelMissing && (
                <div className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded-xl px-3 py-2.5 text-xs">
                  {t.errors.wakeModelMissing}
                </div>
              )}

              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <img src={noxIcon} alt="Nox" className="w-12 h-12 rounded-full opacity-80" />
                  <p className="text-nox-textDim text-sm">{t.app.placeholder}</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-nox-accent text-white rounded-br-md"
                        : msg.role === "error"
                        ? "bg-red-500/15 text-red-400 border border-red-500/30 rounded-bl-md"
                        : "bg-nox-surface text-nox-text rounded-bl-md"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <img src={noxIcon} alt="Nox" className="w-5 h-5 rounded-full mb-1 inline-block mr-1.5 align-middle" />
                    )}
                    {msg.content}
                    {msg.streaming && (
                      <span className="inline-block w-1.5 h-4 ml-0.5 bg-nox-accent animate-pulse rounded-sm" />
                    )}
                    {msg.role === "assistant" && !msg.streaming && msg.content && (
                      <button
                        onClick={() => speakText(msg.content, addToast)}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-nox-textDim hover:text-nox-accent transition-colors align-middle"
                        title="Vorlesen"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
                <div className="flex justify-start">
                  <div className="bg-nox-surface rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-nox-textDim mr-1">{t.app.thinking}</span>
                      <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-textDim" />
                      <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-textDim" />
                      <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-textDim" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div className="px-4 py-3 border-t border-nox-border">
              <div className="flex items-end gap-2">
                {/* Mic button */}
                <button
                  onClick={handleMicClick}
                  disabled={voiceDisabled}
                  className={`flex-shrink-0 w-9 h-9 rounded-full border-2 ${micColors[micState].ring} ${micColors[micState].bg} ${micColors[micState].text} flex items-center justify-center transition-all ${voiceDisabled ? "opacity-30 cursor-not-allowed" : "hover:scale-105"}`}
                  aria-label={voiceDisabled ? t.errors.micUnavailable : t.mic[micState]}
                  title={voiceDisabled ? t.errors.micUnavailable : t.mic[micState]}
                >
                  {micState === "speaking" ? (
                    // Speaker/sound wave icon
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  ) : micState === "processing" ? (
                    // Processing gear icon
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ animationDuration: "2s" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    // Microphone icon
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                    </svg>
                  )}
                </button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t.app.inputPlaceholder}
                  rows={1}
                  className="flex-1 bg-nox-surface text-nox-text text-sm px-3 py-2 rounded-xl border border-nox-border focus:border-nox-accent focus:outline-none resize-none max-h-32"
                  disabled={isStreaming}
                />

                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming || connectionStatus !== "connected"}
                  className="flex-shrink-0 w-9 h-9 rounded-full bg-nox-accent hover:bg-nox-accentHover disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                  aria-label={t.app.send}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
