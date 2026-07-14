import React, { useState, useRef, useEffect, useCallback } from "react";
import SettingsPanel from "./components/SettingsPanel.jsx";
import OnboardingWizard from "./components/OnboardingWizard.jsx";
import MusicCard from "./components/MusicCard.jsx";
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

  // Notify Electron when voice/thinking state changes so window stays visible
  useEffect(() => {
    window.nox?.setVoiceState?.(micState === "listening" || micState === "speaking");
  }, [micState]);
  useEffect(() => {
    window.nox?.setThinkingState?.(isStreaming);
  }, [isStreaming]);
  const [animState, setAnimState] = useState("visible"); // hidden | animating-in | visible | animating-out
  const [systemStatus, setSystemStatus] = useState(null); // null = not fetched yet
  const [backendReady, setBackendReady] = useState(false);
  const [localeData, setLocaleData] = useState(deLocale);
  const [contextPaused, setContextPaused] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const [thinkingOpacity, setThinkingOpacity] = useState(1);
  const [uiScale, setUiScale] = useState(1.0);
  const [musicResult, setMusicResult] = useState(null);
  const [speakProgress, setSpeakProgress] = useState(0); // words highlighted during speaking
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

  // Fetch ui_scale from backend settings
  useEffect(() => {
    const fetchScale = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (data.status === "ok" && data.settings?.ui_scale) {
          const scale = parseFloat(data.settings.ui_scale);
          if (!isNaN(scale) && scale >= 0.7 && scale <= 1.6) {
            setUiScale(scale);
            window.nox?.resizeWindow?.(scale);
          }
        }
      } catch {}
    };
    fetchScale();
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
            setShowSettings(false);
            setShowOnboarding(false);
            window.nox?.showWindow?.();
          }
          return;
        }

        // Eye context events
        if (data.type === "eye_event") {
          setContextPaused(data.state === "paused");
          return;
        }

        // Voice transcript shown as user message
        if (data.type === "user_message") {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: data.content, streaming: false, voice: data.voice_input },
          ]);
          setIsStreaming(true);
          setMusicResult(null); // clear music card when user asks something new
          window.nox?.setThinkingState?.(true);
          return;
        }

        if (data.type === "music_result") {
          setMusicResult(data);
          return;
        }

        if (data.type === "tool_start") {
          setActiveTool(data.tool || null);
          // Clear the current streaming assistant message (tool-call text)
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          return;
        }

        if (data.type === "tool_result") {
          setActiveTool(null);
          return;
        }

        if (data.type === "token") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
            }
            return [
              ...prev,
              { role: "assistant", content: data.content, streaming: true },
            ];
          });
        } else if (data.type === "done") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, streaming: false }];
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          window.nox?.setThinkingState?.(false);
        } else if (data.type === "aborted") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          setMusicResult(null);
          window.nox?.setThinkingState?.(false);
        } else if (data.type === "error") {
          setMessages((prev) => [
            ...prev,
            { role: "error", content: data.content, streaming: false },
          ]);
          setIsStreaming(false);
          setActiveTool(null);
          window.nox?.setThinkingState?.(false);
          addToast({ type: "error", title: "Nox", message: data.content, reportable: true });
        } else if (data.type === "close_window") {
          window.nox?.hideWindow?.();
        } else if (data.type === "quit_app") {
          window.nox?.closeApp?.();
        } else if (data.type === "timer_alert") {
          const msg = data.message || "Timer abgelaufen!";
          addToast({ type: "info", title: "Nox Timer", message: msg });
          window.nox?.showWindow?.();
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
        } else if (data.status === "ok" && data.settings.onboarding_completed) {
          // Onboarding already done — tell Electron it can hide normally
          window.nox?.onboardingNotNeeded?.();
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
    if (nox.onUpdateAvailable) {
      nox.onUpdateAvailable((info) => {
        setUpdateInfo(info);
        setUpdateDismissed(false);
      });
    }
    if (nox.onUpdateProgress) {
      nox.onUpdateProgress((progress) => {
        setUpdateProgress(progress);
      });
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

  const handleOpenMusicUrl = (url, platform) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setMusicResult((prev) => (prev ? { ...prev, opened_platform: platform } : prev));
  };

  const handleSetMusicPlatform = async (platform) => {
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { music_platform: platform } }),
      });
    } catch (err) {
      console.error("Failed to save music platform:", err);
    }
  };

  const handleMicClick = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (micState === "idle") {
        wsRef.current.send(JSON.stringify({ type: "voice_trigger" }));
      }
    } else {
      addToast({ type: "warning", title: "Mikrofon", message: "Nicht mit Backend verbunden. Bitte warte bis Nox verbunden ist.", duration: 4000 });
    }
  };

  const toggleContext = async () => {
    try {
      const endpoint = contextPaused ? "/eye/resume" : "/eye/pause";
      await fetch(`${API_BASE}${endpoint}`, { method: "POST" });
      setContextPaused(!contextPaused);
    } catch (err) {
      addToast({ type: "warning", title: "Kontext", message: "Kontext-Erfassung konnte nicht umgeschaltet werden", duration: 4000 });
    }
  };

  const handleRemember = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message: "Speichere eine Notiz für mich." }));
      setMessages((prev) => [...prev, { role: "user", content: "Speichere eine Notiz für mich.", streaming: false }]);
      setIsStreaming(true);
    }
  };

  const handleFiles = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message: "Welche Dateien hast du indiziert?" }));
      setMessages((prev) => [...prev, { role: "user", content: "Welche Dateien hast du indiziert?", streaming: false }]);
      setIsStreaming(true);
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

  const isActive = micState !== "idle" || isStreaming;

  // Latest assistant response
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  // Rotating thinking messages
  const THINKING_MESSAGES = [
    "Nox denkt nach…",
    "Nox überlegt…",
    "Nox sammelt Gedanken…",
    "Nox formt eine Antwort…",
    "Nox strukturiert Ideen…",
    "Nox wählt die richtigen Worte…",
  ];

  const TOOL_MESSAGES = {
    musik_erkennen: "Nox hört zu…",
    bildschirm_lesen: "Nox liest den Bildschirm…",
    screenshot_historie: "Nox durchwühlt die Bildschirm-Historie…",
    dateien_suchen: "Nox sucht nach Dateien…",
    datei_lesen: "Nox liest eine Datei…",
    kontext_suche: "Nox durchsucht den Kontext…",
    notiz_speichern: "Nox speichert eine Notiz…",
    aktuelle_uhrzeit: "Nox schaut auf die Uhr…",
    einstellungen_lesen: "Nox liest Einstellungen…",
    einstellung_aendern: "Nox ändert eine Einstellung…",
    app_oeffnen: "Nox öffnet eine App…",
    system_steuerung: "Nox steuert das System…",
    lautstaerke: "Nox passt die Lautstärke an…",
    search_web: "Nox durchsucht das Web…",
    website_oeffnen: "Nox öffnet eine Website…",
    fenster_fokus: "Nox wechselt das Fenster…",
    timer_stellen: "Nox stellt einen Timer…",
    erinnerung_speichern: "Nox speichert eine Erinnerung…",
    zwischenablage: "Nox nutzt die Zwischenablage…",
    fenster_schliessen: "Nox macht das Fenster zu…",
    nox_beenden: "Nox verabschiedet sich…",
  };

  // Rotate thinking messages every 4 seconds with a smooth fade transition
  useEffect(() => {
    if (micState !== "processing" && !(isStreaming && !lastAssistant)) {
      setThinkingIndex(0);
      setThinkingOpacity(1);
      return;
    }

    let mounted = true;
    const interval = setInterval(() => {
      if (!mounted) return;
      setThinkingOpacity(0);
      setTimeout(() => {
        if (!mounted) return;
        setThinkingIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
        setThinkingOpacity(1);
      }, 300);
    }, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [micState, isStreaming]);

  // Read-along effect: progressively highlight words as Nox speaks
  useEffect(() => {
    if (micState !== "speaking") {
      setSpeakProgress(0);
      return;
    }
    const text = lastAssistant?.content || "";
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setSpeakProgress(0);
      return;
    }
    // Estimate ~3.5 words per second for German TTS
    const msPerWord = 1000 / 3.5;
    setSpeakProgress(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      if (i >= words.length) {
        setSpeakProgress(words.length);
        clearInterval(interval);
      } else {
        setSpeakProgress(i);
      }
    }, msPerWord);
    return () => clearInterval(interval);
  }, [micState, lastAssistant?.content]);

  // Status text shown in the speech bubble
  const bubbleText = (() => {
    if (micState === "listening") return null; // No bubble while just listening — logo only
    // Tool messages take priority — show regardless of streaming/processing state
    if (activeTool && TOOL_MESSAGES[activeTool]) {
      return TOOL_MESSAGES[activeTool];
    }
    if (micState === "processing" || (isStreaming && !lastAssistant)) {
      return THINKING_MESSAGES[thinkingIndex];
    }
    if (micState === "speaking") return lastAssistant?.content || t.app.speaking || "Ich antworte…";
    if (lastAssistant?.content) return lastAssistant.content;
    return null;
  })();

  const showBubble = bubbleText !== null || musicResult !== null;

  // Logo state classes for animation
  const logoAnimClass = micState === "listening"
    ? "orb-listening"
    : micState === "processing"
    ? "orb-thinking"
    : micState === "speaking"
    ? "orb-speaking"
    : "orb-idle";

  return (
    <div
      data-theme={theme}
      className={`h-full w-full overflow-hidden ${animClass}`}
      style={{ background: "transparent", zoom: uiScale }}
    >
      {showOnboarding ? (
        <div className="h-full w-full rounded-2xl overflow-hidden nox-window-bg backdrop-blur-xl border border-nox-border">
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
        </div>
      ) : showSettings ? (
        <div className="h-full w-full rounded-2xl overflow-hidden nox-window-bg backdrop-blur-xl border border-nox-border">
          <SettingsPanel locale={t} onClose={() => setShowSettings(false)} onLocaleChange={async (langCode) => {
          const loader = LOCALE_MAP[langCode];
          if (loader) {
            const mod = await loader();
            setLocaleData(mod.default);
          }
        }} onUiScaleChange={(scale) => {
          setUiScale(scale);
          window.nox?.resizeWindow?.(scale);
        }} />
        </div>
      ) : backendStarting ? (
        <div className="flex flex-col items-center justify-end h-full pb-6 gap-3">
          <img
            src={noxIcon}
            alt="Nox"
            className="w-10 h-10 rounded-full orb-idle"
          />
          <span className="text-xs text-nox-textDim">{t.app.starting || "Nox wird gestartet…"}</span>
        </div>
      ) : (
        <div className="relative h-full w-full">
          {/* Update banner */}
          {updateInfo && !updateDismissed && !updateProgress && (
            <div className="absolute top-3 right-3 left-3 nox-console-card px-3 py-2.5 border-l-2 border-l-nox-accent animate-bubble-in">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-nox-accent flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6.364 1.636l-.707.707M20 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="nox-label text-nox-accent">
                    Update verfügbar — v{updateInfo.latestVersion}
                  </div>
                  <div className="text-[10px] text-nox-text-dim mt-0.5">
                    Aktuell: v{updateInfo.currentVersion}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={async () => {
                        const result = await window.nox?.downloadAndInstallUpdate?.();
                        if (result?.error) {
                          addToast({ type: "error", title: "Update", message: result.error, duration: 5000 });
                        }
                      }}
                      className="nox-btn-primary px-3 py-1 text-[10px]"
                    >
                      Herunterladen
                    </button>
                    <button
                      onClick={() => window.nox?.openReleasePage?.()}
                      className="nox-btn-secondary px-3 py-1 text-[10px]"
                    >
                      Details
                    </button>
                    <button
                      onClick={() => setUpdateDismissed(true)}
                      className="nox-btn-secondary px-3 py-1 text-[10px] ml-auto border-none hover:text-nox-text"
                    >
                      Später
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Update download progress */}
          {updateProgress && (
            <div className="absolute top-3 right-3 left-3 nox-console-card px-3 py-2.5 border-l-2 border-l-nox-accent">
              <div className="nox-label text-nox-accent mb-1.5">
                Update wird heruntergeladen… {updateProgress.percent}%
              </div>
              <div className="w-full h-1.5 bg-nox-surface rounded-sm overflow-hidden">
                <div
                  className="h-full bg-nox-accent rounded-sm transition-all duration-300"
                  style={{ width: `${updateProgress.percent}%` }}
                />
              </div>
              <div className="text-[10px] text-nox-text-dim mt-1">
                {(updateProgress.received / 1048576).toFixed(1)} / {(updateProgress.total / 1048576).toFixed(1)} MB
              </div>
            </div>
          )}
          {/* Error toasts — minimal, bottom area */}
          {!isActive && (ollamaDown || wakeModelMissing) && (
            <div className="absolute bottom-20 right-3 left-3 space-y-1.5">
              {ollamaDown && (
                <div className="nox-console-card text-nox-red px-3 py-2 text-xs flex items-center justify-between gap-2 border-l-2 border-l-nox-red">
                  <span>{t.errors.ollamaDown}</span>
                  <button
                    onClick={checkOllamaStatus}
                    className="nox-btn-secondary px-2 py-0.5 text-[10px] border-nox-red/30 text-nox-red hover:bg-nox-red/10 hover:border-nox-red/50"
                  >
                    {t.errors.checkOllama}
                  </button>
                </div>
              )}
              {wakeModelMissing && (
                <div className="nox-console-card text-nox-amber px-3 py-2 text-xs border-l-2 border-l-nox-amber">
                  {t.errors.wakeModelMissing}
                </div>
              )}
            </div>
          )}

          {/* Speech bubble — appears above the logo */}
          {showBubble && (
            <div className="absolute bottom-16 right-3 left-3 flex justify-end animate-bubble-in">
              <div className="nox-console-card px-4 py-3 max-w-[90%] border-l-2 border-l-nox-accent">
                {/* Nox header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="nox-status-dot" />
                  <span className="nox-label">Nox</span>
                  {micState === "processing" || activeTool ? (
                    <div className="flex items-center gap-0.5 ml-auto">
                      <span className="thinking-dot w-1 h-1 rounded-full bg-nox-textDim" />
                      <span className="thinking-dot w-1 h-1 rounded-full bg-nox-textDim" />
                      <span className="thinking-dot w-1 h-1 rounded-full bg-nox-textDim" />
                    </div>
                  ) : null}
                </div>
                {/* Bubble content */}
                <div
                  className="text-sm leading-relaxed text-nox-text whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
                  ref={messagesEndRef}
                >
                  {bubbleText && (micState === "processing" || (isStreaming && !lastAssistant)) && !activeTool ? (
                    <span
                      className="transition-opacity duration-300 ease-in-out"
                      style={{ opacity: thinkingOpacity }}
                    >
                      {bubbleText}
                    </span>
                  ) : activeTool && bubbleText ? (
                    <span className="transition-opacity duration-300 ease-in-out" style={{ opacity: thinkingOpacity }}>
                      {bubbleText}
                    </span>
                  ) : micState === "speaking" && bubbleText ? (
                    <ReadAlongText text={bubbleText} progress={speakProgress} />
                  ) : (
                    <span>{bubbleText}</span>
                  )}
                  {isStreaming && lastAssistant?.streaming && (
                    <span className="inline-block w-1.5 h-4 ml-0.5 bg-nox-accent animate-pulse rounded-sm align-middle" />
                  )}
                  {musicResult && (
                    <div className="mt-2">
                      <MusicCard
                        data={musicResult}
                        onOpen={handleOpenMusicUrl}
                        onSetPlatform={handleSetMusicPlatform}
                        locale={t}
                      />
                    </div>
                  )}
                </div>
                {/* Replay button when response is done */}
                {micState === "idle" && lastAssistant?.content && !lastAssistant?.streaming && (
                  <div className="mt-3">
                    <button
                      onClick={() => speakText(lastAssistant.content, addToast)}
                      className="nox-btn-secondary px-3 py-1.5 inline-flex items-center gap-1.5"
                      title="Vorlesen"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      Vorlesen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Nox Logo — bottom right corner, animated by state */}
          <button
            onClick={handleMicClick}
            disabled={voiceDisabled}
            className={`absolute bottom-3 right-3 rounded-full ${logoAnimClass} ${
              voiceDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-110"
            } transition-transform`}
            style={{
              width: 40,
              height: 40,
              background: `radial-gradient(circle at 35% 35%, var(--nox-accent-hover), var(--nox-accent) 60%, color-mix(in srgb, var(--nox-accent) 50%, black) 100%)`,
              border: "none",
            }}
            aria-label="Nox"
          >
            <img
              src={noxIcon}
              alt="Nox"
              className="w-full h-full rounded-full object-cover"
              style={{ pointerEvents: "none" }}
            />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;

function ReadAlongText({ text, progress }) {
  const words = text.split(/(\s+)/);
  let wordIndex = 0;
  return (
    <span>
      {words.map((part, i) => {
        if (/^\s+$/.test(part)) {
          return part;
        }
        const idx = wordIndex++;
        const isRead = idx < progress;
        return (
          <span
            key={i}
            className="transition-colors duration-300"
            style={{ color: isRead ? "var(--nox-text)" : "var(--nox-text-dim)" }}
          >
            {part}
          </span>
        );
      })}
    </span>
  );
}
