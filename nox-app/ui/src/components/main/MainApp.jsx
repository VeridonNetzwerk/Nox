import React, { useState, useRef, useEffect, useCallback } from "react";
import SettingsPanel from "../settings/SettingsPanel.jsx";
import OnboardingWizard from "../onboarding/OnboardingWizard.jsx";
import SetupScreen from "../onboarding/SetupScreen.jsx";
import MusicCard from "../common/MusicCard.jsx";
import AudioEqualizer from "../common/AudioEqualizer.jsx";
import ImageCard from "../common/ImageCard.jsx";
import WeatherCard from "../common/WeatherCard.jsx";
import MarkdownText from "../common/MarkdownText.jsx";
import SearchStream from "../common/SearchStream.jsx";
import ProfilePanel from "../common/ProfilePanel.jsx";
import GeminiSidebar from "./GeminiSidebar.jsx";
import { useToast } from "../common/Toast.jsx";
import noxIcon from "../../assets/nox-icon.png";
import LoadingScreen from "../common/LoadingScreen.jsx";
import deLocale from "../../locales/de.json";
import { LOCALE_MAP, WS_URL, API_BASE, speakText } from "../../shared/constants.jsx";
import { IconWarning, IconCheck, IconArrowLeft } from "../../shared/Icon.jsx";
import { prettyModelName, prettyVoiceName } from "../../shared/prettyNames.jsx";

// ── Icons ──────────────────────────────────────────────────────────────────

const Icon = {
  Chat: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Settings: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Plus: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Send: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Mic: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  MicActive: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
  ),
  Copy: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Speak: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  ),
  Like: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  ),
  Dislike: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
    </svg>
  ),
  Repeat: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Sources: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  Fork: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" /><line x1="12" y1="7" x2="12" y2="13" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="11" x2="8" y2="21" /><line x1="16" y1="11" x2="16" y2="21" /><circle cx="8" cy="21" r="1.5" /><circle cx="16" cy="21" r="1.5" />
    </svg>
  ),
  Stop: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
  ),
  ChevronDown: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
  ),
  ChevronUp: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
  ),
  ArrowLeft: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
  ),
  ArrowRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
  ),
  ChartIcon: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
  ),
};

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ activeView, onNavigate, onNewChat, onOpenSettings, onOpenGeminiSidebar, connectionStatus, t }) {
  const connColor = connectionStatus === "connected" ? "bg-green-500 dark:bg-green-400" : connectionStatus === "connecting" ? "bg-yellow-500 dark:bg-yellow-400" : "bg-red-500 dark:bg-red-400";

  const navItems = [
    { id: "chat", icon: Icon.Chat, label: "Chat" },
  ];

  return (
    <div className="flex flex-col items-center py-3 px-2 gap-1 w-14 flex-shrink-0 border-r border-nox-border bg-nox-surface/60">
      {/* Logo with hover popup */}
      <div
        className="mb-3 group relative cursor-pointer"
        onClick={onOpenGeminiSidebar}
        title="Seitenleiste öffnen"
      >
        <img src={noxIcon} alt="Nox" className="w-8 h-8 rounded-full orb-idle" />
        {/* Hover tooltip */}
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-2 bg-nox-surface-raised text-nox-text text-xs px-2.5 py-1.5 rounded-lg border border-nox-border shadow-lg whitespace-nowrap z-30">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-nox-accent">
            <path d="M8 5v14l11-7z" />
          </svg>
          Seitenleiste öffnen
        </div>
      </div>

      {/* New chat */}
      <button
        onClick={onNewChat}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors mb-1"
        title="Neuer Chat"
      >
        <Icon.Plus />
      </button>

      {/* Search chats */}
      <button
        onClick={onOpenGeminiSidebar}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors mb-1"
        title="Chats durchsuchen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {/* Nav items */}
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection indicator */}
      <div className="flex items-center justify-center w-10 h-6" title={connectionStatus}>
        <span className={`w-1.5 h-1.5 rounded-full ${connColor}`} style={{
          boxShadow: connectionStatus === "connected" ? "0 0 6px rgba(74, 222, 128, 0.6)" : "none"
        }} />
      </div>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="w-10 h-10 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors"
        title="Einstellungen"
      >
        <Icon.Settings />
      </button>
    </div>
  );
}

// ── Chat message bubble ────────────────────────────────────────────────────

function ChatMessage({ msg, isLast, onCopy, onSpeak, onRegenerate, onFeedback, onFork, onPin, isPinned, hasSources, addToast, t }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const [feedback, setFeedback] = useState(null); // null | "like" | "dislike"
  const [showStats, setShowStats] = useState(false);

  // Version navigation: msg.versions = [{ content, stats, model }, ...], msg.versionIndex = 0
  const versions = msg.versions || [{ content: msg.content, stats: msg.stats, model: msg.model }];
  const versionIndex = msg.versionIndex ?? 0;
  const hasVersions = versions.length > 1;

  const handleVersionChange = (newIdx) => {
    onRegenerate?.(msg, 'switch', newIdx);
  };

  const handleFeedback = (rating) => {
    setFeedback(prev => prev === rating ? null : rating);
    onFeedback?.(rating, msg.content);
    addToast({ type: "info", title: rating === "like" ? "Danke!" : "Noted", message: rating === "like" ? "Feedback gespeichert" : "Feedback gespeichert", duration: 2000 });
  };

  const formatDuration = (ns) => {
    if (!ns || ns <= 0) return "—";
    const ms = ns / 1e6;
    if (ms < 1) return `${ns} ns`;
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  const curStats = versions[versionIndex]?.stats || msg.stats || {};
  const curContent = versions[versionIndex]?.content ?? msg.content;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} animate-bubble-in`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
          <img src={noxIcon} alt="Nox" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Message body */}
      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
            isUser
              ? "bg-nox-accent/15 text-nox-text rounded-tr-sm whitespace-pre-wrap"
              : isError
              ? "bg-nox-red/10 text-nox-red rounded-tl-sm border border-nox-red/20 whitespace-pre-wrap"
              : "bg-nox-surface text-nox-text rounded-tl-sm"
          }`}>
          {isUser || isError || msg.streaming ? (
            curContent
          ) : (
            <MarkdownText content={curContent} addToast={addToast} />
          )}
          {isLast && msg.streaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-nox-accent animate-pulse rounded-sm align-middle" />
          )}
        </div>

        {/* Action buttons for assistant messages */}
        {!isUser && !msg.streaming && !isError && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => { navigator.clipboard?.writeText(curContent); addToast({ type: "info", title: "Kopiert", message: "Antwort in Zwischenablage kopiert", duration: 2000 }); }}
              className="nox-action-btn"
              title="Kopieren"
            >
              <Icon.Copy />
            </button>
            <button
              onClick={() => speakText(curContent, addToast)}
              className="nox-action-btn"
              title="Vorlesen"
            >
              <Icon.Speak />
            </button>
            <button
              onClick={() => handleFeedback("like")}
              className={`nox-action-btn ${feedback === "like" ? "text-green-500" : ""}`}
              title="Gute Antwort"
            >
              <Icon.Like />
            </button>
            <button
              onClick={() => handleFeedback("dislike")}
              className={`nox-action-btn ${feedback === "dislike" ? "text-red-500" : ""}`}
              title="Schlechte Antwort"
            >
              <Icon.Dislike />
            </button>
            <button
              onClick={() => onRegenerate?.(msg)}
              className="nox-action-btn"
              title="Wiederholen"
            >
              <Icon.Repeat />
            </button>
            {hasSources && (
              <button
                onClick={() => addToast({ type: "info", title: "Quellen", message: "Quellen werden in einer zukünftigen Version angezeigt.", duration: 3000 })}
                className="nox-action-btn"
                title="Quellen anzeigen"
              >
                <Icon.Sources />
              </button>
            )}
            <button
              onClick={() => onFork?.(msg)}
              className="nox-action-btn"
              title="Neuen Chat ab hier starten"
            >
              <Icon.Fork />
            </button>
            {/* Version navigation */}
            {hasVersions && (
              <div className="flex items-center gap-0.5 ml-1 text-xs text-nox-textDim">
                <button
                  onClick={() => handleVersionChange(versionIndex - 1)}
                  disabled={versionIndex <= 0}
                  className="nox-action-btn"
                  title="Vorherige Version"
                >
                  <Icon.ArrowLeft />
                </button>
                <span className="select-none px-0.5">{versionIndex + 1}/{versions.length}</span>
                <button
                  onClick={() => handleVersionChange(versionIndex + 1)}
                  disabled={versionIndex >= versions.length - 1}
                  className="nox-action-btn"
                  title="Nächste Version"
                >
                  <Icon.ArrowRight />
                </button>
              </div>
            )}
            <button
              onClick={() => onPin?.(msg)}
              className={`nox-action-btn ${isPinned ? "text-nox-accent" : ""}`}
              title={isPinned ? "Loslösen" : "Anpinnen"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
            </button>
            {/* Stats toggle button */}
            <button
              onClick={() => setShowStats(s => !s)}
              className={`nox-action-btn ${showStats ? "text-nox-accent" : ""}`}
              title="Antwort-Statistiken"
            >
              <Icon.ChartIcon />
            </button>
          </div>
        )}

        {/* Response statistics panel */}
        {!isUser && !msg.streaming && !isError && showStats && (
          <div className="ml-1 w-full max-w-[75%] rounded-xl border border-nox-border bg-nox-surface/50 text-xs overflow-hidden">
            <div className="px-3 py-2 border-b border-nox-border bg-nox-surface-hover/30">
              <span className="text-nox-textDim font-medium">Antwort-Statistiken</span>
            </div>
            <div className="px-3 py-2.5 space-y-2">
              {(versions[versionIndex]?.model || msg.model) && (
                <div className="flex justify-between items-center">
                  <span className="text-nox-textDim">Modell</span>
                  <span className="text-nox-text font-medium">{versions[versionIndex]?.model || msg.model}</span>
                </div>
              )}
              <div className="border-t border-nox-border/50 pt-2">
                <div className="text-nox-textDim font-medium mb-1.5">Token-Nutzung</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Input</span>
                    <span className="text-nox-text">{(curStats.prompt_eval_count || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Output</span>
                    <span className="text-nox-text">{(curStats.eval_count || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Gesamt</span>
                    <span className="text-nox-text">{((curStats.prompt_eval_count || 0) + (curStats.eval_count || 0)).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-nox-border/50 pt-2">
                <div className="text-nox-textDim font-medium mb-1.5">Dauer</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Laden</span>
                    <span className="text-nox-text">{formatDuration(curStats.load_duration_ns)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Verarbeitung</span>
                    <span className="text-nox-text">{formatDuration(curStats.prompt_eval_duration_ns)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Generierung</span>
                    <span className="text-nox-text">{formatDuration(curStats.eval_duration_ns)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Gesamt</span>
                    <span className="text-nox-text">{formatDuration(curStats.total_duration_ns)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons for user messages */}
        {isUser && (
          <div className="flex items-center gap-1 mr-1">
            <button
              onClick={() => { navigator.clipboard?.writeText(msg.content); addToast({ type: "info", title: "Kopiert", message: "Nachricht kopiert", duration: 2000 }); }}
              className="nox-action-btn"
              title="Kopieren"
            >
              <Icon.Copy />
            </button>
            <button
              onClick={() => onFork?.(msg)}
              className="nox-action-btn"
              title="Neuen Chat ab hier starten"
            >
              <Icon.Fork />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Main app component ─────────────────────────────────────────────────────

export default function MainApp() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [theme, setTheme] = useState("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [micState, setMicState] = useState("idle");
  const [systemStatus, setSystemStatus] = useState(null);
  const [backendReady, setBackendReady] = useState(false);
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
  const [geminiSidebarOpen, setGeminiSidebarOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [currentModel, setCurrentModel] = useState("");
  const [currentModelMode, setCurrentModelMode] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [pullState, setPullState] = useState({ running: false, model: "", progress: 0 });
  const [plusDropdownOpen, setPlusDropdownOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [chatSessions, setChatSessions] = useState([{ id: "default", label: "Chat 1", messages: [], musicResult: null, conversationId: null }]);
  const [activeSession, setActiveSession] = useState(0);
  const [username, setUsername] = useState("");
  const [recentConversations, setRecentConversations] = useState([]);
  const [fileInputRef] = useState({ current: null });
  const pullPollRef = useRef(null);
  const modelDropdownRef = useRef(null);
  const plusDropdownRef = useRef(null);
  const fileInputRefActual = useRef(null);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const t = localeData;

  const MODE_KEYS = ["superschnell", "schnell", "balance", "qualitaet"];
  const MODE_LABELS = {
    superschnell: t.onboarding?.modeSuperFast || "Superschnell",
    schnell: t.onboarding?.modeFast || "Schnell",
    balance: t.onboarding?.modeBalanced || "Balance",
    qualitaet: t.onboarding?.modeQuality || "Qualität",
  };

  // Same MODEL_TABLE as in OnboardingWizard — maps VRAM tier + mode to recommended model
  const MODEL_TABLE = [
    { range: [0, 4096], modes: {
      superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", size: "~1.3 GB", warning: true },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      balance:      { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      qualitaet:    { model: "phi4-mini:3.8b", label: "Phi-4 mini 3.8B", size: "~3.0 GB", warning: true },
    }},
    { range: [4096, 8192], modes: {
      superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", size: "~1.3 GB", warning: true },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      balance:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", size: "~4.0 GB" },
      qualitaet:    { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
    }},
    { range: [8192, 12288], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
    }},
    { range: [12288, 16384], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", size: "~4.0 GB" },
      balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
    }},
    { range: [16384, 20480], modes: {
      superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", size: "~2.2 GB" },
      schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", size: "~4.0 GB" },
      balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
      qualitaet:    { model: "gemma4:26b", label: "Gemma 4 26B", size: "~15 GB" },
    }},
    { range: [20480, 24576], modes: {
      superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", size: "~4.0 GB" },
      schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
      qualitaet:    { model: "qwen3.8:27b", label: "Qwen 3.8 27B", size: "~18 GB" },
    }},
    { range: [24576, 32768], modes: {
      superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", size: "~4.0 GB" },
      schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      balance:      { model: "gemma4:26b", label: "Gemma 4 26B", size: "~15 GB" },
      qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", size: "~23 GB" },
    }},
    { range: [32768, 40960], modes: {
      superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
      balance:      { model: "qwen3.8:27b", label: "Qwen 3.8 27B", size: "~18 GB" },
      qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", size: "~23 GB" },
    }},
    { range: [40960, 999999], modes: {
      superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", size: "~6.5 GB" },
      schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", size: "~9.0 GB" },
      balance:      { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", size: "~23 GB" },
      qualitaet:    { model: "granite4.2:30b", label: "Granite 4.2 30B", size: "~18 GB" },
    }},
  ];

  // Build reverse mapping: model name -> array of modes it appears in
  const MODEL_TO_MODES = (() => {
    const map = {};
    for (const tier of MODEL_TABLE) {
      for (const modeKey of MODE_KEYS) {
        const entry = tier.modes[modeKey];
        if (entry?.model) {
          if (!map[entry.model]) map[entry.model] = [];
          if (!map[entry.model].includes(modeKey)) map[entry.model].push(modeKey);
        }
      }
    }
    return map;
  })();

  // Get the 4 recommended models for the user's VRAM tier
  const getRecommendedModels = () => {
    const vram = gpuInfo?.vram_mb || 0;
    const tier = MODEL_TABLE.find(t => vram >= t.range[0] && vram < t.range[1]) || MODEL_TABLE[0];
    return MODE_KEYS.map(key => ({
      modeKey: key,
      ...tier.modes[key],
    }));
  };

  const isModelInstalled = (model) =>
    availableModels.some(m => m === model || m.startsWith(model));

  // Fetch available models + GPU info
  // Only set currentModel on initial load — after that, only the user changes it
  const modelInitRef = useRef(false);
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models`);
        const data = await res.json();
        if (data.available_models) setAvailableModels(data.available_models);
        if (data.current_model && !modelInitRef.current) {
          setCurrentModel(data.current_model);
          modelInitRef.current = true;
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      }
    };
    fetchModels();
    const interval = setInterval(fetchModels, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recent conversations for start screen
  useEffect(() => {
    if (!backendReady) return;
    const fetchRecent = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/conversation/list?limit=5`);
        const data = await res.json();
        if (data.status === "ok") setRecentConversations(data.conversations || []);
      } catch {}
    };
    fetchRecent();
  }, [backendReady]);

  // Fetch GPU info once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/gpu-check`);
        setGpuInfo(await res.json());
      } catch {}
    })();
  }, []);

  // Fetch current model mode from settings (once on mount)
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (data.status === "ok" && data.settings?.ollama_model_mode) {
          setCurrentModelMode(data.settings.ollama_model_mode);
        }
      } catch {}
    };
    fetchSettings();
  }, []);

  // Fetch OS username for personalized greeting
  useEffect(() => {
    fetch(`${API_BASE}/api/username`)
      .then(r => r.json())
      .then(data => { if (data.username) setUsername(data.username); })
      .catch(() => {});
  }, []);

  // Pull/download a model
  const handleModelPull = async (model) => {
    if (pullState.running) return;
    setPullState({ running: true, model, progress: 0 });
    try {
      await fetch(`${API_BASE}/api/onboarding/pull-ollama-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const poll = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/onboarding/pull-status`);
          const data = await res.json();
          setPullState({ running: data.running, model: data.model || model, progress: data.progress || 0 });
          if (data.running) {
            pullPollRef.current = setTimeout(poll, 1000);
          } else {
            // Refresh models list
            const modelsRes = await fetch(`${API_BASE}/api/models`);
            const modelsData = await modelsRes.json();
            setAvailableModels(modelsData.available_models || []);
            setPullState({ running: false, model: "", progress: 0 });
          }
        } catch {
          pullPollRef.current = setTimeout(poll, 2000);
        }
      };
      poll();
    } catch (err) {
      setPullState({ running: false, model: "", progress: 0 });
      addToast({ type: "warning", title: "Download", message: "Modell konnte nicht heruntergeladen werden", duration: 4000 });
    }
  };

  useEffect(() => {
    return () => { if (pullPollRef.current) clearTimeout(pullPollRef.current); };
  }, []);

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
      if (plusDropdownRef.current && !plusDropdownRef.current.contains(e.target)) {
        setPlusDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleModelSwitch = async (model, modeKey) => {
    try {
      const body = { ollama_model: model };
      if (modeKey) body.ollama_model_mode = modeKey;
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setCurrentModel(model);
      if (modeKey) setCurrentModelMode(modeKey);
      setModelDropdownOpen(false);
    } catch (err) {
      addToast({ type: "warning", title: "Modell", message: "Modell konnte nicht gewechselt werden", duration: 4000 });
    }
  };

  // Load locale
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
      } catch {}
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
        if (hasConnectedOnceRef.current && wsReconnectRef.current === 0) {
          addToast({ type: "warning", title: "Verbindung", message: "Verbindung zum Backend getrennt. Versuche erneut zu verbinden…", duration: 4000 });
        }
        const delay = Math.min(1000 * Math.pow(2, wsReconnectRef.current), 15000);
        wsReconnectRef.current++;
        setTimeout(connect, delay);
      };
      ws.onerror = () => {
        setConnectionStatus("error");
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

        if (data.type === "voice_event") {
          const stateMap = {
            wake_detected: "listening", listening: "listening",
            transcribing: "processing", thinking: "processing",
            speaking: "speaking", idle: "idle",
          };
          setMicState(stateMap[data.state] || "idle");
          if (data.state === "wake_detected") {
            setShowSettings(false);
            setShowOnboarding(false);
          }
          return;
        }

        if (data.type === "user_message") {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: data.content, streaming: false, voice: data.voice_input },
          ]);
          setIsStreaming(true);
          setMusicResult(null);
          // Start timeout for voice-initiated messages too
          if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
          streamingTimerRef.current = setTimeout(() => {
            setIsStreaming(false);
            setMicState("idle");
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.streaming) {
                return [...prev.slice(0, -1), { ...last, streaming: false, content: last.content + "\n\n⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen." }];
              }
              return [...prev, { role: "assistant", content: "⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen.", streaming: false }];
            });
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "abort" }));
            }
            addToast({ type: "warning", title: "Timeout", message: "Die KI hat zu lange gebraucht. Abgebrochen.", duration: 5000 });
          }, 120000);
          return;
        }

        if (data.type === "voice_transcript") {
          setInput(data.content || "");
          inputRef.current?.focus();
          return;
        }

        if (data.type === "music_result") {
          setMusicResult(data);
          return;
        }

        if (data.type === "image_result") {
          setImageResult(data);
          return;
        }

        if (data.type === "weather_result") {
          setWeatherResult(data.data);
          return;
        }

        if (data.type === "done" && data.card_only) {
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setWeatherText(data.card_text || "");
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          setSearchStreams([]);
          const totalMsgs = messages.length + 1;
          if (totalMsgs === 1 || totalMsgs % 3 === 0) {
            fetch(`${API_BASE}/api/conversation/generate-title`, { method: "POST" })
              .then(r => r.json())
              .then(titleData => {
                if (titleData.status === "ok" && titleData.title) {
                  setChatSessions((prev) => {
                    const updated = [...prev];
                    updated[activeSession] = { ...updated[activeSession], label: titleData.title };
                    return updated;
                  });
                  setRecentConversations(prev => prev.map(c =>
                    c.id === titleData.conversation_id ? { ...c, title: titleData.title } : c
                  ));
                }
              })
              .catch(() => {});
          }
          return;
        }

        if (data.type === "tool_start") {
          setActiveTool(data.tool || null);
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

        if (data.type === "search_progress") {
          const { tool, phase, query, source, count, results, error } = data;
          const streamId = `${tool}-${query}`;
          setSearchStreams((prev) => {
            const existing = prev.find(s => s.id === streamId);
            const updated = {
              id: streamId,
              tool,
              phase,
              query: query || existing?.query || "",
              source: source || existing?.source,
              count: count !== undefined ? count : existing?.count,
              results: results || existing?.results,
              error: error || existing?.error,
              timestamp: Date.now(),
            };
            if (existing) {
              return prev.map(s => s.id === streamId ? updated : s);
            }
            return [...prev, updated];
          });
          return;
        }

        if (data.type === "token") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
            }
            return [...prev, { role: "assistant", content: data.content, streaming: true }];
          });
        } else if (data.type === "done") {
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              const newVersion = { content: data.content, stats: data.stats || null, model: data.model || null };
              // If this message has versions (regeneration), append the new version
              if (last.versions && last.versions.length > 0) {
                const updatedVersions = [...last.versions, newVersion];
                return [...prev.slice(0, -1), {
                  ...last,
                  streaming: false,
                  content: data.content,
                  stats: data.stats || null,
                  model: data.model || null,
                  versions: updatedVersions,
                  versionIndex: updatedVersions.length - 1,
                }];
              }
              return [...prev.slice(0, -1), { ...last, streaming: false, stats: data.stats || null, model: data.model || null }];
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          setSearchStreams([]);

          // Auto-generate chat title after 1st and every 3rd message
          const totalMsgs = messages.length + 1; // +1 for the assistant reply just completed
          if (totalMsgs === 1 || totalMsgs % 3 === 0) {
            fetch(`${API_BASE}/api/conversation/generate-title`, { method: "POST" })
              .then(r => r.json())
              .then(titleData => {
                if (titleData.status === "ok" && titleData.title) {
                  setChatSessions((prev) => {
                    const updated = [...prev];
                    updated[activeSession] = { ...updated[activeSession], label: titleData.title };
                    return updated;
                  });
                  // Also refresh recent conversations
                  setRecentConversations(prev => prev.map(c =>
                    c.id === titleData.conversation_id ? { ...c, title: titleData.title } : c
                  ));
                }
              })
              .catch(() => {});
          }
        } else if (data.type === "aborted") {
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              // If this was a regeneration, restore the previous version
              if (last.versions && last.versions.length > 0) {
                const restoreIdx = Math.max(0, (last.versionIndex ?? last.versions.length) - 1);
                const restored = last.versions[restoreIdx];
                return [...prev.slice(0, -1), {
                  ...last,
                  streaming: false,
                  content: restored.content,
                  stats: restored.stats,
                  model: restored.model,
                  versionIndex: restoreIdx,
                }];
              }
              return prev.slice(0, -1);
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          setSearchStreams([]);
          setMusicResult(null);
        } else if (data.type === "error") {
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => [...prev, { role: "error", content: data.content, streaming: false }]);
          setIsStreaming(false);
          setActiveTool(null);
          setSearchStreams([]);
          addToast({ type: "error", title: "Nox", message: data.content, reportable: true });
        } else if (data.type === "close_window") {
          // Main window doesn't hide on close_window — only overlay does
        } else if (data.type === "quit_app") {
          window.nox?.closeApp?.();
        } else if (data.type === "timer_alert") {
          const msg = data.message || "Timer abgelaufen!";
          addToast({ type: "info", title: "Nox Timer", message: msg });
        } else if (data.type === "vram_status") {
          if (data.action === "downgraded" && data.model) {
            setCurrentModel(data.model);
            if (data.mode) setCurrentModelMode(data.mode);
            addToast({ type: "warning", title: "VRAM", message: `Wenig VRAM — auf ${prettyModelName(data.model)} gewechselt`, duration: 5000 });
          } else if (data.action === "upgraded" && data.model) {
            setCurrentModel(data.model);
            if (data.mode) setCurrentModelMode(data.mode);
            addToast({ type: "success", title: "VRAM", message: `VRAM erholt — zurück auf ${prettyModelName(data.model)}`, duration: 4000 });
          } else if (data.action === "unloaded") {
            addToast({ type: "warning", title: "VRAM kritisch", message: "Modell entladen — VRAM fast voll", duration: 5000 });
          }
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

  // Fetch system status
  useEffect(() => {
    let lastErrorTime = 0;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        if (data.status === "ok") setSystemStatus(data);
      } catch {
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

  // Check onboarding state
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 60;

    const checkOnboarding = async () => {
      try {
        try {
          const bsRes = await fetch("http://127.0.0.1:8421/api/bootstrap/status");
          const bsData = await bsRes.json();
          if (bsData.status === "ok" && !bsData.deps_installed) {
            setShowSetup(true);
            return;
          }
        } catch {}

        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "ok" && !data.settings.onboarding_completed) {
          setShowOnboarding(true);
          window.nox?.onboardingActive?.();
        } else if (data.status === "ok" && data.settings.onboarding_completed) {
          window.nox?.onboardingNotNeeded?.();
        }
      } catch {
        if (cancelled) return;
        if (retries === 10 && !hasConnectedOnceRef.current) {
          addToast({ type: "warning", title: "Backend", message: "Backend reagiert nicht. Nox versucht weiterhin eine Verbindung herzustellen…", duration: 6000 });
        }
        if (retries < MAX_RETRIES) {
          retries++;
          setTimeout(checkOnboarding, 3000);
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      const inInput = tag === "input" || tag === "textarea";

      if (e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        setGeminiSidebarOpen((v) => !v);
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

  const streamingTimerRef = useRef(null);

  const sendMessageWithText = useCallback((text) => {
    const userMessage = text.trim();
    if (!userMessage || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;

    // If all tabs are closed, create a new one automatically
    if (chatSessions.length === 0) {
      setChatSessions([{ id: `session-${Date.now()}`, label: "Chat 1", messages: [], musicResult: null, conversationId: null }]);
      setActiveSession(0);
    }

    // Handle special brief command
    if (userMessage === "__BRIEF__") {
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: "📋 Tägliches Briefing", streaming: false }]);
      setMessages((prev) => [...prev, { role: "assistant", content: "Briefing wird generiert…", streaming: true }]);
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

    setMessages((prev) => [...prev, { role: "user", content: userMessage, streaming: false }]);
    setInput("");
    setIsStreaming(true);

    // Update tab label from first message if session still has default label
    if (chatSessions[activeSession]?.label?.startsWith("Chat ")) {
      const label = userMessage.slice(0, 30) + (userMessage.length > 30 ? "…" : "");
      setChatSessions((prev) => {
        const updated = [...prev];
        updated[activeSession] = { ...updated[activeSession], label };
        return updated;
      });
    }

    // Auto-timeout: if no "done"/"error"/"aborted" within 120s, reset state
    if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
    streamingTimerRef.current = setTimeout(() => {
      setIsStreaming(false);
      setMicState("idle");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false, content: last.content + "\n\n⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen." }];
        }
        return [...prev, { role: "assistant", content: "⏱️ Zeitüberschreitung – die Antwort wurde abgebrochen.", streaming: false }];
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
  }, [isStreaming, thinkingEnabled, addToast, chatSessions, activeSession]);

  const sendMessage = useCallback(() => {
    sendMessageWithText(input);
  }, [input, sendMessageWithText]);

  const SLASH_COMMANDS = [
    { cmd: "/zusammenfassen", desc: "Text oder Bildschirm zusammenfassen", prompt: "Bitte fasse den folgenden Text kurz zusammen: " },
    { cmd: "/uebersetzen", desc: "Text übersetzen", prompt: "Bitte übersetze den folgenden Text auf Deutsch: " },
    { cmd: "/erklaeren", desc: "Konzept oder Code erklären", prompt: "Bitte erkläre das folgende Konzept verständlich: " },
    { cmd: "/code", desc: "Code generieren oder verbessern", prompt: "Bitte schreibe Code für: " },
    { cmd: "/notiz", desc: "Notiz speichern", prompt: "Speichere mir folgende Notiz: " },
    { cmd: "/uhrzeit", desc: "Aktuelle Uhrzeit und Datum", prompt: "Wie spät ist es?" },
    { cmd: "/wetter", desc: "Wetter über Web-Suche", prompt: "Wie ist das aktuelle Wetter?" },
    { cmd: "/bild", desc: "Bild generieren", prompt: "Generiere ein Bild von: " },
    { cmd: "/musik", desc: "Aktuellen Song erkennen", prompt: "Welcher Song spielt gerade?" },
    { cmd: "/dateien", desc: "Lokale Dateien durchsuchen", prompt: "Durchsuche meine Dateien nach: " },
    { cmd: "/einstellungen", desc: "Nox-Einstellungen anzeigen", prompt: "Zeige mir meine Einstellungen." },
    { cmd: "/brief", desc: "Tägliches Briefing generieren", prompt: "__BRIEF__" },
  ];

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

  const handleNewChat = () => {
    addNewSession();
    // Tell backend to start a new conversation
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      fetch(`${API_BASE}/api/conversation/new`, { method: "POST" });
    }
  };

  const handlePin = (msg) => {
    setPinnedMessages((prev) => {
      const exists = prev.some((m) => m.content === msg.content && m.role === msg.role);
      if (exists) return prev.filter((m) => !(m.content === msg.content && m.role === msg.role));
      return [...prev, { role: msg.role, content: msg.content, timestamp: new Date().toISOString() }];
    });
  };

  const switchSession = (idx) => {
    if (idx === activeSession || chatSessions.length === 0) return;
    const updated = [...chatSessions];
    updated[activeSession] = { ...updated[activeSession], messages, musicResult };
    setChatSessions(updated);
    setActiveSession(idx);
    setMessages(updated[idx].messages || []);
    setMusicResult(updated[idx].musicResult || null);
    setWeatherResult(null);
    setWeatherText(null);
    setActiveTool(null);
    setSearchStreams([]);
  };

  const addNewSession = () => {
    if (chatSessions.length === 0) {
      setChatSessions([{ id: `session-${Date.now()}`, label: "Chat 1", messages: [], musicResult: null, conversationId: null }]);
      setActiveSession(0);
      setMessages([]);
      setMusicResult(null);
      setWeatherResult(null);
      setWeatherText(null);
      setActiveTool(null);
      setSearchStreams([]);
      setInput("");
      inputRef.current?.focus();
      return;
    }
    const updated = [...chatSessions];
    updated[activeSession] = { ...updated[activeSession], messages, musicResult };
    const newIdx = updated.length;
    updated.push({ id: `session-${Date.now()}`, label: `Chat ${newIdx + 1}`, messages: [], musicResult: null, conversationId: null });
    setChatSessions(updated);
    setActiveSession(newIdx);
    setMessages([]);
    setMusicResult(null);
    setWeatherResult(null);
    setWeatherText(null);
    setActiveTool(null);
    setSearchStreams([]);
    setInput("");
    inputRef.current?.focus();
  };

  const closeSession = (idx) => {
    const updated = [...chatSessions];
    updated[activeSession] = { ...updated[activeSession], messages, musicResult };
    const filtered = updated.filter((_, i) => i !== idx);
    if (filtered.length === 0) {
      // All tabs closed — show empty state
      setChatSessions([]);
      setActiveSession(0);
      setMessages([]);
      setMusicResult(null);
      setWeatherResult(null);
      setWeatherText(null);
      return;
    }
    let newActive = activeSession;
    if (activeSession === idx) {
      newActive = Math.max(0, idx - 1);
    } else if (activeSession > idx) {
      newActive = activeSession - 1;
    }
    setChatSessions(filtered);
    setActiveSession(newActive);
    setMessages(filtered[newActive]?.messages || []);
    setMusicResult(filtered[newActive]?.musicResult || null);
  };

  const handleSelectConversation = async (conversationId) => {
    try {
      const res = await fetch(`${API_BASE}/api/conversation/${conversationId}`);
      const data = await res.json();
      if (data.status === "ok" && data.turns) {
        const loadedMessages = data.turns
          .filter((t) => t.role === "user" || t.role === "assistant")
          .map((t) => {
            let parsedStats = null;
            if (t.stats) {
              try { parsedStats = JSON.parse(t.stats); } catch {}
            }
            return {
              role: t.role,
              content: t.content,
              streaming: false,
              voice: t.voice_input,
              stats: parsedStats,
            };
          });
        const title = data.title || loadedMessages.find(m => m.role === "user")?.content?.slice(0, 30) || "Chat";

        // Save current session state, then create a new tab for the loaded conversation
        setChatSessions((prev) => {
          const updated = [...prev];
          updated[activeSession] = { ...updated[activeSession], messages, musicResult };
          const newIdx = updated.length;
          updated.push({ id: `session-${Date.now()}`, label: title, messages: loadedMessages, musicResult: null, conversationId });
          return updated;
        });
        const newIdx = chatSessions.length;
        setActiveSession(newIdx);
        setMessages(loadedMessages);
        setMusicResult(null);
        setWeatherResult(null);
        setWeatherText(null);
        setActiveTool(null);
        setSearchStreams([]);
        setInput("");
      }
    } catch (err) {
      addToast({ type: "warning", title: "Verlauf", message: "Unterhaltung konnte nicht geladen werden.", duration: 4000 });
    }
  };

  const handleRegenerate = (msg, action, newIdx) => {
    if (action === 'switch') {
      // Just switch the displayed version
      setMessages((prev) => prev.map((m) => {
        if (m === msg) {
          return { ...m, versionIndex: newIdx };
        }
        return m;
      }));
      return;
    }

    if (isStreaming) return;
    // Find the last user message before this assistant message
    const idx = messages.findIndex((m) => m === msg);
    let lastUserMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMsg = messages[i].content;
        break;
      }
    }
    if (!lastUserMsg) return;

    // Save current version and start new generation
    const currentVersions = msg.versions || [{ content: msg.content, stats: msg.stats, model: msg.model }];
    setMessages((prev) => prev.map((m) => {
      if (m === msg) {
        return {
          ...m,
          versions: currentVersions,
          versionIndex: currentVersions.length, // New version will be at this index
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
      setMicState("idle");
      addToast({ type: "warning", title: "Timeout", message: "Die KI hat zu lange gebraucht. Abgebrochen.", duration: 5000 });
    }, 120000);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message: lastUserMsg }));
    }
  };

  const handleFeedback = (rating, responseContent) => {
    // Find the user message that preceded this response
    const idx = messages.findIndex((m) => m.content === responseContent && m.role === "assistant");
    let userMessage = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userMessage = messages[i].content;
        break;
      }
    }
    fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage, response: responseContent, rating }),
    }).catch(() => {});
  };

  const handleForkChat = (msg) => {
    const idx = messages.findIndex((m) => m === msg);
    // Keep all messages up to and including this one
    const forkedMessages = messages.slice(0, idx + 1).map((m) => ({ ...m, streaming: false }));
    // Start a new conversation in the backend
    fetch(`${API_BASE}/api/conversation/new`, { method: "POST" }).catch(() => {});
    setMessages(forkedMessages);
    setMusicResult(null);
    setActiveTool(null);
    setSearchStreams([]);
    setInput("");
    addToast({ type: "info", title: "Neuer Chat", message: "Chat ab hier abgezweigt.", duration: 2000 });
  };

  const handleMicClick = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (micState === "idle" || micState === "processing" || micState === "speaking") {
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
    setMicState("idle");
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

  const ollamaDown = systemStatus?.ollama?.status === "error";
  const micAvailable = systemStatus?.microphone?.available !== false;
  const wakeModelMissing = systemStatus?.wake_word?.model_exists === false;
  const voiceDisabled = !micAvailable || wakeModelMissing;
  const backendStarting = !backendReady && connectionStatus !== "connected";

  const checkOllamaStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/health/ollama`);
      const data = await res.json();
      setSystemStatus((prev) => ({ ...prev, ollama: { status: data.status === "ok" ? "ok" : "error", host: data.ollama_host, error: data.error } }));
    } catch (err) {
      addToast({ type: "warning", title: "Ollama", message: "Ollama-Status konnte nicht geprüft werden", detail: String(err), duration: 4000 });
    }
  };

  const connText = connectionStatus === "connected" ? t.app?.connected || "Verbunden" : connectionStatus === "connecting" ? t.app?.connecting || "Verbinde…" : t.app?.disconnected || "Getrennt";

  // ── Render ──────────────────────────────────────────────────────────────

  // Loading screen — shown while backend is not yet reachable
  if (backendStarting) {
    return <LoadingScreen backendReady={false} />;
  }

  // Setup screen (deps not installed)
  if (showSetup) {
    return (
      <div data-theme={theme} className="h-full w-full flex items-center justify-center bg-nox-bgSolid">
        <div className="w-full max-w-2xl">
          <SetupScreen onComplete={() => {
            setShowSetup(false);
            setTimeout(() => window.location.reload(), 3000);
          }} />
        </div>
      </div>
    );
  }

  // Onboarding wizard
  if (showOnboarding) {
    return (
      <div data-theme={theme} className="h-full w-full bg-nox-bgSolid">
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
    );
  }

  // Settings panel — full-page overlay
  if (showSettings) {
    return (
      <div data-theme={theme} className="h-full w-full bg-nox-bgSolid">
        <SettingsPanel
          locale={t}
          onClose={() => setShowSettings(false)}
          onLocaleChange={async (langCode) => {
            const loader = LOCALE_MAP[langCode];
            if (loader) {
              const mod = await loader();
              setLocaleData(mod.default);
            }
          }}
        />
      </div>
    );
  }

  // Main chat layout
  return (
    <div data-theme={theme} className="h-full w-full flex bg-nox-bgSolid text-nox-text overflow-hidden">
      {/* ── Sidebar ── */}
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onNewChat={handleNewChat}
        onOpenSettings={() => setShowSettings(true)}
        onOpenGeminiSidebar={() => setGeminiSidebarOpen(true)}
        connectionStatus={connectionStatus}
        t={t}
      />

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Header bar ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-nox-border">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Session tabs */}
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
              {chatSessions.map((session, idx) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-1 px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors flex-shrink-0 ${
                    idx === activeSession
                      ? "bg-nox-surface text-nox-text"
                      : "text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover/50"
                  }`}
                  onClick={() => switchSession(idx)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeSession(idx); } }}
                >
                  <span className="truncate max-w-[80px]">{session.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeSession(idx); }}
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

        {/* ── Update banner ── */}
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

        {/* ── Update progress ── */}
        {updateProgress && (
          <div className="mx-4 mt-3 nox-console-card px-4 py-3 border-l-2 border-l-nox-accent">
            <div className="nox-label text-nox-accent mb-1.5">Update wird heruntergeladen… {updateProgress.percent}%</div>
            <div className="w-full h-1.5 bg-nox-surface rounded-sm overflow-hidden">
              <div className="h-full bg-nox-accent rounded-sm transition-all duration-300" style={{ width: `${updateProgress.percent}%` }} />
            </div>
            <div className="text-[10px] text-nox-textDim mt-1">{(updateProgress.received / 1048576).toFixed(1)} / {(updateProgress.total / 1048576).toFixed(1)} MB</div>
          </div>
        )}

        {/* ── Error banners ── */}
        {!isStreaming && ollamaDown && (
          <div className="mx-4 mt-3 nox-console-card text-nox-red px-4 py-2.5 text-xs flex items-center justify-between gap-2 border-l-2 border-l-nox-red">
            <span>{t.errors?.ollamaDown || "Ollama ist nicht erreichbar"}</span>
            <button onClick={checkOllamaStatus} className="nox-btn-secondary px-2 py-0.5 text-[10px] border-nox-red/30 text-nox-red hover:bg-nox-red/10 hover:border-nox-red/50">{t.errors?.checkOllama || "Prüfen"}</button>
          </div>
        )}
        {!isStreaming && wakeModelMissing && (
          <div className="mx-4 mt-3 nox-console-card text-nox-amber px-4 py-2.5 text-xs border-l-2 border-l-nox-amber">
            {t.errors?.wakeModelMissing || "Wake-Word-Modell fehlt"}
          </div>
        )}

        {/* ── Chat messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {(messages.length === 0 || chatSessions.length === 0) && !backendStarting ? (
            /* Empty state — Gemini-style welcome */
            <div className="h-full flex flex-col items-center justify-center gap-6">
              <div className="relative">
                <div className="absolute inset-0 blur-3xl opacity-30" style={{
                  background: "radial-gradient(circle, var(--nox-accent), transparent 70%)"
                }} />
                <img src={noxIcon} alt="Nox" className="w-16 h-16 rounded-full orb-idle relative" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-display font-bold text-nox-text mb-1">
                  {username ? `Hallo ${username}, was steht an?` : "Was steht an?"}
                </h1>
                <p className="text-sm text-nox-textDim">Schreibe eine Nachricht oder klicke das Mikrofon für Spracheingabe.</p>
              </div>
              {/* Quick action chips */}
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
                    className="px-3 py-1.5 rounded-full text-xs text-nox-textDim border border-nox-border hover:border-nox-borderHover hover:text-nox-text hover:bg-nox-surface-hover transition-all"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {/* Recent conversations */}
              {recentConversations.length > 0 && (
                <div className="w-full max-w-lg">
                  <div className="text-[11px] font-medium text-nox-textFaint uppercase tracking-wide mb-2 text-left px-1">Letzte Chats</div>
                  <div className="flex flex-col gap-1">
                    {recentConversations.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleSelectConversation(conv.id)}
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
              <img src={noxIcon} alt="Nox" className="w-10 h-10 rounded-full orb-idle" />
              <span className="text-xs text-nox-textDim">{t.app?.starting || "Nox wird gestartet…"}</span>
            </div>
          ) : (
            /* Message list */
            <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-4">
              {pinnedMessages.length > 0 && (
                <div className="rounded-lg border border-nox-accent/30 bg-nox-accent/5 p-2 mb-2">
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
                  key={i}
                  msg={msg}
                  isLast={i === messages.length - 1}
                  onCopy={(text) => navigator.clipboard?.writeText(text)}
                  onSpeak={(text) => speakText(text, addToast)}
                  onRegenerate={handleRegenerate}
                  onFeedback={handleFeedback}
                  onFork={handleForkChat}
                  onPin={handlePin}
                  isPinned={pinnedMessages.some((m) => m.content === msg.content && m.role === msg.role)}
                  hasSources={msg.sources && msg.sources.length > 0}
                  addToast={addToast}
                  t={t}
                />
              ))}

              {/* Music result card */}
              {musicResult && (
                <div className="max-w-3xl mx-auto w-full">
                  <MusicCard data={musicResult} onOpen={handleOpenMusicUrl} onSetPlatform={handleSetMusicPlatform} locale={t} />
                </div>
              )}

              {/* Image result card */}
              {imageResult && (
                <div className="max-w-3xl mx-auto w-full">
                  <ImageCard data={imageResult} onClose={() => setImageResult(null)} addToast={addToast} />
                </div>
              )}

              {/* Weather result card */}
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
                        <Icon.Copy />
                      </button>
                      <button
                        onClick={() => speakText(weatherText, addToast)}
                        className="nox-action-btn"
                        title="Vorlesen"
                      >
                        <Icon.Speak />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Thinking indicator */}
              {isStreaming && messages.length > 0 && !messages[messages.length - 1]?.streaming && (
                <div className="flex gap-3 animate-bubble-in">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
                    <img src={noxIcon} alt="Nox" className="w-full h-full object-cover orb-thinking" />
                  </div>
                  <div className="flex items-center gap-1 bg-nox-surface rounded-2xl rounded-tl-sm px-4 py-3">
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-nox-accent" />
                  </div>
                </div>
              )}

              {/* Live search activity stream */}
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

        {/* ── Input bar (bottom) ── */}
        <div className="px-4 pb-4 pt-2">
          <div className="max-w-3xl mx-auto relative z-0">
            <div className={`nox-input-pill flex items-center gap-2 px-4 py-3 ${micState === "listening" ? "is-listening" : ""}`}>
              {/* Plus button with dropdown */}
              <div className="relative flex-shrink-0" ref={plusDropdownRef}>
                <button
                  onClick={() => setPlusDropdownOpen(!plusDropdownOpen)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors"
                  title="Anhängen"
                >
                  <Icon.Plus />
                </button>
                {plusDropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50">
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

              {/* Text input or audio equalizer */}
              {micState === "listening" ? (
                <AudioEqualizer isTranscribing={false} />
              ) : micState === "processing" ? (
                <AudioEqualizer isTranscribing={true} />
              ) : (
                <div className="flex-1 relative">
                  {slashMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50 max-h-64 overflow-y-auto">
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

              {/* Model selector dropdown */}
              <div className="relative flex-shrink-0" ref={modelDropdownRef}>
                <button
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-all max-w-[220px]"
                  title={t.onboarding?.switchModel || "KI-Modell wechseln"}
                >
                  <span className="truncate">{prettyModelName(currentModel)}</span>
                  {currentModelMode && MODE_LABELS[currentModelMode] && (
                    <span className="text-nox-accent text-[10px] flex-shrink-0">{MODE_LABELS[currentModelMode]}</span>
                  )}
                  <svg className="w-3 h-3 flex-shrink-0 transition-transform" style={{ transform: modelDropdownOpen ? "rotate(180deg)" : "" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {modelDropdownOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 max-h-96 overflow-y-auto rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-nox-shadow py-1 z-50">
                    {!showAllModels ? (
                      <>
                        {/* Recommended models for VRAM tier */}
                        <div className="px-3 py-1.5 text-[10px] text-nox-textDim uppercase tracking-wide border-b border-nox-border mb-1">
                          {t.onboarding?.recommended || "Empfohlen"} {gpuInfo?.vram_mb ? `· ${Math.round(gpuInfo.vram_mb / 1024)} GB VRAM` : ""}
                        </div>
                        {getRecommendedModels().map((rec) => {
                          const installed = isModelInstalled(rec.model);
                          const isCurrent = currentModel === rec.model || (installed && availableModels.find(m => m === rec.model || m.startsWith(rec.model)) === currentModel);
                          const isPulling = pullState.running && pullState.model === rec.model;
                          return (
                            <div
                              key={rec.modeKey}
                              className={`px-3 py-2 transition-colors ${isCurrent ? "bg-nox-accent/10" : "hover:bg-nox-border/50"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  onClick={() => installed && handleModelSwitch(rec.model, rec.modeKey)}
                                  disabled={!installed}
                                  className={`flex items-center gap-2 min-w-0 flex-1 text-left ${installed ? "cursor-pointer" : "cursor-default"}`}
                                >
                                  <span className="text-xs flex-shrink-0 text-nox-textDim">{MODE_LABELS[rec.modeKey]}</span>
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
                                {/* Status / action on the right */}
                                {isCurrent ? (
                                  <svg className="w-4 h-4 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : installed ? (
                                  <span className="text-green-600 dark:text-green-400 flex-shrink-0"><IconCheck size={12} /></span>
                                ) : isPulling ? (
                                  <span className="text-[10px] text-nox-accent flex-shrink-0">{Math.round(pullState.progress * 100)}%</span>
                                ) : (
                                  <button
                                    onClick={() => handleModelPull(rec.model)}
                                    disabled={pullState.running}
                                    className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                                      pullState.running ? "opacity-40 cursor-not-allowed" : "bg-nox-accent/20 text-nox-accent hover:bg-nox-accent hover:text-nox-accentFg"
                                    }`}
                                    title={`${rec.label} herunterladen`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {/* Inline progress bar when pulling this model */}
                              {isPulling && (
                                <div className="mt-1.5 w-full h-1.5 rounded-full bg-nox-border overflow-hidden">
                                  <div className="h-full bg-nox-accent transition-all duration-300 rounded-full" style={{ width: `${Math.round(pullState.progress * 100)}%` }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {/* Toggle to show all installed models */}
                        {availableModels.length > 0 && (
                          <button
                            onClick={() => setShowAllModels(true)}
                            className="w-full text-left px-3 py-2 text-xs text-nox-accent hover:bg-nox-accent/10 transition-colors border-t border-nox-border mt-1"
                          >
                            {t.onboarding?.showAllModels || "Alle KIs anzeigen"} ({availableModels.length})
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* All installed models grouped by mode */}
                        <div className="px-3 py-1.5 text-[10px] text-nox-textDim uppercase tracking-wide border-b border-nox-border mb-1">
                          {t.onboarding?.allInstalledModels || "Alle installierten KIs"}
                        </div>
                        {MODE_KEYS.map((modeKey) => {
                          const modelsInMode = availableModels.filter(m => {
                            const modes = MODEL_TO_MODES[m] || [];
                            return modes.includes(modeKey);
                          });
                          if (modelsInMode.length === 0) return null;
                          return (
                            <div key={modeKey} className="mb-1">
                              <div className="px-3 py-1 text-[10px] text-nox-textDim/70 uppercase tracking-wide">
                                {MODE_LABELS[modeKey]}
                              </div>
                              {modelsInMode.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => handleModelSwitch(m, modeKey)}
                                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                                    currentModel === m ? "bg-nox-accent/15 text-nox-text" : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">{prettyModelName(m)}</span>
                                    {MODEL_TO_MODES[m]?.[0] && MODE_LABELS[MODEL_TO_MODES[m][0]] && (
                                      <span className="text-[9px] text-nox-textDim/50 flex-shrink-0">{MODE_LABELS[MODEL_TO_MODES[m][0]]}</span>
                                    )}
                                  </div>
                                  {currentModel === m && (
                                    <svg className="w-3.5 h-3.5 text-nox-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                        {/* Models that don't fit any mode category */}
                        {(() => {
                          const uncategorized = availableModels.filter(m => !MODEL_TO_MODES[m]);
                          if (uncategorized.length === 0) return null;
                          return (
                            <div className="mb-1">
                              <div className="px-3 py-1 text-[10px] text-nox-textDim/70 uppercase tracking-wide">
                                Weitere
                              </div>
                              {uncategorized.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => handleModelSwitch(m)}
                                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                                    currentModel === m ? "bg-nox-accent/15 text-nox-text" : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                                  }`}
                                >
                                  <span className="truncate">{prettyModelName(m)}</span>
                                  {currentModel === m && (
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
                          onClick={() => setShowAllModels(false)}
                          className="w-full text-left px-3 py-2 text-xs text-nox-accent hover:bg-nox-accent/10 transition-colors border-t border-nox-border mt-1"
                        >
                          <span className="flex items-center gap-1"><IconArrowLeft size={12} /> Nur empfohlene anzeigen</span>
                        </button>
                      </>
                    )}
                    {/* Thinking toggle */}
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

              {/* Mic button with animated gradient ring while listening */}
              <div className={`nox-orb-ring flex-shrink-0 ${micState === "listening" ? "is-listening" : ""}`}>
                <button
                  onClick={handleMicClick}
                  disabled={voiceDisabled}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    micState === "listening"
                      ? "bg-nox-accent text-nox-accentFg"
                      : voiceDisabled
                      ? "text-nox-textDim opacity-40 cursor-not-allowed"
                      : "text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover"
                  }`}
                  title="Spracheingabe"
                >
                  {micState === "listening" ? <Icon.MicActive /> : <Icon.Mic />}
                </button>
              </div>

              {/* Send / Stop button */}
              {isStreaming || micState === "processing" || micState === "speaking" ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleStopGeneration}
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-surface-hover text-nox-text hover:bg-nox-red/20 hover:text-nox-red transition-all"
                    title="Stopp"
                  >
                    <Icon.Stop />
                  </button>
                  {input.trim() && (
                    <button
                      onClick={sendMessage}
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-accent text-nox-accentFg hover:bg-nox-accentHover transition-all"
                      title="Senden"
                    >
                      <Icon.Send />
                    </button>
                  )}
                </div>
              ) : input.trim() ? (
                <button
                  onClick={sendMessage}
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-nox-accent text-nox-accentFg hover:bg-nox-accentHover transition-all"
                  title="Senden"
                >
                  <Icon.Send />
                </button>
              ) : micState !== "idle" ? (
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center">
                  <span className="nox-status-dot" />
                </div>
              ) : null}
            </div>

            {/* Footer hint */}
            <div className="text-center mt-2">
              <span className="text-[10px] text-nox-textFaint">Nox ist ein KI-Assistent und kann Fehler machen.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Gemini-style sidebar overlay */}
      <GeminiSidebar
        isOpen={geminiSidebarOpen}
        onClose={() => setGeminiSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onOpenSettings={() => { setGeminiSidebarOpen(false); setShowSettings(true); }}
        onLocaleChange={async (langCode) => {
          const loader = LOCALE_MAP[langCode];
          if (loader) {
            const mod = await loader();
            setLocaleData(mod.default);
          }
        }}
        locale={t}
      />

      {/* Profile panel overlay */}
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
    </div>
  );
}
