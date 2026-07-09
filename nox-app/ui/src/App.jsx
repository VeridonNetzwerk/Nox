import React, { useState, useRef, useEffect, useCallback } from "react";
import SettingsPanel from "./components/SettingsPanel.jsx";
import OnboardingWizard from "./components/OnboardingWizard.jsx";
import localeData from "./locales/de.json";
import noxIcon from "./assets/nox-icon.png";

const WS_URL = "ws://127.0.0.1:8420/ws/chat";
const API_BASE = "http://127.0.0.1:8420";

async function speakText(text) {
  try {
    await fetch(`${API_BASE}/api/tts/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("TTS speak failed:", err);
  }
}

function App() {
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
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const t = localeData;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // WebSocket connection
  const wsReconnectRef = useRef(0);
  useEffect(() => {
    let destroyed = false;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("connected");
        setBackendReady(true);
        wsReconnectRef.current = 0;
      };
      ws.onclose = () => {
        if (destroyed) return;
        setConnectionStatus("disconnected");
        // Exponential backoff: 2s, 4s, 8s, max 15s
        const delay = Math.min(2000 * Math.pow(2, wsReconnectRef.current), 15000);
        wsReconnectRef.current++;
        setTimeout(connect, delay);
      };
      ws.onerror = () => setConnectionStatus("error");

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

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
        }
      };
    };

    connect();
    return () => {
      destroyed = true;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Fetch system status on mount + periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8420/api/status");
        const data = await res.json();
        if (data.status === "ok") setSystemStatus(data);
      } catch (err) {
        console.error("Status fetch failed:", err);
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
      } catch (err) {
        if (cancelled) return;
        console.error("Onboarding check failed:", err);
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
      console.error("Ollama status check failed:", err);
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
          <OnboardingWizard locale={t} onComplete={() => {
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
                        onClick={() => speakText(msg.content)}
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
