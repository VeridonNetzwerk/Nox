import React, { useState, useEffect, useRef } from "react";
import noxLogo from "../../assets/nox-logo.png";
import { API_BASE, FlagIcon, LanguageDropdown } from "../../shared/constants.jsx";
import { IconWarning, IconX, IconCheck, IconSpeaker } from "../../shared/Icon.jsx";

function VoiceSelection({ locale, currentVoice, currentEngine, lockedLang, onClose }) {
  const so = locale.onboarding || {};
  const [voiceCatalog, setVoiceCatalog] = useState(null);
  const [edgeCatalog, setEdgeCatalog] = useState(null);
  const [kokoroCatalog, setKokoroCatalog] = useState(null);
  const [selectedLang, setSelectedLang] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(currentVoice || "");
  const [selectedEngine, setSelectedEngine] = useState(currentEngine || "kokoro");
  const [previewPlaying, setPreviewPlaying] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const previewAudioRef = useRef(null);

  useEffect(() => {
    const fetchVoiceData = async () => {
      try {
        const [catRes, langRes, edgeRes, kokoroRes] = await Promise.all([
          fetch(`${API_BASE}/api/voices/catalog`),
          fetch(`${API_BASE}/api/voices/system-language`),
          fetch(`${API_BASE}/api/voices/edge/catalog`),
          fetch(`${API_BASE}/api/voices/kokoro/catalog`),
        ]);
        const catData = await catRes.json();
        const langData = await langRes.json();
        const edgeData = await edgeRes.json();
        const kokoroData = await kokoroRes.json();
        if (catData.status === "ok") setVoiceCatalog(catData.catalog);
        if (langData.status === "ok") setSelectedLang(lockedLang || langData.language_code);
        if (edgeData.status === "ok") setEdgeCatalog(edgeData.catalog);
        if (kokoroData.status === "ok") setKokoroCatalog(kokoroData.catalog);
      } catch (err) {
        console.error("Voice catalog fetch failed:", err);
      }
    };
    fetchVoiceData();
  }, []);

  const saveVoiceSetting = async (voiceName, engine) => {
    setSelectedVoice(voiceName);
    setSelectedEngine(engine);
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tts_model: voiceName, tts_engine: engine }),
      });
    } catch (err) {
      console.error("Failed to save voice:", err);
    }
  };

  const _stopAndToggle = (id) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewPlaying === id) {
      setPreviewPlaying(null);
      return true;
    }
    return false;
  };

  const _playAudioBlob = async (url) => {
    const audio = new Audio(url);
    previewAudioRef.current = audio;
    audio.onended = () => {
      setPreviewPlaying(null);
      URL.revokeObjectURL(url);
      previewAudioRef.current = null;
    };
    audio.onerror = () => {
      setPreviewPlaying(null);
      URL.revokeObjectURL(url);
      previewAudioRef.current = null;
    };
    await audio.play();
  };

  const playKokoroPreview = async (langCode, voiceId) => {
    const id = `kokoro:${voiceId}`;
    if (_stopAndToggle(id)) return;
    setPreviewPlaying(id);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/voices/demo/kokoro/${langCode}/${voiceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Kokoro Preview fehlgeschlagen");
      }
      const blob = await res.blob();
      await _playAudioBlob(URL.createObjectURL(blob));
    } catch (err) {
      setPreviewPlaying(null);
      setPreviewError(`Kokoro: ${err.message}`);
    }
  };

  const playEdgePreview = async (langCode, voiceId) => {
    const id = `edge:${voiceId}`;
    if (_stopAndToggle(id)) return;
    setPreviewPlaying(id);
    setPreviewError(null);
    try {
      const res = await fetch(`${API_BASE}/api/voices/demo/edge/${langCode}/${voiceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Edge TTS Preview fehlgeschlagen");
      }
      const blob = await res.blob();
      await _playAudioBlob(URL.createObjectURL(blob));
    } catch (err) {
      setPreviewPlaying(null);
      setPreviewError(`Edge TTS: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-nox-backdrop backdrop-blur-sm animate-fade-in">
      <div className="w-[480px] max-h-[600px] flex flex-col glass-card rounded-2xl shadow-2xl shadow-nox-shadowStrong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nox-border">
          <div className="flex items-center gap-2">
            <img src={noxLogo} alt="Nox" className="h-6 w-6 rounded-full" />
            <span className="text-sm font-semibold text-nox-text">
              {so.selectVoice || "Stimme wählen"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full text-nox-textDim hover:text-nox-text hover:bg-nox-surface transition-all hover:scale-105"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Voice cards */}
          {voiceCatalog && selectedLang && (() => {
            const allVoices = [
              ...(kokoroCatalog?.[selectedLang]?.voices || []).map((v) => ({ ...v, _engine: "kokoro" })),
              ...(edgeCatalog?.[selectedLang]?.voices || []).map((v) => ({ ...v, _engine: "edge" })),
            ];
            const female = allVoices.filter((v) => v.gender === "female").sort((a, b) => a.name.localeCompare(b.name));
            const male = allVoices.filter((v) => v.gender === "male").sort((a, b) => a.name.localeCompare(b.name));
            const renderGroup = (label, voices) => voices.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-nox-textDim uppercase tracking-wide">{label}</span>
                  <div className="flex-1 h-px bg-nox-border" />
                </div>
                <div className="space-y-1.5">
                  {voices.map((v) => {
                    const isPreviewing = previewPlaying === `${v._engine}:${v.id}`;
                    const isSelected = selectedVoice === v.id && selectedEngine === v._engine;
                    const isCloud = v._engine === "edge";
                    const desc = v.description ? v.description.replace(/^Female\s+/i, "").replace(/^Male\s+/i, "").replace(/^Weiblich,\s*/i, "").replace(/^Männlich,\s*/i, "") : "";
                    return (
                      <div
                        key={`${v._engine}:${v.id}`}
                        className={`px-3 py-2.5 rounded-lg text-sm transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-nox-accent/10 border-nox-accent shadow-sm shadow-nox-accent/20"
                            : "bg-nox-surface border-nox-border hover:border-nox-accent/40 hover:bg-nox-surface/80"
                        }`}
                        onClick={() => saveVoiceSetting(v.id, v._engine)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="font-medium text-nox-text">{v.name}</span>
                            {isCloud && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium leading-none">Cloud</span>
                            )}
                            {isSelected && (
                              <IconCheck size={16} className="text-nox-accent shrink-0" />
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isCloud) playEdgePreview(selectedLang, v.id);
                              else playKokoroPreview(selectedLang, v.id);
                            }}
                            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0 ${
                              isPreviewing ? "bg-nox-accent text-nox-accentFg" : "bg-nox-surface text-nox-textDim border border-nox-border hover:bg-nox-accent/20 hover:text-nox-text"
                            }`}
                          >
                            {isPreviewing ? (
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 256 256"><rect x="96" y="40" width="24" height="176" rx="4" /><rect x="136" y="40" width="24" height="176" rx="4" /></svg>
                            ) : (
                              <IconSpeaker size={14} />
                            )}
                          </button>
                        </div>
                        {desc && <p className="text-xs text-nox-textDim mt-1">{desc}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            if (!female.length && !male.length) {
              return (
                <div className="px-3 py-4 rounded-lg glass-card border border-nox-border text-center">
                  <p className="text-sm text-nox-textDim">Keine Stimmen für diese Sprache.</p>
                </div>
              );
            }
            return <div className="space-y-4">{renderGroup("Weiblich", female)}{renderGroup("Männlich", male)}</div>;
          })()}

          {previewError && (
            <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-start gap-2">
                <span className="text-red-600 dark:text-red-400 text-sm flex-shrink-0"><IconWarning size={14} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-red-600 dark:text-red-300 break-words">{previewError}</p>
                </div>
                <button
                  onClick={() => setPreviewError(null)}
                  className="text-red-600/60 dark:text-red-400/60 hover:text-red-600 dark:hover:text-red-400 text-xs flex-shrink-0"
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-nox-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-nox-accent hover:bg-nox-accentHover text-nox-accentFg text-sm font-medium transition-all hover:scale-105"
          >
            {so.finish || "Fertig"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VoiceSelection;
