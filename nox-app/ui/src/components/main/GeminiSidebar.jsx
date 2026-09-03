import React, { useState, useEffect, useRef } from "react";
import noxIcon from "../../assets/nox-icon.png";
import { LOCALE_MAP, WS_URL, API_BASE, speakText } from "../../shared/constants.jsx";
import { useToast } from "../common/Toast.jsx";

const menuItems = [
  { icon: "sparkle", label: "Neuer Chat", onClick: "newChat" },
  { icon: "search", label: "Chats durchsuchen", onClick: "search" },
  { icon: "settings", label: "Einstellungen", onClick: "settings" },
];

function SidebarIcon({ name }) {
  if (name === "sparkle") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-nox-accent">
        <path d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-nox-textDim">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-nox-textDim">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  return null;
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  if (diffHr < 24) return `vor ${diffHr} Std`;
  if (diffDay < 7) return `vor ${diffDay} Tag${diffDay > 1 ? "en" : ""}`;
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

export default function GeminiSidebar({ isOpen, onClose, onNewChat, onSelectConversation, onOpenSettings, onLocaleChange, locale }) {
  const { addToast } = useToast();
  const [conversations, setConversations] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    if (!searchOpen) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/conversation/list?limit=200`);
        const data = await res.json();
        const all = data.conversations || [];
        const q = searchQuery.toLowerCase();
        const filtered = all.filter((c) => c.title?.toLowerCase().includes(q));
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 250);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchData = async () => {
      try {
        const [convRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/api/conversation/list?limit=30`),
          fetch(`${API_BASE}/api/status`),
        ]);
        const convData = await convRes.json();
        const statusData = await statusRes.json();
        if (convData.status === "ok") setConversations(convData.conversations || []);
        setSystemStatus(statusData);
      } catch {
        // Backend might not be ready yet
      }
    };
    fetchData();
  }, [isOpen]);

  if (!isOpen) return null;

  const drawerWidth = "w-[300px]";

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-nox-backdrop/40 transition-opacity" />

      {/* Drawer */}
      <div
        className={`absolute left-0 top-0 h-full ${drawerWidth} bg-nox-surface-raised border-r border-nox-border shadow-2xl flex flex-col transition-all duration-200`}
        style={{ animation: "slide-in-left 0.2s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Chat list view ── */}
        <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-nox-border">
              <div className="flex items-center gap-2">
                <img src={noxIcon} alt="Nox" className="w-6 h-6 rounded-full" />
                <span className="text-base font-semibold text-nox-text">Nox</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onNewChat} className="p-2 rounded-full hover:bg-nox-surface-hover text-nox-textDim hover:text-nox-text transition-colors" title="Neu">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-nox-surface-hover text-nox-textDim hover:text-nox-text transition-colors"
                  title="Schließen"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search bar */}
            {searchOpen && (
              <div className="px-4 pb-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Unterhaltungen durchsuchen…"
                  className="w-full px-3 py-2 rounded-lg bg-nox-bgSolid text-sm text-nox-text placeholder-nox-textDim border border-nox-border focus:border-nox-accent outline-none"
                  autoFocus
                />
              </div>
            )}

            {/* Recent chats / Search results */}
            <div className="flex-1 min-h-0 px-5 py-2">
              {searchOpen ? (
                <>
                  <div className="text-[11px] font-medium text-nox-textFaint uppercase tracking-wider mb-2">Suchergebnisse</div>
                  <div className="overflow-y-auto pr-1 h-full pb-2 custom-scrollbar">
                    {searching ? (
                      <div className="text-xs text-nox-textFaint px-2 py-4">Suche läuft…</div>
                    ) : searchResults.length === 0 ? (
                      <div className="text-xs text-nox-textFaint px-2 py-4">{searchQuery ? "Keine Treffer." : "Suchbegriff eingeben."}</div>
                    ) : (
                      searchResults.map((conv) => (
                        <button
                          key={conv.id}
                          onClick={() => {
                            if (onSelectConversation) onSelectConversation(conv.id);
                            onClose();
                          }}
                          className="w-full text-left px-2 py-2 rounded-lg text-xs text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors truncate"
                          title={conv.title}
                        >
                          <div className="truncate">{conv.title}</div>
                          <div className="text-[10px] text-nox-textFaint mt-0.5">{formatTimestamp(conv.timestamp)}</div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-medium text-nox-textFaint uppercase tracking-wider mb-2">Letzte Unterhaltungen</div>
                  <div className="overflow-y-auto pr-1 h-full pb-2 custom-scrollbar">
                    {conversations.length === 0 ? (
                      <div className="text-xs text-nox-textFaint px-2 py-4">Noch keine Unterhaltungen.</div>
                    ) : (
                      conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className="group w-full text-left px-2 py-2 rounded-lg text-xs text-nox-textDim hover:text-nox-text hover:bg-nox-surface-hover transition-colors truncate"
                          title={conv.title}
                        >
                          <button
                            onClick={() => {
                              if (onSelectConversation) onSelectConversation(conv.id);
                              onClose();
                            }}
                            className="w-full text-left truncate"
                          >
                            <div className="truncate">{conv.title}</div>
                            <div className="text-[10px] text-nox-textFaint mt-0.5">{formatTimestamp(conv.timestamp)}</div>
                          </button>
                          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { window.open(`${API_BASE}/api/conversation/${conv.id}/export?format=markdown`, "_blank"); }}
                              className="text-[10px] px-1.5 py-0.5 rounded text-nox-textFaint hover:text-nox-accent hover:bg-nox-border/50 transition-colors"
                              title="Als Markdown exportieren"
                            >MD</button>
                            <button
                              onClick={() => { window.open(`${API_BASE}/api/conversation/${conv.id}/export?format=json`, "_blank"); }}
                              className="text-[10px] px-1.5 py-0.5 rounded text-nox-textFaint hover:text-nox-accent hover:bg-nox-border/50 transition-colors"
                              title="Als JSON exportieren"
                            >JSON</button>
                            <button
                              onClick={() => { window.open(`${API_BASE}/api/conversation/${conv.id}/export?format=text`, "_blank"); }}
                              className="text-[10px] px-1.5 py-0.5 rounded text-nox-textFaint hover:text-nox-accent hover:bg-nox-border/50 transition-colors"
                              title="Als Text exportieren"
                            >TXT</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Main menu — at bottom for consistency with narrow sidebar */}
            <div className="px-3 py-2 flex flex-col gap-0.5 border-t border-nox-border">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    if (item.onClick === "newChat") onNewChat();
                    if (item.onClick === "search") setSearchOpen((v) => !v);
                    if (item.onClick === "settings") { onClose(); onOpenSettings?.(); }
                  }}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${searchOpen && item.onClick === "search" ? "bg-nox-surface-hover text-nox-text" : "text-nox-text hover:bg-nox-surface-hover"}`}
                >
                  <span className="w-5 h-5 flex items-center justify-center text-nox-textDim">
                    <SidebarIcon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* System status footer */}
            <div className="px-4 py-3 border-t border-nox-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <img src={noxIcon} alt="Nox" className="w-6 h-6 rounded-full" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-nox-text">Nox</span>
                    <span className="text-[10px] text-nox-textFaint">Lokaler Assistent</span>
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full ${systemStatus?.status === "ok" ? "bg-green-500 dark:bg-green-400" : "bg-red-500 dark:bg-red-400"}`} style={{ boxShadow: systemStatus?.status === "ok" ? "0 0 6px rgba(74,222,128,0.6)" : "none" }} />
              </div>
              {systemStatus && (
                <div className="flex flex-col gap-1 text-[10px] text-nox-textFaint">
                  <div className="flex items-center justify-between">
                    <span>Modell</span>
                    <span className="text-nox-textDim font-mono">{systemStatus.ollama?.status === "ok" ? "Bereit" : "Offline"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Wake Word</span>
                    <span className="text-nox-textDim font-mono">{systemStatus.voice?.wake_word?.available ? "Aktiv" : "Inaktiv"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>STT</span>
                    <span className="text-nox-textDim font-mono">{systemStatus.voice?.stt?.available ? "Bereit" : "Offline"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>TTS</span>
                    <span className="text-nox-textDim font-mono">{systemStatus.voice?.tts?.available ? "Bereit" : "Offline"}</span>
                  </div>
                </div>
              )}
            </div>
          </>
      </div>
    </div>
  );
}
