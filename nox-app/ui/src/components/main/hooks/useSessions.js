import { useState, useRef, useEffect, useCallback } from "react";
import { API_BASE } from "../../../shared/constants.jsx";

const DEFAULT_SESSION = { id: "default", label: "Chat 1", messages: [], musicResult: null, imageResult: null, weatherResult: null, weatherText: null, conversationId: null };

export function useSessions(addToast, nextMsgId) {
  const [chatSessions, setChatSessions] = useState([{ ...DEFAULT_SESSION }]);
  const [activeSession, setActiveSession] = useState(0);
  const activeSessionRef = useRef(0);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  const [recentConversations, setRecentConversations] = useState([]);

  const withCurrentSessionSaved = useCallback((sessions, sessionState) => {
    const updated = [...sessions];
    if (updated[sessionState.activeSession]) {
      updated[sessionState.activeSession] = {
        ...updated[sessionState.activeSession],
        messages: sessionState.messages,
        musicResult: sessionState.musicResult,
        imageResult: sessionState.imageResult,
        weatherResult: sessionState.weatherResult,
        weatherText: sessionState.weatherText,
      };
    }
    return updated;
  }, []);

  const switchSession = useCallback((idx, sessionState) => {
    if (idx === sessionState.activeSession || sessionState.chatSessions.length === 0) return;
    const updated = withCurrentSessionSaved(sessionState.chatSessions, sessionState);
    setChatSessions(updated);
    setActiveSession(idx);
    sessionState.setMessages(updated[idx].messages || []);
    sessionState.setMusicResult(updated[idx].musicResult || null);
    sessionState.setImageResult(updated[idx].imageResult || null);
    sessionState.setWeatherResult(updated[idx].weatherResult || null);
    sessionState.setWeatherText(updated[idx].weatherText || null);
    sessionState.setActiveTool(null);
    sessionState.setSearchStreams([]);
  }, [withCurrentSessionSaved]);

  const addNewSession = useCallback((sessionState) => {
    if (sessionState.chatSessions.length === 0) {
      setChatSessions([{ id: `session-${Date.now()}`, label: "Chat 1", messages: [], musicResult: null, imageResult: null, weatherResult: null, weatherText: null, conversationId: null }]);
      setActiveSession(0);
      sessionState.setMessages([]);
      sessionState.setMusicResult(null);
      sessionState.setWeatherResult(null);
      sessionState.setWeatherText(null);
      sessionState.setActiveTool(null);
      sessionState.setSearchStreams([]);
      sessionState.setInput("");
      return;
    }
    const updated = withCurrentSessionSaved(sessionState.chatSessions, sessionState);
    const newIdx = updated.length;
    updated.push({ id: `session-${Date.now()}`, label: `Chat ${newIdx + 1}`, messages: [], musicResult: null, imageResult: null, weatherResult: null, weatherText: null, conversationId: null });
    setChatSessions(updated);
    setActiveSession(newIdx);
    sessionState.setMessages([]);
    sessionState.setMusicResult(null);
    sessionState.setImageResult(null);
    sessionState.setWeatherResult(null);
    sessionState.setWeatherText(null);
    sessionState.setActiveTool(null);
    sessionState.setSearchStreams([]);
    sessionState.setInput("");
  }, [withCurrentSessionSaved]);

  const closeSession = useCallback((idx, sessionState) => {
    const updated = withCurrentSessionSaved(sessionState.chatSessions, sessionState);
    const filtered = updated.filter((_, i) => i !== idx);
    if (filtered.length === 0) {
      setChatSessions([]);
      setActiveSession(0);
      sessionState.setMessages([]);
      sessionState.setMusicResult(null);
      sessionState.setImageResult(null);
      sessionState.setWeatherResult(null);
      sessionState.setWeatherText(null);
      return;
    }
    let newActive = sessionState.activeSession;
    if (sessionState.activeSession === idx) {
      newActive = Math.max(0, idx - 1);
    } else if (sessionState.activeSession > idx) {
      newActive = sessionState.activeSession - 1;
    }
    setChatSessions(filtered);
    setActiveSession(newActive);
    sessionState.setMessages(filtered[newActive]?.messages || []);
    sessionState.setMusicResult(filtered[newActive]?.musicResult || null);
    sessionState.setImageResult(filtered[newActive]?.imageResult || null);
    sessionState.setWeatherResult(filtered[newActive]?.weatherResult || null);
    sessionState.setWeatherText(filtered[newActive]?.weatherText || null);
  }, [withCurrentSessionSaved]);

  const handleSelectConversation = useCallback(async (conversationId, sessionState) => {
    const existingIdx = sessionState.chatSessions.findIndex((s) => s.conversationId === conversationId);
    if (existingIdx >= 0) {
      switchSession(existingIdx, sessionState);
      return;
    }
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
              id: nextMsgId(),
              role: t.role,
              content: t.content,
              streaming: false,
              voice: t.voice_input,
              stats: parsedStats,
            };
          });
        const title = data.title || loadedMessages.find(m => m.role === "user")?.content?.slice(0, 30) || "Chat";

        setChatSessions((prev) => {
          const updated = withCurrentSessionSaved(prev, sessionState);
          const newIdx = updated.length;
          updated.push({ id: `session-${Date.now()}`, label: title, messages: loadedMessages, musicResult: null, imageResult: null, weatherResult: null, weatherText: null, conversationId });
          return updated;
        });
        const newIdx = sessionState.chatSessions.length;
        setActiveSession(newIdx);
        sessionState.setMessages(loadedMessages);
        sessionState.setMusicResult(null);
        sessionState.setImageResult(null);
        sessionState.setWeatherResult(null);
        sessionState.setWeatherText(null);
        sessionState.setActiveTool(null);
        sessionState.setSearchStreams([]);
        sessionState.setInput("");
      }
    } catch (err) {
      addToast({ type: "warning", title: "Verlauf", message: "Unterhaltung konnte nicht geladen werden.", duration: 4000 });
    }
  }, [withCurrentSessionSaved, switchSession, addToast, nextMsgId]);

  // Fetch recent conversations
  const fetchRecentConversations = useCallback((backendReady) => {
    if (!backendReady) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/conversation/list?limit=5`);
        const data = await res.json();
        if (data.status === "ok") setRecentConversations(data.conversations || []);
      } catch {}
    })();
  }, []);

  return {
    chatSessions,
    setChatSessions,
    activeSession,
    setActiveSession,
    activeSessionRef,
    recentConversations,
    setRecentConversations,
    fetchRecentConversations,
    switchSession,
    addNewSession,
    closeSession,
    handleSelectConversation,
  };
}
