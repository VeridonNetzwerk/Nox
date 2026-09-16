import { useEffect, useRef } from "react";
import { WS_URL, API_BASE } from "../../../shared/constants.jsx";
import { prettyModelName } from "../../../shared/prettyNames.jsx";

export function useWebSocket(ctx) {
  const {
    setConnectionStatus,
    setBackendReady,
    setMicState,
    setShowSettings,
    setShowOnboarding,
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
    setChatSessions,
    setRecentConversations,
    setCurrentModel,
    setCurrentModelMode,
    addToast,
    nextMsgId,
    flushTokens,
    flushNow,
    messagesRef,
    activeSessionRef,
    streamingTimerRef,
    hasConnectedOnceRef,
  } = ctx;

  const wsRef = useRef(null);
  const wsReconnectRef = useRef(0);

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
            { id: nextMsgId(), role: "user", content: data.content, streaming: false, voice: data.voice_input },
          ]);
          setIsStreaming(true);
          setMusicResult(null);
          if (streamingTimerRef.current) clearTimeout(streamingTimerRef.current);
          streamingTimerRef.current = setTimeout(() => {
            setIsStreaming(false);
            setMicState("idle");
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
          const sIdx = activeSessionRef.current;
          setChatSessions((prev) => {
            if (!prev[sIdx]) return prev;
            const updated = [...prev];
            updated[sIdx] = { ...updated[sIdx], imageResult: data };
            return updated;
          });
          return;
        }

        if (data.type === "weather_result") {
          setWeatherResult(data.data);
          const sIdx = activeSessionRef.current;
          setChatSessions((prev) => {
            if (!prev[sIdx]) return prev;
            const updated = [...prev];
            updated[sIdx] = { ...updated[sIdx], weatherResult: data.data };
            return updated;
          });
          return;
        }

        if (data.type === "done" && data.card_only) {
          flushNow();
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setWeatherText(data.card_text || "");
          const sIdx = activeSessionRef.current;
          setChatSessions((prev) => {
            if (!prev[sIdx]) return prev;
            const updated = [...prev];
            updated[sIdx] = { ...updated[sIdx], weatherText: data.card_text || "" };
            return updated;
          });
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
          const totalMsgs = messagesRef.current.length + 1;
          if (totalMsgs === 1 || totalMsgs % 3 === 0) {
            fetch(`${API_BASE}/api/conversation/generate-title`, { method: "POST" })
              .then(r => r.json())
              .then(titleData => {
                if (titleData.status === "ok" && titleData.title) {
                  setChatSessions((prev) => {
                    const updated = [...prev];
                    const sIdx = activeSessionRef.current;
                    if (!updated[sIdx]) return prev;
                    updated[sIdx] = { ...updated[sIdx], label: titleData.title };
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
          flushNow();
          setActiveTool(data.tool || null);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [...prev.slice(0, -1), {
                ...last,
                streaming: false,
                toolCalls: [...(last.toolCalls || []), { name: data.tool, result: null }],
              }];
            }
            return prev;
          });
          return;
        }

        if (data.type === "tool_result") {
          setActiveTool(null);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.toolCalls && last.toolCalls.length > 0) {
              const updatedToolCalls = [...last.toolCalls];
              updatedToolCalls[updatedToolCalls.length - 1] = {
                ...updatedToolCalls[updatedToolCalls.length - 1],
                result: data.result,
              };
              return [...prev.slice(0, -1), { ...last, toolCalls: updatedToolCalls }];
            }
            return prev;
          });
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

        if (data.type === "thinking") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
              return [...prev.slice(0, -1), {
                ...last,
                thinking: (last.thinking || "") + data.content,
                thinkingStartedAt: last.thinkingStartedAt || Date.now(),
              }];
            }
            return [...prev, { id: nextMsgId(), role: "assistant", content: "", streaming: true, thinking: data.content, thinkingStartedAt: Date.now() }];
          });
          return;
        }

        if (data.type === "token") {
          ctx.bufferToken(data.content);
        } else if (data.type === "done") {
          flushNow();
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              const newVersion = { content: data.content, stats: data.stats || null, model: data.model || null };
              const thinkingDurationMs = last.thinkingDurationMs
                || (last.thinking && last.thinkingStartedAt ? Date.now() - last.thinkingStartedAt : undefined);
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
                  thinkingDurationMs,
                }];
              }
              return [...prev.slice(0, -1), { ...last, streaming: false, content: data.content || (last.content === "Modell wird geladen…" ? "" : last.content), stats: data.stats || null, model: data.model || null, thinkingDurationMs }];
            }
            return prev;
          });
          setIsStreaming(false);
          setActiveTool(null);
          setSearchStreams([]);

          const totalMsgs = messagesRef.current.length + 1;
          if (totalMsgs === 1 || totalMsgs % 3 === 0) {
            fetch(`${API_BASE}/api/conversation/generate-title`, { method: "POST" })
              .then(r => r.json())
              .then(titleData => {
                if (titleData.status === "ok" && titleData.title) {
                  setChatSessions((prev) => {
                    const updated = [...prev];
                    const sIdx = activeSessionRef.current;
                    if (!updated[sIdx]) return prev;
                    updated[sIdx] = { ...updated[sIdx], label: titleData.title };
                    return updated;
                  });
                  setRecentConversations(prev => prev.map(c =>
                    c.id === titleData.conversation_id ? { ...c, title: titleData.title } : c
                  ));
                }
              })
              .catch(() => {});
          }
        } else if (data.type === "aborted") {
          flushNow();
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming) {
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
        } else if (data.type === "status") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.streaming && (!last.content || last.content === "Modell wird geladen…")) {
              return [...prev.slice(0, -1), { ...last, content: data.content }];
            }
            return [...prev, { id: nextMsgId(), role: "assistant", content: data.content, streaming: true }];
          });
        } else if (data.type === "error") {
          flushNow();
          if (streamingTimerRef.current) { clearTimeout(streamingTimerRef.current); streamingTimerRef.current = null; }
          setMessages((prev) => [...prev, { id: nextMsgId(), role: "error", content: data.content, streaming: false }]);
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

  return { wsRef };
}
