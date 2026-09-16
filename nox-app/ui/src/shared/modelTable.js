// VRAM-tier model table — shared between OnboardingWizard and AI Marketplace.
// (vram_min_mb, vram_max_mb) -> {mode: {model, label, desc, size}}
export const MODEL_TABLE = [
  { range: [0, 4096], modes: {
    superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", desc: "Kleinstes Modell – blitzschnell, auch auf CPU.", size: "~1.3 GB", warning: "Sehr kleines Modell – kann ungenaue oder seltsame Antworten geben, Tool-Aufrufe fehlerhaft auslösen. Nur für einfache Aufgaben geeignet." },
    schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Kompakt und schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    balance:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Bester Tool-User für begrenzte Hardware – Thinking Mode.", size: "~2.2 GB" },
    qualitaet:    { model: "phi4-mini:3.8b", label: "Phi-4 mini 3.8B", desc: "Beste Qualität für sehr begrenzte Hardware.", size: "~3.0 GB", warning: "Kompaktes Modell – bei komplexeren Aufgaben können Fehler auftreten." },
  }},
  { range: [4096, 8192], modes: {
    superschnell: { model: "qwen3.5:0.8b", label: "Qwen 3.5 0.8B", desc: "Blitzschnell – ideal für einfache Aufgaben.", size: "~1.3 GB", warning: "Sehr kleines Modell – kann ungenaue oder seltsame Antworten geben, Tool-Aufrufe fehlerhaft auslösen. Nur für einfache Aufgaben geeignet." },
    schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Schnell und kompakt – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    balance:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Gute Balance für 4-8 GB VRAM – Tool-Calling.", size: "~4.0 GB" },
    qualitaet:    { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Qualität für 4-8 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
  }},
  { range: [8192, 12288], modes: {
    superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Sehr schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    schnell:      { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Schnell und kompakt – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Balance für 8-12 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
    qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Hohe Qualität für 8-12 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
  }},
  { range: [12288, 16384], modes: {
    superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Blitzschnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~4.0 GB" },
    balance:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Beste Balance für 12-16 GB VRAM – Tool-Calling.", size: "~6.5 GB" },
    qualitaet:    { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Höchste Qualität für 12-16 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
  }},
  { range: [16384, 20480], modes: {
    superschnell: { model: "granite4.2:3b", label: "Granite 4.2 3B", desc: "Sehr schnell – Thinking Mode, exzellent für Tool-Use.", size: "~2.2 GB" },
    schnell:      { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~4.0 GB" },
    balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Beste Balance für 16-20 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
    qualitaet:    { model: "gemma4:26b", label: "Gemma 4 26B", desc: "Höchste Qualität für 16-20 GB VRAM – MoE, native FC.", size: "~15 GB" },
  }},
  { range: [20480, 24576], modes: {
    superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Sehr schnell – gut für einfache Aufgaben.", size: "~4.0 GB" },
    schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell mit guter Qualität – Tool-Calling.", size: "~6.5 GB" },
    balance:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Beste Balance für 20-24 GB VRAM – echtes Upgrade.", size: "~9.0 GB" },
    qualitaet:    { model: "qwen3.8:27b", label: "Qwen 3.8 27B", desc: "Höchste Qualität für 20-24 GB VRAM – hybrid Attention, agentic Coding.", size: "~18 GB" },
  }},
  { range: [24576, 32768], modes: {
    superschnell: { model: "qwen3.5:4b", label: "Qwen 3.5 4B", desc: "Sehr schnell – gut für einfache Aufgaben.", size: "~4.0 GB" },
    schnell:      { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
    balance:      { model: "gemma4:26b", label: "Gemma 4 26B", desc: "Beste Balance für 24-32 GB VRAM – MoE, native FC.", size: "~15 GB" },
    qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Höchste Qualität für 24-32 GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
  }},
  { range: [32768, 40960], modes: {
    superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
    schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Schnell mit hoher Qualität – Tool-Calling.", size: "~9.0 GB" },
    balance:      { model: "qwen3.8:27b", label: "Qwen 3.8 27B", desc: "Beste Balance für 32-40 GB VRAM – hybrid Attention, agentic Coding.", size: "~18 GB" },
    qualitaet:    { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Höchste Qualität für 32-40 GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
  }},
  { range: [40960, 999999], modes: {
    superschnell: { model: "qwen3.5:9b", label: "Qwen 3.5 9B", desc: "Schnell und fähig – Tool-Calling.", size: "~6.5 GB" },
    schnell:      { model: "qwen3.5:14b", label: "Qwen 3.5 14B", desc: "Schnell mit hoher Qualität – Tool-Calling.", size: "~9.0 GB" },
    balance:      { model: "qwen3.6:35b-a3b", label: "Qwen 3.6 35B A3B", desc: "Beste Balance für 40+ GB VRAM – MoE, agentic Coding.", size: "~23 GB" },
    qualitaet:    { model: "granite4.2:30b", label: "Granite 4.2 30B", desc: "Höchste Qualität für 40+ GB VRAM – Thinking Mode, bester Tool-Use.", size: "~18 GB" },
  }},
];

export function getVramTier(vramMb) {
  return MODEL_TABLE.find((t) => vramMb >= t.range[0] && vramMb < t.range[1]) || MODEL_TABLE[0];
}
