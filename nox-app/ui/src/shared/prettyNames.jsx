const MODEL_TABLE = [
  { range: [0, 4000], modes: {
    superschnell: { model: "qwen3:1.7b", label: "Qwen 3 1.7B" },
    schnell:      { model: "qwen3:4b", label: "Qwen 3 4B" },
    balance:      { model: "qwen3:8b", label: "Qwen 3 8B" },
    qualitaet:    { model: "qwen3:8b", label: "Qwen 3 8B" },
  }},
  { range: [4000, 8000], modes: {
    superschnell: { model: "qwen3:1.7b", label: "Qwen 3 1.7B" },
    schnell:      { model: "qwen3:4b", label: "Qwen 3 4B" },
    balance:      { model: "qwen3:8b", label: "Qwen 3 8B" },
    qualitaet:    { model: "gemma4:e4b", label: "Gemma 4 E4B" },
  }},
  { range: [8000, 12000], modes: {
    superschnell: { model: "qwen3:1.7b", label: "Qwen 3 1.7B" },
    schnell:      { model: "qwen3:4b", label: "Qwen 3 4B" },
    balance:      { model: "gemma4:e4b", label: "Gemma 4 E4B" },
    qualitaet:    { model: "qwen3:14b", label: "Qwen 3 14B" },
  }},
  { range: [12000, 16000], modes: {
    superschnell: { model: "qwen3:4b", label: "Qwen 3 4B" },
    schnell:      { model: "qwen3:8b", label: "Qwen 3 8B" },
    balance:      { model: "qwen3:14b", label: "Qwen 3 14B" },
    qualitaet:    { model: "deepseek-r1:14b-qwen-distill", label: "DeepSeek R1 14B" },
  }},
  { range: [16000, 24000], modes: {
    superschnell: { model: "qwen3:4b", label: "Qwen 3 4B" },
    schnell:      { model: "qwen3:8b", label: "Qwen 3 8B" },
    balance:      { model: "qwen3:14b", label: "Qwen 3 14B" },
    qualitaet:    { model: "deepseek-r1:14b-qwen-distill", label: "DeepSeek R1 14B" },
  }},
  { range: [24000, 999999], modes: {
    superschnell: { model: "qwen3:8b", label: "Qwen 3 8B" },
    schnell:      { model: "qwen3:14b", label: "Qwen 3 14B" },
    balance:      { model: "deepseek-r1:14b-qwen-distill", label: "DeepSeek R1 14B" },
    qualitaet:    { model: "qwen3:32b", label: "Qwen 3 32B" },
  }},
];

const MODE_KEYS = ["superschnell", "schnell", "balance", "qualitaet"];

export function prettyModelName(raw) {
  if (!raw) return "Modell";
  for (const tier of MODEL_TABLE) {
    for (const modeKey of MODE_KEYS) {
      const entry = tier.modes[modeKey];
      if (entry?.model && (entry.model === raw || raw.startsWith(entry.model) || entry.model.startsWith(raw))) {
        return entry.label;
      }
    }
  }
  return raw
    .replace(/[:\-_]/g, " ")
    .replace(/\bqwen\b/gi, "Qwen")
    .replace(/\bllama\b/gi, "Llama")
    .replace(/\bgemma\b/gi, "Gemma")
    .replace(/\bdeepseek\b/gi, "DeepSeek")
    .replace(/\bgpt.?oss\b/gi, "GPT-OSS")
    .replace(/\bmistral\b/gi, "Mistral")
    .replace(/\bphi\b/gi, "Phi")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\bq(\d+)\b/gi, "Q$1")
    .replace(/\ba3b\b/gi, "A3B")
    .replace(/\be4b\b/gi, "E4B")
    .replace(/\s+/g, " ")
    .trim();
}

export function prettyVoiceName(raw) {
  if (!raw) return "";
  let s = raw.replace(/[_]/g, " ");
  // Remove leading locale like "de_DE " or "en_US "
  s = s.replace(/^[a-z]{2}_[A-Z]{2}\s+/i, "");
  // Title case
  s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  // Clean up common patterns
  s = s.replace(/\bTts\b/gi, "TTS");
  s = s.replace(/\bV2\b/g, "v2");
  s = s.replace(/\bV3\b/g, "v3");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
