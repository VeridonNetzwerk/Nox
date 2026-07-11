import React from "react";
import noxIcon from "../assets/nox-icon.png";

export default function ChatBubble({ msg, onSpeak, locale }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const isAssistant = msg.role === "assistant";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-bubble-in`}
    >
      <div
        className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "glass-card rounded-2xl rounded-br-md text-nox-text"
            : isError
            ? "bg-red-500/15 text-red-400 border border-red-500/30 rounded-2xl rounded-bl-md"
            : "glass-card rounded-2xl rounded-bl-md text-nox-text"
        }`}
      >
        {isAssistant && (
          <div className="flex items-center gap-1.5 mb-1">
            <img src={noxIcon} alt="Nox" className="w-4 h-4 rounded-full" />
            <span className="text-xs font-medium text-nox-textDim">Nox</span>
          </div>
        )}
        <div className="text-nox-text whitespace-pre-wrap break-words">
          {msg.content}
          {msg.streaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-nox-accent animate-pulse rounded-sm align-middle" />
          )}
        </div>
        {isAssistant && !msg.streaming && msg.content && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => onSpeak?.(msg.content)}
              className="inline-flex items-center gap-1 text-xs text-nox-textDim hover:text-nox-accent transition-colors"
              title="Vorlesen"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
            {msg.voice && (
              <span className="text-[10px] text-nox-textDim">🎤</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
