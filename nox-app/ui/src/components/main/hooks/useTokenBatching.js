import { useState, useRef, useCallback, useEffect } from "react";

export function useTokenBatching(setMessages, nextMsgId) {
  const tokenBufferRef = useRef("");
  const tokenCountRef = useRef(0);
  const rafFlushRef = useRef(null);

  const flushTokens = useCallback(() => {
    rafFlushRef.current = null;
    const buf = tokenBufferRef.current;
    const count = tokenCountRef.current;
    if (!buf && count === 0) return;
    tokenBufferRef.current = "";
    tokenCountRef.current = 0;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        const baseContent = last.content === "Modell wird geladen…" ? "" : last.content;
        const updated = { ...last, content: baseContent + buf };
        if (count > 0) {
          updated.tokenCount = (last.tokenCount || 0) + count;
          if (!last.streamStartedAt) updated.streamStartedAt = Date.now();
          if (last.thinking && !last.thinkingDurationMs && last.thinkingStartedAt) {
            updated.thinkingDurationMs = Date.now() - last.thinkingStartedAt;
          }
        }
        return [...prev.slice(0, -1), updated];
      }
      return [...prev, { id: nextMsgId(), role: "assistant", content: buf, streaming: true, tokenCount: count, streamStartedAt: Date.now() }];
    });
  }, [setMessages, nextMsgId]);

  const bufferToken = useCallback((content) => {
    tokenBufferRef.current += content;
    tokenCountRef.current += 1;
    if (rafFlushRef.current === null) {
      rafFlushRef.current = requestAnimationFrame(flushTokens);
    }
  }, [flushTokens]);

  const flushNow = useCallback(() => {
    if (rafFlushRef.current !== null) {
      cancelAnimationFrame(rafFlushRef.current);
      flushTokens();
    }
  }, [flushTokens]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafFlushRef.current !== null) {
        cancelAnimationFrame(rafFlushRef.current);
        rafFlushRef.current = null;
      }
    };
  }, []);

  return { tokenBufferRef, tokenCountRef, rafFlushRef, flushTokens, bufferToken, flushNow };
}
