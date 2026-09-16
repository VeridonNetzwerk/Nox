import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import SettingsPanel from "../settings/SettingsPanel.jsx";
import Marketplace from "./Marketplace.jsx";
import OnboardingWizard from "../onboarding/OnboardingWizard.jsx";
import SetupScreen from "../onboarding/SetupScreen.jsx";
import MusicCard from "../common/MusicCard.jsx";
import AudioEqualizer from "../common/AudioEqualizer.jsx";
import ImageCard from "../common/ImageCard.jsx";
import WeatherCard from "../common/WeatherCard.jsx";
import SearchStream from "../common/SearchStream.jsx";
import ProfilePanel from "../common/ProfilePanel.jsx";
import Callout from "../common/Callout.jsx";
import NoxSidebar from "./NoxSidebar.jsx";
import { useToast } from "../common/Toast.jsx";
import NoxAvatar from "../common/NoxAvatar.jsx";
import LoadingScreen from "../common/LoadingScreen.jsx";
import deLocale from "../../locales/de.json";
import { API_BASE, speakText, loadLocaleData } from "../../shared/constants.jsx";
import { IconWarning, IconCheck, IconArrowLeft } from "../../shared/Icon.jsx";
import { prettyModelName } from "../../shared/prettyNames.jsx";
import { MODEL_TABLE } from "../../shared/modelTable.js";

import ChatMessage from "./ChatMessage.jsx";
import { MODE_KEYS, MODEL_TO_MODES, SLASH_COMMANDS } from "./constants.js";
import { useModels } from "./hooks/useModels.js";
import { useLocale } from "./hooks/useLocale.js";
import { useSystemStatus } from "./hooks/useSystemStatus.js";
import { useTokenBatching } from "./hooks/useTokenBatching.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useSessions } from "./hooks/useSessions.js";

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ activeView, onNavigate, onNewChat, onOpenSettings, onOpenSidebar, connectionStatus, t }) {
  const connColor = connectionStatus === "connected" ? "bg-green-500 dark:bg-green-400" : connectionStatus === "connecting" ? "bg-yellow-500 dark:bg-yellow-400" : "bg-red-500 dark:bg-red-400";

  const navItems = [
    { id: "chat", icon: ChatIcon, label: "Chat" },
  ];

  return (
    <div className="flex flex-col items-center py-3 px-2 gap-1 w-14 flex-shrink-0 border-r border-nox-border bg-nox-surface/40 backdrop-blur-xl" style={{ position: 'relative', zIndex: 1 }}>
      <div
        className="mb-3 group relative cursor-pointer"
        onClick={onOpenSidebar}
        title="Seitenleiste öffnen"
      >
        <NoxAvatar size={32} className="orb-idle" />
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-2 bg-nox-surface-raised text-nox-text text-xs px-2.5 py-1.5 rounded-xl border border-nox-border shadow-lg whitespace-nowrap z-30 backdrop-blur-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-nox-accent">
            <path d="M8 5v14l11-7z" />
          </svg>
          Seitenleiste öffnen
        </div>
      </div>

      <button
        onClick={onNewChat}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors mb-1"
        title="Neuer Chat"
      >
        <PlusIcon />
      </button>

      <button
        onClick={onOpenSidebar}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors mb-1"
        title="Chats durchsuchen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            activeView === item.id
              ? "text-nox-accent bg-nox-surface-hover"
              : "text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover"
          }`}
          title={item.label}
        >
          <item.icon />
        </button>
      ))}

      <div className="flex-1" />

      <div className="flex items-center justify-center w-10 h-6" title={connectionStatus}>
        <span className={`w-1.5 h-1.5 rounded-full ${connColor}`} style={{
          boxShadow: connectionStatus === "connected" ? "0 0 6px rgba(74, 222, 128, 0.6)" : "none"
        }} />
      </div>

      <button
        onClick={onOpenSettings}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors"
        title="Einstellungen"
      >
        <SettingsIcon />
      </button>
    </div>
  );
}

// ── Small inline icons ──────────────────────────────────────────────────────

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const SpeakIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);
const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const MicActiveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);

// ── Main app component ─────────────────────────────────────────────────────

export default function MainApp() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [skin, setSkin] = useState("aurora");
  const [showSettings, setShowSettings] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [localeData, setLocaleData] = useState(deLocale);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [searchStreams, setSearchStreams] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [musicResult, setMusicResult] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [weatherResult, setWeatherResult] = useState(null);
  const [weatherText, setWeatherText] = useState(null);
  const [activeView, setActiveView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plusDropdownOpen, setPlusDropdownOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [username, setUsername] = useState("");

  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const isStreamingRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  const streamingTimerRef = useRef(null);
  const plusDropdownRef = useRef(null);
  const fileInputRefActual = useRef(null);
  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const chatContentRef = useRef(null);
  const inputRef = useRef(null);
  const t = localeData;

  const msgIdRef = useRef(0);
  const nextMsgId = useCallback(() => `msg-${++msgIdRef.current}`, []);

  // Hooks
  const models = useModels(addToast);
  const { applyLocale } = useLocale();
  const system = useSystemStatus(addToast);
  const { flushTokens, bufferToken, flushNow } = useTokenBatching(setMessages, nextMsgId);
  const sessions = useSessions(addToast, nextMsgId);

  const { wsRef } = useWebSocket({
    setConnectionStatus: system.setConnectionStatus,
    setBackendReady: system.setBackendReady,
    setMicState: system.setMicState,
    setShowSettings,
    setShowOnboarding: system.setShowOnboarding,
    setMessages,
    setIsStreaming,
    setInput,
    inputRef,
    setMusicResult,
    setImageResult,
    setWeatherResult,
    setWeatherText,
    setActiveTool,
    setSearchStreams,
    setChatSessions: sessions.setChatSessions,
    setRecentConversations: sessions.setRecentConversations,
    setCurrentModel: models.setCurrentModel,
    setCurrentModelMode: models.setCurrentModelMode,
    addToast,
    nextMsgId,
    flushTokens,
    flushNow,
    bufferToken,
    messagesRef,
    activeSessionRef: sessions.activeSessionRef,
    streamingTimerRef,
    hasConnectedOnceRef: system.hasConnectedOnceRef,
  });

  const stableCopy = useCallback((text) => { navigator.clipboard?.writeText(text); }, []);
  const stableSpeak = useCallback((text) => { speakText(text, addToast); }, [addToast]);
  const stablePin = useCallback((msg) => {
    setPinnedMessages((prev) => {
      const exists = prev.some((m) => m.content === msg.content && m.role === msg.role);
      if (exists) return prev.filter((m) => !(m.content === msg.content && m.role === msg.role));
      return [...prev, { role: msg.role, content: msg.content, timestamp: new Date().toISOString() }];
    });
  }, []);

  const pinnedKeys = useMemo(() => {
    const s = new Set();
    for (const m of pinnedMessages) s.add(`${m.role}|${m.content}`);
    return s;
  }, [pinnedMessages]);

  useEffect(() => {
    loadLocaleData().then(setLocaleData);
  }, []);

  useEffect(() => {
    sessions.fetchRecentConversations(system.backendReady);
  }, [system.backendReady]);

  useEffect(() => {
    fetch(`${API_BASE}/api/username`)
      .then(r => r.json())
      .then(data => { if (data.username) setUsername(data.username); })
      .catch(() => {});
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
  }, []);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || el.scrollHeight - el.scrollTop - el.clientHeight > 160) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = chatScrollRef.current;
    const content = chatContentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (models.modelDropdownRef.current && !models.modelDropdownRef.current.contains(e.target)) {
        models.setModelDropdownOpen(false);
      }
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target)) {
        setPlusDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.skin = skin;
  }, [theme, skin]);

  useEffect(() => {
    const nox = window.nox;
    if (!nox) return;
    if (nox.onThemeChanged) nox.onThemeChanged((t) => setTheme(t));
    if (nox.onSkinChanged) nox.onSkinChanged((s) => setSkin(s));
    if (nox.onOpenSettings) nox.onOpenSettings(() => setShowSettings(true));
    if (nox.onUpdateAvailable) {
      nox.onUpdateAvailable((info) => {
        setUpdateInfo(info);
        setUpdateDismissed(false);
      });
    }
    if (nox.onUpdateProgress) {
      nox.onUpdateProgress((progress) => setUpdateProgress(progress));
    }
  }, []);

  const sessionState = {
    chatSessions: sessions.chatSessions,
    activeSession: sessions.activeSession,
    messages,
    musicResult,
    imageResult,
    weatherResult,
    weatherText,
    setMessages,
    setMusicResult,
    setImageResult,
    setWeatherResult,
    setWeatherText,
    setActiveTool,
    setSearchStreams,
    setInput,
  };

  const handleNewChat = () => {
    sessions.addNewSession(sessionState);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      fetch(`${API_BASE}/api/conversation/new`, { method: "POST" });
    }
  };

  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      const inInput = tag === "input" || tag === "textarea";

      if (e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        handleNewChat();
      } else if (e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        setShowSettings((v) => !v);
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleStopGeneration();
      } else if (e.key === "/" && !inInput) {
        e.preventDefault();
        inputRef.current?.focus();
        setInput("/");
        setSlashMenuOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sendMessageWithText = useCallback((text) => {
    const userMessage = text.trim();
    if (!userMessage || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isStreaming) return;

    if (sessions.chatSessions.length === 0) {
      sessions.setChatSessions([{ id: `session-${Date.now()}`, label: "Chat 1", messages: [], musicResult: null, imageResult: null, weatherResult: null, weatherText: null, conversationId: null }]);
      sessions.setActiveSession(0);
    }

    if (userMessage === "__BRIEF__") {
      setInput("");
      setMessages((prev) => [...prev, { id: nextMsgId(), role: "user", content: "📋 Tägliches Briefing", streaming: false }]);
      setMessages((prev) => [...prev, { id: nextMsgId(), role: "assistant", content: "Briefing wird generiert…", streaming: true }]);
      setIsStreaming(true);
      fetch(`${API_BASE}/api/brief`)
        .then(r => r.json())
        .then(data => {
          if (data.status === "ok") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.streaming) {
                return [...prev.slice(0, -1), { ...last, content: data.brief, streaming: false }];
              }
              return prev;
            });
          } else {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.streaming) {
                return [...prev.slice(0, -1), { ...last, content: "Briefing konnte nicht generiert werden.", streaming: false }];
              }
              return prev;
            });
          }
          setIsStreaming(false);
        })
        .catch(() => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [...prev.slice(0, -1), { ...last, content: "Briefing fehlgeschlagen – Backend nicht erreichbar.", streaming: false }];
            }
            return prev;
          });
          setIsStreaming(false);
        });
      return;
    }

    setMessages((prev) => [...prev, { id: nextMsgId(), role: "user", content: userMessage, streaming: false }]);
    setInput("");
    setIsStreaming(true);
    requestAnimationFrame(() => scrollToBottom(true));

    if (sessions.chatSessions[sessions.activeSession]?.label?.startsWith("Chat ")) {
      const label = userMessage.slice(0, 30) + (userMessage.length > 30 ? "…" : "");
      sessions.setChatSessions((prev) => {
        const updated = [...prev];
        updated[sessions.activeSession] = { ...updated[sessions.activeSession], label };
        return updated;
      });
    }

    if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
    streamingTimerRef.current = setTimeout(() => {
      setIsStreaming(false);
      system.setMicState("idle");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false, content: last.content + "\n\n⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen." }];
        }
        return [...prev, { id: nextMsgId(), role: "assistant", content: "⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen.", streaming: false }];
      });
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "abort" }));
      }
      addToast({ type: "warning", title: "Timeout", message: "Die KI hat zu lange gebraucht. Abgebrochen.", duration: 5000 });
    }, 120000);

    wsRef.current.send(JSON.stringify({
      message: userMessage,
      think: thinkingEnabled,
    }));
  }, [isStreaming, thinkingEnabled, addToast, sessions]);

  const sendMessage = useCallback(() => {
    sendMessageWithText(input);
  }, [input, sendMessageWithText]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (slashMenuOpen) return;
      sendMessage();
    }
    if (e.key === "Escape" && slashMenuOpen) {
      setSlashMenuOpen(false);
      return;
    }
    if (slashMenuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
    }
  };

  const handleRegenerate = useCallback((msg, action, newIdx) => {
    if (action === 'switch') {
      setMessages((prev) => prev.map((m) => {
        if (m === msg) return { ...m, versionIndex: newIdx };
        return m;
      }));
      return;
    }

    if (isStreamingRef.current) return;
    const idx = messagesRef.current.findIndex((m) => m === msg);
    let lastUserMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messagesRef.current[i].role === "user") {
        lastUserMsg = messagesRef.current[i].content;
        break;
      }
    }
    if (!lastUserMsg) return;

    const currentVersions = msg.versions || [{ content: msg.content, stats: msg.stats, model: msg.model }];
    setMessages((prev) => prev.map((m) => {
      if (m === msg) {
        return {
          ...m,
          versions: currentVersions,
          versionIndex: currentVersions.length,
          content: "",
          streaming: true,
          stats: null,
          model: null,
        };
      }
      return m;
    }));
    setIsStreaming(true);
    if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
    streamingTimerRef.current = setTimeout(() => {
      setIsStreaming(false);
      system.setMicState("idle");
      addToast({ type: "warning", title: "Timeout", message: "Die KI hat zu lange gebraucht. Abgebrochen.", duration: 5000 });
    }, 120000);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message: lastUserMsg }));
    }
  }, [addToast]);

  const handleFeedback = useCallback((rating, responseContent) => {
    const idx = messagesRef.current.findIndex((m) => m.content === responseContent && m.role === "assistant");
    let userMessage = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (messagesRef.current[i].role === "user") {
        userMessage = messagesRef.current[i].content;
        break;
      }
    }
    fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage, response: responseContent, rating }),
    }).catch(() => {});
  }, []);

  const handleForkChat = useCallback((msg) => {
    const idx = messagesRef.current.findIndex((m) => m === msg);
    const forkedMessages = messagesRef.current.slice(0, idx + 1).map((m) => ({ ...m, id: nextMsgId(), streaming: false }));
    fetch(`${API_BASE}/api/conversation/new`, { method: "POST" }).catch(() => {});
    setMessages(forkedMessages);
    setMusicResult(null);
    setActiveTool(null);
    setSearchStreams([]);
    setInput("");
    addToast({ type: "info", title: "Neuer Chat", message: "Chat ab hier abgezweigt.", duration: 2000 });
  }, [addToast, nextMsgId]);

  const handleMicClick = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (system.micState === "idle" || system.micState === "processing" || system.micState === "speaking") {
        wsRef.current.send(JSON.stringify({ type: "voice_trigger" }));
      }
    } else {
      addToast({ type: "warning", title: "Mikrofon", message: "Nicht mit Backend verbunden.", duration: 4000 });
    }
  };

  const handleStopGeneration = () => {
    if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "abort" }));
    }
    setIsStreaming(false);
    system.setMicState("idle");
  };

  const handleOpenMusicUrl = (url, platform) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
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

  const ollamaDown = system.systemStatus?.ollama?.status === "error";
  const micAvailable = system.systemStatus?.microphone?.available !== false;
  const wakeModelMissing = system.systemStatus?.wake_word?.model_exists === false;
  const voiceDisabled = !micAvailable || wakeModelMissing;
  const backendStarting = !system.backendReady && system.connectionStatus !== "connected";

  const connText = system.connectionStatus === "connected" ? t.app?.connected || "Verbunden" : system.connectionStatus === "connecting" ? t.app?.connecting || "Verbinde…" : t.app?.disconnected || "Getrennt";

  // ── Render ──────────────────────────────────────────────────────────────

  if (system.showSetup) {
    return (
      <div data-theme={theme} data-skin={skin} className="h-full w-full flex items-center justify-center nox-window-bg">
        <div className="w-full max-w-2xl">
          <SetupScreen onComplete={() => {
            system.setShowSetup(false);
            setTimeout(() => window.location.reload(), 3000);
          }} />
        </div>
      </div>
    );
  }

  if (system.showOnboarding) {
    return (
      <div data-theme={theme} data-skin={skin} className="h-full w-full nox-window-bg">
        <OnboardingWizard locale={t} onLocaleChange={applyLocale} onComplete={() => {
          system.setShowOnboarding(false);
          window.nox?.onboardingComplete?.();
        }} />
      </div>
    );
  }

  if (backendStarting) {
    return <LoadingScreen backendReady={false} />;
  }

  if (showMarketplace) {
    return (
      <div data-theme={theme} data-skin={skin} className="h-full w-full nox-window-bg">
        <Marketplace onClose={() => setShowMarketplace(false)} />
        <NoxSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewChat={() => { setShowMarketplace(false); handleNewChat(); }}
          onSelectConversation={(id) => { setShowMarketplace(false); sessions.handleSelectConversation(id, sessionState); }}
          onOpenSettings={() => { setSidebarOpen(false); setShowSettings(true); }}
          onOpenMarketplace={() => {}}
        />
      </div>
    );
  }

  if (showSettings) {
    return (
      <div data-theme={theme} data-skin={skin} className="h-full w-full nox-window-bg">
        <SettingsPanel
          locale={t}
          onClose={() => setShowSettings(false)}
          onLocaleChange={applyLocale}
        />
      </div>
    );
  }

  return (
    <div data-theme={theme} data-skin={skin} className="h-full w-full flex nox-window-bg text-nox-text overflow-hidden">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onNewChat={handleNewChat}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSidebar={() => setSidebarOpen(true)}
        connectionStatus={system.connectionStatus}
        t={t}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-nox-border bg-nox-surface/30 backdrop-blur-xl" style={{ position: 'relative', zIndex: 1 }}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
              {sessions.chatSessions.map((session, idx) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-all flex-shrink-0 ${
                    idx === sessions.activeSession
                      ? "bg-nox-surface/80 text-nox-text backdrop-blur-sm shadow-sm"
                      : "text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover/50"
                  }`}
                  onClick={() => sessions.switchSession(idx, sessionState)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); sessions.closeSession(idx, sessionState); } }}
                >
                  <span className="truncate max-w-[80px]">{session.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); sessions.closeSession(idx, sessionState); }}
                    className="text-nox-textFaint hover:text-nox-red transition-colors text-[10px]"
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowProfile(true)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-accent hover:bg-nox-surface transition-colors"
              title="Mein Profil"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
            <span className="text-[10px] text-nox-textFaint font-mono">{connText}</span>
          </div>
        </div>

        {updateInfo && !updateDismissed && !updateProgress && (
          <div className="mx-4 mt-3 nox-console-card px-4 py-3 border-l-2 border-l-nox-accent animate-bubble-in">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="nox-label text-nox-accent">Update verfügbar — v{updateInfo.latestVersion}</div>
                <div className="text-xs text-nox-textDim mt-0.5">Aktuell: v{updateInfo.currentVersion}</div>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={async () => { const result = await window.nox?.downloadAndInstallUpdate?.(); if (result?.error) { addToast({ type: "error", title: "Update", message: result.error, duration: 5000 }); } }} className="nox-btn-primary px-3 py-1 text-[10px]">Herunterladen</button>
                  <button onClick={() => window.nox?.openReleasePage?.()} className="nox-btn-secondary px-3 py-1 text-[10px]">Details</button>
                  <button onClick={() => setUpdateDismissed(true)} className="nox-btn-secondary px-3 py-1 text-[10px] ml-auto border-none hover:text-nox-text">Später</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {updateProgress && (
          <div className="mx-4 mt-3 nox-console-card px-4 py-3 border-l-2 border-l-nox-accent">
            <div className="nox-label text-nox-accent mb-1.5">Update wird heruntergeladen… {updateProgress.percent}%</div>
            <div className="w-full h-1.5 bg-nox-surface rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${updateProgress.percent}%`, background: "var(--nox-gradient)" }} />
            </div>
            <div className="text-[10px] text-nox-textDim mt-1">{(updateProgress.received / 1048576).toFixed(1)} / {(updateProgress.total / 1048576).toFixed(1)} MB</div>
          </div>
        )}

        {!isStreaming && ollamaDown && (
          <Callout
            type="error"
            title={t.errors?.ollamaDown || "Ollama ist nicht erreichbar"}
            actionLabel={t.errors?.checkOllama || "Prüfen"}
            onAction={system.checkOllamaStatus}
            className="mx-4 mt-3"
          >
            Nox kann gerade keine Antworten generieren. Starte Ollama oder prüfe die Verbindung.
          </Callout>
        )}
        {!isStreaming && wakeModelMissing && (
          <Callout
            type="warning"
            title={t.errors?.wakeModelMissing || "Wake-Word-Modell fehlt"}
            className="mx-4 mt-3"
          >
            Die Sprachaktivierung ist deaktiviert. Text-Chat funktioniert weiterhin.
          </Callout>
        )}

        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {(messages.length === 0 || sessions.chatSessions.length === 0) && !backendStarting ? (
            <div className="h-full flex flex-col items-center justify-center gap-6">
              <div className="relative">
                <div className="absolute inset-0 blur-3xl opacity-40" style={{ background: "var(--nox-gradient-soft)" }} />
                <NoxAvatar size={64} className="orb-idle relative" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-display font-bold text-nox-text mb-1">
                  {username ? `Hallo ${username}, was steht an?` : "Was steht an?"}
                </h1>
                <p className="text-sm text-nox-textDim">Schreibe eine Nachricht oder klicke das Mikrofon für Spracheingabe.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {[
                  { label: "Was kannst du?", prompt: "Was kannst du?" },
                  { label: "📝 Notiz speichern", prompt: "Speichere mir folgende Notiz: " },
                  { label: "📁 Dateien durchsuchen", prompt: "Durchsuche meine Dateien nach: " },
                  { label: "🌤️ Wetter", prompt: "Wie ist das aktuelle Wetter?" },
                  { label: "🖼️ Bild generieren", prompt: "Generiere ein Bild von: " },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => { setInput(item.prompt); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 rounded-full text-xs text-nox-textDim border border-nox-border hover:border-nox-border-hover hover:text-nox-text hover:bg-nox-surface-hover transition-all backdrop-blur-sm"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {sessions.recentConversations.length > 0 && (
                <div className="w-full max-w-lg">
                  <div className="text-[11px] font-medium text-nox-textFaint uppercase tracking-wide mb-2 text-left px-1">Letzte Chats</div>
                  <div className="flex flex-col gap-1">
                    {sessions.recentConversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => sessions.handleSelectConversation(conv.id, sessionState)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors group"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-nox-textFaint flex-shrink-0 group-hover:text-nox-accent transition-colors"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        <span className="truncate flex-1">{conv.title || "Unbenannter Chat"}</span>
                        {conv.updated_at && (
                          <span className="text-[10px] text-nox-textFaint flex-shrink-0">
                            {new Date(conv.updated_at).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : backendStarting ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <NoxAvatar size={40} className="orb-idle" />
              <span className="text-xs text-nox-textDim">{t.app?.starting || "Nox wird gestartet…"}</span>
            </div>
          ) : (
            <div ref={chatContentRef} className="max-w-3xl mx-auto flex flex-col gap-4 pb-4">
              {pinnedMessages.length > 0 && (
                <div className="rounded-xl border border-nox-accent/30 bg-nox-accent/5 p-2 mb-2 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-nox-accent"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
                    <span className="text-[11px] font-medium text-nox-accent uppercase tracking-wide">Angepinnt</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {pinnedMessages.map((pm, idx) => (
                      <div key={idx} className="flex items-start gap-2 px-2 py-1 rounded text-xs text-nox-textDim hover:bg-nox-surface-hover/50 group">
                        <span className="flex-1 truncate cursor-pointer" onClick={() => navigator.clipboard?.writeText(pm.content)} title={pm.content}>{pm.content}</span>
                        <button
                          onClick={() => setPinnedMessages((prev) => prev.filter((_, i) => i !== idx))}
                          className="opacity-0 group-hover:opacity-100 text-nox-textFaint hover:text-nox-red transition-opacity flex-shrink-0"
                          title="Loslösen"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id || i}
                  msg={msg}
                  isLast={i === messages.length - 1}
                  onCopy={stableCopy}
                  onSpeak={stableSpeak}
                  onRegenerate={handleRegenerate}
                  onFeedback={handleFeedback}
                  onFork={handleForkChat}
                  onPin={stablePin}
                  isPinned={pinnedKeys.has(`${msg.role}|${msg.content}`)}
                  hasSources={msg.sources && msg.sources.length > 0}
                  addToast={addToast}
                  t={t}
                />
              ))}

              {musicResult && (
                <div className="max-w-3xl mx-auto w-full">
                  <MusicCard data={musicResult} onOpen={handleOpenMusicUrl} onSetPlatform={handleSetMusicPlatform} locale={t} />
                </div>
              )}

              {imageResult && (
                <div className="max-w-3xl mx-auto w-full">
                  <ImageCard data={imageResult} onClose={() => setImageResult(null)} addToast={addToast} />
                </div>
              )}

              {weatherResult && (
                <div className="max-w-3xl mx-auto w-full">
                  <WeatherCard data={weatherResult} />
                  {weatherText && (
                    <div className="flex items-center gap-1 ml-1 mt-1">
                      <button
                        onClick={() => { navigator.clipboard?.writeText(weatherText); addToast({ type: "info", title: "Kopiert", message: "Antwort in Zwischenablage kopiert", duration: 2000 }); }}
                        className="nox-action-btn"
                        title="Kopieren"
                      >
                        <CopyIcon />
                      </button>
                      <button
                        onClick={() => speakText(weatherText, addToast)}
                        className="nox-action-btn"
                        title="Vorlesen"
                      >
                        <SpeakIcon />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isStreaming && messages.length > 0 && !messages[messages.length - 1]?.streaming && (
                <div className="flex gap-3 animate-bubble-in">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
                    <NoxAvatar size={28} className="orb-thinking" />
                  </div>
                  <div className="flex items-center gap-1 bg-nox-surface/80 rounded-2xl rounded-tl-sm px-4 py-3 backdrop-blur-sm">
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                  </div>
                </div>
              )}

              {searchStreams.length > 0 && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7" />
                  <div className="flex-1 max-w-2xl">
                    <SearchStream
                      streams={searchStreams}
                      onClear={() => setSearchStreams([])}
                    />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto relative z-0">
            <div className={`nox-input-pill flex items-center gap-2 px-4 py-3 ${system.micState === "listening" ? "is-listening" : ""}`}>
              <div className="relative flex-shrink-0" ref={plusDropdownRef}>
                <button
                  onClick={() => setPlusDropdownOpen(!plusDropdownOpen)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors"
                  title="Anhängen"
                >
                  <PlusIcon />
                </button>
                {plusDropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-nox-surface-raised border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50 backdrop-blur-xl">
                    <button
                      onClick={() => { fileInputRefActual.current?.click(); setPlusDropdownOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors text-left"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                      Dateien oder Fotos hinzufügen
                    </button>
                    <button
                      onClick={() => {
                        setPlusDropdownOpen(false);
                        addToast({ type: "info", title: "Screenshot", message: "Screenshot-Funktion kommt bald", duration: 3000 });
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors text-left"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                      Screenshot aufnehmen
                    </button>
                    <div className="border-t border-nox-border my-1" />
                    <button
                      onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                      className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                        Websuche
                      </div>
                      {webSearchEnabled ? (
                        <svg className="w-4 h-4 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-nox-textDim/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      )}
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRefActual}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      addToast({ type: "info", title: "Dateien", message: `${files.length} Datei(en) ausgewählt – Upload kommt bald`, duration: 3000 });
                    }
                    e.target.value = "";
                  }}
                />
              </div>

              {system.micState === "listening" ? (
                <AudioEqualizer isTranscribing={false} />
              ) : system.micState === "processing" ? (
                <AudioEqualizer isTranscribing={true} />
              ) : (
                <div className="flex-1 relative">
                  {slashMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl bg-nox-surface-raised border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50 max-h-64 overflow-y-auto backdrop-blur-xl">
                      {SLASH_COMMANDS
                        .filter(c => !slashFilter || c.cmd.includes(slashFilter.toLowerCase()) || c.desc.toLowerCase().includes(slashFilter.toLowerCase()))
                        .map((sc) => (
                          <button
                            key={sc.cmd}
                            onClick={() => {
                              setSlashMenuOpen(false);
                              setSlashFilter("");
                              setInput("");
                              if (sc.prompt === "__BRIEF__") {
                                sendMessageWithText("__BRIEF__");
                              } else {
                                sendMessageWithText(sc.prompt);
                              }
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors text-left"
                          >
                            <span className="font-mono text-xs text-nox-accent w-28 flex-shrink-0">{sc.cmd}</span>
                            <span className="text-xs text-nox-textDim truncate">{sc.desc}</span>
                          </button>
                        ))}
                    </div>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => {
                      const val = e.target.value;
                      setInput(val);
                      if (val.startsWith("/") && !val.includes(" ")) {
                        setSlashFilter(val.slice(1));
                        setSlashMenuOpen(true);
                      } else {
                        setSlashMenuOpen(false);
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={isStreaming ? "Nächste Frage eingeben…" : "Frag Nox…  ( / für Befehle)"}
                    className="w-full bg-transparent text-sm text-nox-text placeholder-nox-textDim outline-none border-none"
                  />
                </div>
              )}

              <div className="relative flex-shrink-0" ref={models.modelDropdownRef}>
                <button
                  onClick={() => models.setModelDropdownOpen(!models.modelDropdownOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-all max-w-[220px]"
                  title={t.onboarding?.switchModel || "KI-Modell wechseln"}
                >
                  <span className="truncate">{prettyModelName(models.currentModel)}</span>
                  {models.currentModelMode && models.MODE_LABELS[models.currentModelMode] && (
                    <span className="text-nox-accent text-[10px] flex-shrink-0">{models.MODE_LABELS[models.currentModelMode]}</span>
                  )}
                  <svg className="w-3 h-3 flex-shrink-0 transition-transform" style={{ transform: models.modelDropdownOpen ? "rotate(180deg)" : "" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {models.modelDropdownOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 max-h-96 overflow-y-auto rounded-xl bg-nox-surface-raised border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50 backdrop-blur-xl">
                    {!models.showAllModels ? (
                      <>
                        <div className="px-3 py-1.5 text-[10px] text-nox-textDim uppercase tracking-wide border-b border-nox-border mb-1">
                          {t.onboarding?.recommended || "Empfohlen"} {models.gpuInfo?.vram_mb ? `· ${Math.round(models.gpuInfo.vram_mb / 1024)} GB VRAM` : ""}
                        </div>
                        {models.getRecommendedModels().map((rec) => {
                          const recId = models.engineModelId(rec.model);
                          const installed = models.isModelInstalled(recId);
                          const isCurrent = models.currentModel === recId
                            || (models.modelsBackendTypeRef.current !== "llama_cpp" && models.currentModel && models.currentModel.startsWith(rec.model));
                          const isPulling = models.pullState.running && (models.pullState.model === rec.model || models.pullState.model === recId);
                          return (
                            <div
                              key={rec.modeKey}
                              className={`px-3 py-2 transition-colors ${isCurrent ? "bg-nox-accent/10" : "hover:bg-nox-border/50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  onClick={() => installed && models.handleModelSwitch(recId, rec.modeKey)}
                                  disabled={!installed}
                                  className={`flex items-center gap-2 min-w-0 flex-1 text-left ${installed ? "cursor-pointer" : "cursor-default"}`}
                                >
                                  <span className="text-xs flex-shrink-0 text-nox-textDim">{models.MODE_LABELS[rec.modeKey]}</span>
                                  <div className="min-w-0">
                                    <div className={`text-sm truncate ${isCurrent ? "text-nox-text font-medium" : installed ? "text-nox-textDim" : "text-nox-textDim/60"}`}>
                                      {rec.label}
                                    </div>
                                    <div className="text-[10px] text-nox-textDim/70">{rec.size}</div>
                                  </div>
                                  {rec.warning && (
                                    <span className="px-1 py-0.5 rounded bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 flex-shrink-0" title="Kleines Modell – kann Fehler machen"><IconWarning size={12} /></span>
                                  )}
                                </button>
                                {isCurrent ? (
                                  <svg className="w-4 h-4 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : installed ? (
                                  <span className="text-green-600 dark:text-green-400 flex-shrink-0"><IconCheck size={12} /></span>
                                ) : isPulling ? (
                                  <span className="text-[10px] text-nox-accent flex-shrink-0">{Math.round(models.pullState.progress * 100)}%</span>
                                ) : (
                                  <button
                                    onClick={() => models.handleModelPull(rec.model)}
                                    disabled={models.pullState.running}
                                    className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                                      models.pullState.running ? "opacity-40 cursor-not-allowed" : "bg-nox-accent/20 text-nox-accent hover:bg-nox-accent hover:text-nox-accentFg"
                                    }`}
                                    title={`${rec.label} herunterladen`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {isPulling && (
                                <div className="mt-1.5 w-full h-1.5 rounded-full bg-nox-border overflow-hidden">
                                  <div className="h-full bg-nox-accent transition-all duration-300 rounded-full" style={{ width: `${Math.round(models.pullState.progress * 100)}%` }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {models.availableModels.length > 0 && (
                          <button
                            onClick={() => models.setShowAllModels(true)}
                            className="w-full text-left px-3 py-2 text-xs text-nox-accent hover:bg-nox-accent/10 transition-colors border-t border-nox-border mt-1"
                          >
                            {t.onboarding?.showAllModels || "Alle KIs anzeigen"} ({models.availableModels.length})
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="px-3 py-1.5 text-[10px] text-nox-textDim uppercase tracking-wide border-b border-nox-border mb-1">
                          {t.onboarding?.allInstalledModels || "Alle installierten KIs"}
                        </div>
                        {MODE_KEYS.map((modeKey) => {
                          const modelsInMode = models.availableModels.filter(m => {
                            const modes = MODEL_TO_MODES[m] || [];
                            return modes.includes(modeKey);
                          });
                          if (modelsInMode.length === 0) return null;
                          return (
                            <div key={modeKey} className="mb-1">
                              <div className="px-3 py-1 text-[10px] text-nox-textDim/70 uppercase tracking-wide">
                                {models.MODE_LABELS[modeKey]}
                              </div>
                              {modelsInMode.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => models.handleModelSwitch(m, modeKey)}
                                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                                    models.currentModel === m ? "bg-nox-accent/15 text-nox-text" : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">{prettyModelName(m)}</span>
                                    {MODEL_TO_MODES[m]?.[0] && models.MODE_LABELS[MODEL_TO_MODES[m][0]] && (
                                      <span className="text-[9px] text-nox-textDim/50 flex-shrink-0">{models.MODE_LABELS[MODEL_TO_MODES[m][0]]}</span>
                                    )}
                                  </div>
                                  {models.currentModel === m && (
                                    <svg className="w-3.5 h-3.5 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                        {(() => {
                          const uncategorized = models.availableModels.filter(m => !MODEL_TO_MODES[m]);
                          if (uncategorized.length === 0) return null;
                          return (
                            <div className="mb-1">
                              <div className="px-3 py-1 text-[10px] text-nox-textDim/70 uppercase tracking-wide">
                                Weitere
                              </div>
                              {uncategorized.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => models.handleModelSwitch(m)}
                                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                                    models.currentModel === m ? "bg-nox-accent/15 text-nox-text" : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                                  }`}
                                >
                                  <span className="truncate">{prettyModelName(m)}</span>
                                  {models.currentModel === m && (
                                    <svg className="w-3.5 h-3.5 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                        <button
                          onClick={() => models.setShowAllModels(false)}
                          className="w-full text-left px-3 py-2 text-xs text-nox-accent hover:bg-nox-accent/10 transition-colors border-t border-nox-border mt-1"
                        >
                          <span className="flex items-center gap-1"><IconArrowLeft size={12} /> Nur empfohlene anzeigen</span>
                        </button>
                      </>
                    )}
                    <div className="border-t border-nox-border mt-1 pt-1">
                      <button
                        onClick={() => setThinkingEnabled(!thinkingEnabled)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-nox-textDim hover:text-nox-text hover:bg-nox-border/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.545.545A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.545-.545z" /></svg>
                          <span>Thinking</span>
                        </div>
                        {thinkingEnabled ? (
                          <svg className="w-4 h-4 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-4 h-4 text-nox-textDim/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={`nox-orb-ring flex-shrink-0 ${system.micState === "listening" ? "is-listening" : ""}`}>
                <button
                  onClick={handleMicClick}
                  disabled={voiceDisabled}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    system.micState === "listening"
                      ? "bg-nox-accent text-nox-accentFg"
                      : voiceDisabled
                      ? "text-nox-textDim opacity-40 cursor-not-allowed"
                      : "text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover"
                  }`}
                  title="Spracheingabe"
                >
                  {system.micState === "listening" ? <MicActiveIcon /> : <MicIcon />}
                </button>
              </div>

              {isStreaming || system.micState === "processing" || system.micState === "speaking" ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleStopGeneration}
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-surface-hover text-nox-text hover:bg-nox-red/20 hover:text-nox-red transition-all"
                    title="Stopp"
                  >
                    <StopIcon />
                  </button>
                  {input.trim() && (
                    <button
                      onClick={sendMessage}
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-accent text-nox-accentFg hover:bg-nox-accentHover transition-all"
                      title="Senden"
                    >
                      <SendIcon />
                    </button>
                  )}
                </div>
              ) : input.trim() ? (
                <button
                  onClick={sendMessage}
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-accent text-nox-accentFg hover:bg-nox-accentHover transition-all"
                  title="Senden"
                >
                  <SendIcon />
                </button>
              ) : system.micState !== "idle" ? (
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
                  <span className="nox-status-dot" />
                </div>
              ) : null}
            </div>

            <div className="text-center mt-2">
              <span className="text-[10px] text-nox-textFaint">Nox ist ein KI-Assistent und kann Fehler machen.</span>
            </div>
          </div>
        </div>
      </div>

      <NoxSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectConversation={(id) => sessions.handleSelectConversation(id, sessionState)}
        onOpenSettings={() => { setSidebarOpen(false); setShowSettings(true); }}
        onOpenMarketplace={() => setShowMarketplace(true)}
      />

      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
    </div>
  );
}
