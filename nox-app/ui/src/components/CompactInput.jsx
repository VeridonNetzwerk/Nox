import React, { useRef, useState } from "react";

export default function CompactInput({
  value,
  onChange,
  onSend,
  onKeyDown,
  placeholder,
  disabled,
  micState,
  onMicClick,
  micDisabled,
  micLabel,
  locale,
}) {
  const textareaRef = useRef(null);
  const [focused, setFocused] = useState(false);

  const micColor =
    micState === "listening"
      ? "text-red-400"
      : micState === "processing"
      ? "text-yellow-400"
      : micState === "speaking"
      ? "text-green-400"
      : "text-nox-textDim";

  return (
    <div className="flex items-center justify-center px-4 pb-3 pt-2">
      <div
        className={`flex items-end gap-2 glass-input px-2 py-1.5 transition-all duration-300 ${
          focused ? "ring-2 ring-nox-accent/30" : ""
        }`}
        style={{ width: "100%" }}
      >
        {/* Mic button */}
        <button
          onClick={onMicClick}
          disabled={micDisabled}
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${micColor} ${
            micDisabled ? "opacity-30 cursor-not-allowed" : "hover:scale-110 hover:bg-nox-accent/10"
          }`}
          aria-label={micLabel}
          title={micLabel}
        >
          {micState === "speaking" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          ) : micState === "processing" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ animationDuration: "2s" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          )}
        </button>

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-nox-text text-sm py-1.5 resize-none max-h-32 focus:outline-none placeholder:text-nox-textDim"
          disabled={disabled}
          style={{ WebkitAppRegion: "no-drag" }}
        />

        {/* Send button */}
        <button
          onClick={onSend}
          disabled={!value?.trim() || disabled}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-nox-accent hover:bg-nox-accentHover disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center transition-all hover:scale-110"
          aria-label={locale?.app?.send || "Senden"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
