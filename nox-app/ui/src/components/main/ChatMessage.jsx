import React, { useState } from "react";
import { IconWarning } from "../../shared/Icon.jsx";
import { speakText } from "../../shared/constants.jsx";
import NoxAvatar from "../common/NoxAvatar.jsx";
import MarkdownText from "../common/MarkdownText.jsx";

const Icon = {
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

function formatDuration(ns) {
  if (!ns || ns <= 0) return "—";
  const ms = ns / 1e6;
  if (ms < 1) return `${ns} ns`;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const ChatMessage = React.memo(function ChatMessage({ msg, isLast, onCopy, onSpeak, onRegenerate, onFeedback, onFork, onPin, isPinned, hasSources, addToast, t }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const [feedback, setFeedback] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showToolCall, setShowToolCall] = useState(false);

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

  const curStats = versions[versionIndex]?.stats || msg.stats || {};
  const curContent = versions[versionIndex]?.content ?? msg.content;

  const THINK_OPEN = "<" + "think" + ">";
  const THINK_CLOSE = "<" + "/think" + ">";
  let displayContent = curContent;
  let thinkText = msg.thinking || "";
  if (!isUser && !isError && typeof curContent === "string" && curContent.includes(THINK_OPEN)) {
    const openIdx = curContent.indexOf(THINK_OPEN);
    const afterOpen = curContent.slice(openIdx + THINK_OPEN.length);
    const closeIdx = afterOpen.indexOf(THINK_CLOSE);
    if (!thinkText) {
      thinkText = (closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx)).trim();
    }
    displayContent = (curContent.slice(0, openIdx)
      + (closeIdx === -1 ? "" : afterOpen.slice(closeIdx + THINK_CLOSE.length))).trim();
  } else if (!isUser && !isError && typeof curContent === "string" && curContent.includes(THINK_CLOSE)) {
    displayContent = curContent.split(THINK_CLOSE).join("").trim();
  }

  const CALL_OPEN = "<" + "call:tool_code" + ">";
  const CALL_CLOSE = "<" + "/call:tool_code" + ">";
  let toolCallsFromContent = msg.toolCalls || [];
  if (!isUser && !isError && typeof displayContent === "string" && displayContent.includes(CALL_OPEN)) {
    const calls = [];
    let remaining = displayContent;
    while (remaining.includes(CALL_OPEN)) {
      const startIdx = remaining.indexOf(CALL_OPEN);
      const afterOpen = remaining.slice(startIdx + CALL_OPEN.length);
      const endIdx = afterOpen.indexOf(CALL_CLOSE);
      const block = endIdx === -1 ? afterOpen : afterOpen.slice(0, endIdx);
      const fnMatch = block.match(/<function=(\w+)>/);
      if (fnMatch) {
        const params = {};
        const paramRegex = /<parameter=(\w+)>(.*?)<\/parameter>/g;
        let pm;
        while ((pm = paramRegex.exec(block)) !== null) {
          params[pm[1]] = pm[2].trim();
        }
        calls.push({ name: fnMatch[1], arguments: params, result: null });
      }
      remaining = endIdx === -1 ? "" : afterOpen.slice(endIdx + CALL_CLOSE.length);
    }
    if (calls.length > 0) {
      toolCallsFromContent = [...toolCallsFromContent, ...calls];
      displayContent = remaining.trim();
    }
  }

  const thinking = thinkText;
  const thinkSeconds = msg.thinkingDurationMs ? Math.max(1, Math.round(msg.thinkingDurationMs / 1000)) : null;
  const stillThinking = msg.streaming && thinking && !msg.thinkingDurationMs;
  const hasToolCalls = toolCallsFromContent.length > 0;

  const liveTokPerSec = !isUser && !isError && msg.streaming && msg.tokenCount > 0 && msg.streamStartedAt
    ? msg.tokenCount / Math.max(0.5, (Date.now() - msg.streamStartedAt) / 1000)
    : null;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} animate-bubble-in`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
          <NoxAvatar size={28} />
        </div>
      )}

      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && !isError && thinking && (
          <>
            <button
              onClick={() => setShowThinking((s) => !s)}
              className="group flex items-center gap-1.5 text-xs text-nox-textDim hover:text-nox-text transition-colors px-1 py-0.5 rounded-md hover:bg-nox-surface-hover/60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54Z" />
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54Z" />
              </svg>
              <span>{stillThinking ? "Denkt nach…" : `Thought for ${thinkSeconds}s`}</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`flex-shrink-0 transition-all duration-150 ${showThinking ? "rotate-90" : ""} ${showThinking ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {showThinking && (
              <div
                className="w-full rounded-xl px-3 py-2 text-xs leading-relaxed text-nox-textDim whitespace-pre-wrap break-words max-h-64 overflow-y-auto border border-nox-border"
                style={{ background: "color-mix(in srgb, var(--nox-surface) 50%, transparent)" }}
              >
                {thinking}
              </div>
            )}
          </>
        )}
        {!isUser && !isError && hasToolCalls && (
          <>
            <button
              onClick={() => setShowToolCall((s) => !s)}
              className="group flex items-center gap-1.5 text-xs text-nox-textDim hover:text-nox-text transition-colors px-1 py-0.5 rounded-md hover:bg-nox-surface-hover/60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span>{toolCallsFromContent.length === 1 ? "1 Werkzeug-Aufruf" : `${toolCallsFromContent.length} Werkzeug-Aufrufe`}</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`flex-shrink-0 transition-all duration-150 ${showToolCall ? "rotate-90" : ""} ${showToolCall ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {showToolCall && (
              <div className="w-full rounded-xl border border-nox-border overflow-hidden" style={{ background: "color-mix(in srgb, var(--nox-surface) 50%, transparent)" }}>
                {toolCallsFromContent.map((tc, i) => (
                  <div key={i} className={i > 0 ? "border-t border-nox-border" : ""}>
                    <div className="px-3 py-1.5 flex items-center gap-2 bg-nox-surface-hover/30">
                      <span className="text-xs font-medium text-nox-accent">{tc.name}</span>
                      {tc.result !== null && tc.result !== undefined && (
                        <span className="text-xs text-green-500">✓</span>
                      )}
                    </div>
                    {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                      <div className="px-3 py-1.5 text-xs text-nox-textDim space-y-0.5">
                        {Object.entries(tc.arguments).map(([k, v]) => (
                          <div key={k} className="flex gap-1">
                            <span className="text-nox-textDim/70">{k}:</span>
                            <span className="text-nox-text">{String(v).slice(0, 200)}{String(v).length > 200 ? "…" : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {tc.result !== null && tc.result !== undefined && (
                      <div className="px-3 py-1.5 text-xs text-nox-textDim border-t border-nox-border/50">
                        <span className="text-nox-textDim/70 mb-0.5 block">Ergebnis:</span>
                        <span className="whitespace-pre-wrap">{String(tc.result).slice(0, 300)}{String(tc.result).length > 300 ? "…" : ""}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
            isUser
              ? "text-nox-text rounded-tr-sm whitespace-pre-wrap backdrop-blur-sm border border-nox-accent/20"
              : isError
              ? "bg-nox-red/20 text-nox-red rounded-tl-sm border border-nox-red/40 whitespace-pre-wrap"
              : "text-nox-text rounded-tl-sm backdrop-blur-sm border border-nox-border"
          }`}
          style={isUser ? {
            background: "color-mix(in srgb, var(--nox-accent) 12%, var(--nox-surface))",
          } : isError ? undefined : {
            background: "color-mix(in srgb, var(--nox-surface) 70%, transparent)",
          }}
        >
          {isUser || isError || msg.streaming ? (
            isError ? (
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-nox-red/30 text-nox-red border border-nox-red/40 flex items-center justify-center mt-0.5">
                  <IconWarning size={12} weight={28} />
                </span>
                <span className="whitespace-pre-wrap">{curContent}</span>
              </div>
            ) : (
              isUser ? curContent : displayContent
            )
          ) : (
            <MarkdownText content={displayContent} addToast={addToast} />
          )}
          {isLast && msg.streaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-nox-accent animate-pulse rounded-sm align-middle" />
          )}
        </div>

        {!isUser && !isError && msg.streaming && liveTokPerSec && (
          <div className="text-[11px] text-nox-textDim/70 px-1 select-none tabular-nums">
            {liveTokPerSec.toFixed(1)} tok/s
          </div>
        )}

        {!isUser && !msg.streaming && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => { navigator.clipboard?.writeText(displayContent); addToast({ type: "info", title: "Kopiert", message: "Antwort in Zwischenablage kopiert", duration: 2000 }); }}
              className="nox-action-btn"
              title="Kopieren"
            >
              <Icon.Copy />
            </button>
            <button
              onClick={() => speakText(displayContent, addToast)}
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
            <button
              onClick={() => setShowStats(s => !s)}
              className={`nox-action-btn ${showStats ? "text-nox-accent" : ""}`}
              title="Antwort-Statistiken"
            >
              <Icon.ChartIcon />
            </button>
          </div>
        )}

        {!isUser && !msg.streaming && showStats && (
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
                  <div className="flex justify-between">
                    <span className="text-nox-textDim">Geschwindigkeit</span>
                    <span className="text-nox-text">
                      {curStats.eval_count > 0 && curStats.eval_duration_ns > 0
                        ? `${(curStats.eval_count / (curStats.eval_duration_ns / 1e9)).toFixed(1)} tok/s`
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

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
});

export default ChatMessage;
