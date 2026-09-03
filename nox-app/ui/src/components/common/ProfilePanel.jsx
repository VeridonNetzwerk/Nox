import React, { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "http://127.0.0.1:8420";

const LANGUAGE_NAMES = {
  de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano",
  pt: "Português", ru: "Русский", ja: "日本語", zh: "中文", ko: "한국어",
  nl: "Nederlands", pl: "Polski", tr: "Türkçe", ar: "العربية", sv: "Svenska",
};

const UNIT_NAMES = {
  metric: "Metrisch", imperial: "Imperial",
};

function formatTimezone(tz) {
  if (!tz) return "";
  try {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const h = Math.floor(Math.abs(offset) / 60);
    const m = Math.abs(offset) % 60;
    const city = tz.split("/").pop().replace(/_/g, " ");
    return `${city} (UTC${sign}${h}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""})`;
  } catch {
    return tz;
  }
}

function formatFieldValue(key, value) {
  if (!value) return value;
  if (key === "language") return LANGUAGE_NAMES[value] || value;
  if (key === "units") return UNIT_NAMES[value] || value;
  if (key === "timezone") return formatTimezone(value);
  return value;
}

const FIELD_META = {
  location: {
    label: "Standort",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    color: "text-red-400",
    placeholder: "z.B. München, Deutschland",
  },
  name: {
    label: "Name",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    color: "text-blue-400",
    placeholder: "Wie heißt du?",
  },
  timezone: {
    label: "Zeitzone",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    color: "text-green-400",
    placeholder: "Europe/Berlin",
  },
  language: {
    label: "Sprache",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    color: "text-purple-400",
    placeholder: "de",
  },
  units: {
    label: "Einheiten",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    ),
    color: "text-amber-400",
    placeholder: "metric",
  },
};

function ProfileCard({ fieldKey, value, meta, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const isEmpty = !value || value === "" || value === null;

  const handleSave = () => {
    onSave(fieldKey, draft);
    setEditing(false);
  };

  return (
    <div
      className="rounded-lg border border-nox-border bg-nox-surface/50 px-3 py-2 transition-all duration-200 hover:border-nox-accent/30"
      style={{ animation: "profileCardIn 0.3s ease-out" }}
    >
      <div className="flex items-center gap-2">
        <span className={`flex-shrink-0 ${meta.color}`}>{meta.icon}</span>
        <span className="text-[10px] font-medium text-nox-textDim uppercase tracking-wide flex-shrink-0">{meta.label}</span>
        {isEmpty && !editing && (
          <span className="text-[9px] text-nox-textFaint/60 flex-shrink-0">—</span>
        )}
        <span className="flex-1" />
        {editing ? (
          <div className="flex items-center gap-1.5 w-full">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
              placeholder={meta.placeholder}
              className="flex-1 min-w-0 bg-nox-bg text-xs text-nox-text px-2 py-0.5 rounded border border-nox-border outline-none focus:border-nox-accent"
            />
            <button
              onClick={handleSave}
              className="text-[10px] px-1.5 py-0.5 rounded bg-nox-accent text-white hover:opacity-90 transition-opacity flex-shrink-0"
            >
              OK
            </button>
          </div>
        ) : (
          <span
            className="text-xs text-nox-text cursor-pointer hover:text-nox-accent transition-colors truncate"
            onClick={() => { setDraft(value || ""); setEditing(true); }}
          >
            {isEmpty ? <span className="text-nox-textFaint/50">Setzen…</span> : formatFieldValue(fieldKey, value)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProfilePanel({ onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const autoDetectRan = useRef(false);

  const fetchProfile = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/profile`);
      const data = await resp.json();
      if (data.status === "ok") {
        setProfile(data.profile);
        return data.profile;
      }
    } catch (err) {
      console.error("Failed to load profile:", err);
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      const p = await fetchProfile();
      if (p && !autoDetectRan.current) {
        autoDetectRan.current = true;
        const needsDetect = !p.timezone || !p.language || !p.location;
        if (needsDetect) {
          try {
            const resp = await fetch(`${API_BASE}/api/profile/auto-detect`, { method: "POST" });
            const data = await resp.json();
            if (data.status === "ok") {
              setProfile(data.profile);
            }
          } catch (err) {
            console.error("Auto-detect on load failed:", err);
          }
        }
      }
    })();
  }, [fetchProfile]);

  const handleSave = async (key, value) => {
    try {
      const resp = await fetch(`${API_BASE}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setProfile(data.profile);
      }
    } catch (err) {
      console.error("Failed to save profile field:", err);
    }
  };

  const fields = profile ? Object.keys(FIELD_META) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-nox-bg rounded-xl border border-nox-border shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "profilePanelIn 0.25s ease-out" }}
      >
        <style>{`
          @keyframes profileCardIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes profilePanelIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* Header — compact */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nox-border">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-nox-accent">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <h2 className="text-sm font-semibold text-nox-text">Profil</h2>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cards — 2-column grid, compact */}
        <div className="p-3 grid grid-cols-2 gap-2">
          {loading ? (
            <div className="col-span-2 text-center py-6 text-nox-textDim text-xs">Lade Profil…</div>
          ) : (
            fields.map((key) => {
              const meta = FIELD_META[key];
              if (!meta) return null;
              return (
                <ProfileCard
                  key={key}
                  fieldKey={key}
                  value={profile[key]}
                  meta={meta}
                  onSave={handleSave}
                />
              );
            })
          )}
        </div>

        {/* Footer — single line */}
        <div className="px-4 py-2 border-t border-nox-border">
          <p className="text-[9px] text-nox-textFaint/70">
            Lokal in config.yaml · Tools greifen direkt zu — ohne KI
          </p>
        </div>
      </div>
    </div>
  );
}
