import React, { useState, useEffect, useRef } from "react";
import deLocale from "../locales/de.json";

export const API_BASE = "http://127.0.0.1:8420";
export const WS_URL = "ws://127.0.0.1:8420/ws/chat";

export const LOCALE_MAP = {
  "de_DE": () => Promise.resolve({ default: deLocale }),
  "en_US": () => import("../locales/en_US.json"),
  "en_GB": () => import("../locales/en_GB.json"),
  "fr_FR": () => import("../locales/fr_FR.json"),
  "es_ES": () => import("../locales/es_ES.json"),
  "es_MX": () => import("../locales/es_MX.json"),
  "it_IT": () => import("../locales/it_IT.json"),
  "ja_JP": () => import("../locales/ja_JP.json"),
  "zh_CN": () => import("../locales/zh_CN.json"),
  "nl_NL": () => import("../locales/nl_NL.json"),
  "pl_PL": () => import("../locales/pl_PL.json"),
  "pt_BR": () => import("../locales/pt_BR.json"),
  "pt_PT": () => import("../locales/pt_PT.json"),
  "ru_RU": () => import("../locales/ru_RU.json"),
  "tr_TR": () => import("../locales/tr_TR.json"),
  "sv_SE": () => import("../locales/sv_SE.json"),
  "da_DK": () => import("../locales/da_DK.json"),
  "cs_CZ": () => import("../locales/cs_CZ.json"),
  "fi_FI": () => import("../locales/fi_FI.json"),
  "uk_UA": () => import("../locales/uk_UA.json"),
  "vi_VN": () => import("../locales/vi_VN.json"),
  "ar_JO": () => import("../locales/ar_JO.json"),
  "hu_HU": () => import("../locales/hu_HU.json"),
  "ro_RO": () => import("../locales/ro_RO.json"),
  "sk_SK": () => import("../locales/sk_SK.json"),
  "el_GR": () => import("../locales/el_GR.json"),
  "hi": () => import("../locales/hi.json"),
};

export const FLAG_CC = {
  de_DE: "de", en_US: "us", en_GB: "gb",
  fr_FR: "fr", es_ES: "es", es_MX: "mx",
  it_IT: "it", pt_BR: "br", pt_PT: "pt",
  nl_NL: "nl", pl_PL: "pl", ru_RU: "ru",
  uk_UA: "ua", tr_TR: "tr", ar_JO: "jo",
  ja_JP: "jp", zh_CN: "cn", cs_CZ: "cz",
  da_DK: "dk", fi_FI: "fi", el_GR: "gr",
  hi: "in", hu_HU: "hu", ro_RO: "ro",
  sk_SK: "sk", sv_SE: "se", vi_VN: "vn",
};

export function FlagIcon({ code, size = 20 }) {
  const cc = FLAG_CC[code];
  if (!cc) return (
    <span
      style={{ width: size, height: size * 0.75 }}
      className="inline-block rounded-[2px] bg-nox-border"
    />
  );
  return (
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      srcSet={`https://flagcdn.com/w80/${cc}.png 2x`}
      alt={code}
      width={size}
      height={Math.round(size * 0.75)}
      className="inline-block rounded-[2px] object-cover"
      loading="lazy"
    />
  );
}

export function LanguageDropdown({ voiceCatalog, selectedLang, onSelect, label, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const toggle = (v) => {
    const next = typeof v === "boolean" ? v : !open;
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) toggle(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const entries = Object.entries(voiceCatalog || {}).sort(
    ([, a], [, b]) => a.language_name.localeCompare(b.language_name)
  );
  const selected = entries.find(([code]) => code === selectedLang);
  const selectedCode = selected ? selected[0] : null;
  const selectedName = selected ? selected[1].language_native : "—";

  return (
    <div className="w-full max-w-xs space-y-1.5" ref={ref}>
      {label && (
        <label className="text-xs font-medium text-nox-textDim uppercase tracking-wide text-left block">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          onClick={() => toggle()}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-nox-surface text-nox-text text-sm border border-nox-border hover:border-nox-textDim transition-colors"
        >
          <span className="flex items-center gap-2">
            <FlagIcon code={selectedCode} size={20} />
            <span className="font-medium">{selectedName}</span>
          </span>
          <svg
            className={`w-4 h-4 text-nox-textDim transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg bg-nox-surface border border-nox-border shadow-xl shadow-nox-shadow py-0.5">
            {entries.map(([code, info]) => {
              const isSelected = selectedLang === code;
              return (
                <button
                  key={code}
                  onClick={() => {
                    onSelect(code);
                    toggle(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
                    isSelected
                      ? "bg-nox-accent/15 text-nox-text"
                      : "text-nox-textDim hover:bg-nox-border hover:text-nox-text"
                  }`}
                >
                  <FlagIcon code={code} size={18} />
                  <span className="font-medium">{info.language_native}</span>
                  <span className="ml-auto text-[10px] text-nox-textDim uppercase">{code}</span>
                  {isSelected && (
                    <svg className="w-4 h-4 text-nox-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export async function speakText(text, addToast) {
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

export async function loadLocaleData() {
  try {
    const res = await fetch(`${API_BASE}/api/voices/system-language`);
    const data = await res.json();
    if (data.status === "ok" && data.language_code) {
      const loader = LOCALE_MAP[data.language_code];
      if (loader) {
        const mod = await loader();
        return mod.default;
      }
    }
  } catch {}
  const mod = await LOCALE_MAP["de_DE"]();
  return mod.default;
}
