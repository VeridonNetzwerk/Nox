export function prettyModelName(raw) {
  if (!raw) return "Modell";
  // Ollama keys ("model:tag") and GGUF filenames resolve via the badge parser
  if (/\.gguf$/i.test(raw) || raw.includes(":")) {
    const { name, tag } = parseModelBadge(raw);
    return tag ? `${name} ${tag}` : name;
  }
  return prettifyModelKey(raw);
}

const NAME_REPLACEMENTS = [
  [/\bqwen\b/gi, "Qwen"],
  [/\bllama\b/gi, "Llama"],
  [/\bgemma\b/gi, "Gemma"],
  [/\bgranite\b/gi, "Granite"],
  [/\bphi\b/gi, "Phi"],
  [/\bdeepseek\b/gi, "DeepSeek"],
  [/\bminimax\b/gi, "Minimax"],
  [/\bnemotron\b/gi, "Nemotron"],
  [/\bglm\b/gi, "GLM"],
  [/\blfm(\d*)\b/gi, "LFM$1"],
  [/\bornith\b/gi, "Ornith"],
  [/\bgpt\s*oss\b/gi, "GPT-OSS"],
  [/\bmistral\b/gi, "Mistral"],
  [/\bmicrosoft\b/gi, "Microsoft"],
  [/\bgoogle\b/gi, "Google"],
  [/\bibm\b/gi, "IBM"],
  [/\br(\d+)\b/g, "R$1"],
  [/\bm(\d+)\b/g, "M$1"],
];

// Split attached version numbers from model names: "granite4.2" -> "granite 4.2"
// Only splits after 2+ letters so tags like "m3"/"r1" stay intact
function prettifyModelKey(key) {
  let s = key.replace(/[-_]+/g, " ").trim();
  s = s.split(/\s+/).map(tok => {
    if (/^lfm/i.test(tok)) return tok; // LFM2 is a brand name, don't split
    return tok.replace(/^([a-z]{2,})(\d)/i, "$1 $2");
  }).join(" ");
  for (const [pattern, replacement] of NAME_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  // Title-case any remaining lowercase words (e.g. "ultra", "flash")
  s = s.replace(/\b[a-z]/g, c => c.toUpperCase());
  return s.replace(/\s+/g, " ").trim();
}

export function parseModelBadge(raw) {
  if (!raw) return { name: "Modell", tag: "" };

  // GGUF file: e.g. "Qwen_Qwen3.5-9B-Q4_K_M.gguf"
  if (/\.gguf$/i.test(raw)) {
    const base = raw.replace(/\.gguf$/i, "");
    // Extract size like "0.8B", "9B", "14B" (must follow a separator to avoid matching version numbers)
    const sizeMatch = base.match(/(?:^|[-_])(\d+\.?\d*)\s*B/i);
    // Extract quant like "Q4_K_M" (from raw base, before underscore replacement)
    const quantMatch = base.match(/Q\d+[_KM]+/i);
    // Badge shows the size only — the full filename (incl. quant) is shown as hover tooltip by the caller
    const tag = sizeMatch ? `${sizeMatch[1]}B` : (quantMatch ? quantMatch[0].toUpperCase() : "");
    // Name: everything before the size (or before the quant)
    let name = base;
    if (sizeMatch) {
      const idx = base.indexOf(sizeMatch[1], sizeMatch.index);
      name = base.substring(0, idx);
    } else if (quantMatch) {
      name = base.substring(0, base.indexOf(quantMatch[0]));
    }
    name = name.replace(/[-_\s]+$/, "");
    // Strip vendor prefix: "Qwen_Qwen3.5" -> "Qwen3.5"
    if (name.includes("_")) name = name.substring(name.lastIndexOf("_") + 1);
    return { name: prettifyModelKey(name), tag };
  }

  // Ollama model: "model_key:tag"
  const colonIdx = raw.indexOf(":");
  if (colonIdx >= 0) {
    const modelKey = raw.substring(0, colonIdx);
    const tagRaw = raw.substring(colonIdx + 1);

    const name = prettifyModelKey(modelKey);

    let tag = "";
    const eMatch = tagRaw.match(/^e(\d+)b$/i);
    if (tagRaw.toLowerCase() === "cloud") {
      tag = "Cloud";
    } else if (tagRaw.toLowerCase() === "latest") {
      tag = "Latest";
    } else if (eMatch) {
      tag = `E${eMatch[1]}B`;
    } else {
      // Extract size like "3b", "14b", "0.8b", "35b"
      const sizeMatch = tagRaw.match(/(\d+\.?\d*)\s*b/i);
      if (sizeMatch) {
        tag = `${sizeMatch[1]}B`;
        // Check for A3B suffix (MoE active params)
        const aMatch = tagRaw.match(/a(\d+)b/i);
        if (aMatch) tag += ` A${aMatch[1]}B`;
      }
      // Quantization like "q4_K_M" only shown in the hover tooltip, not the badge
      if (!tag) {
        const quantMatch = tagRaw.match(/q\d+[_KM]*/i);
        if (quantMatch) tag = quantMatch[0].toUpperCase().replace(/_+$/, "");
      }
      if (!tag) tag = tagRaw.toUpperCase();
    }

    return { name, tag };
  }

  return { name: prettifyModelKey(raw), tag: "" };
}

export function isCloudModel(raw) {
  return raw && raw.toLowerCase().includes(":cloud");
}

// Direct mapping: Ollama model key -> exact GGUF filename (must match GGUF_DOWNLOAD_URLS in the backend)
export const GGUF_FILENAMES = {
  "qwen3.5:0.8b": "Qwen_Qwen3.5-0.8B-Q4_K_M.gguf",
  "granite4.2:3b": "granite-4.2-3b-Q4_K_M.gguf",
  "phi4-mini:3.8b": "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
  "qwen3.5:4b": "Qwen_Qwen3.5-4B-Q4_K_M.gguf",
  "qwen3.5:9b": "Qwen_Qwen3.5-9B-Q4_K_M.gguf",
  "qwen3.5:14b": "Qwen_Qwen3-14B-Q4_K_M.gguf",
  "gemma4:26b": "google_gemma-4-26B-A4B-it-Q4_K_M.gguf",
  "qwen3.8:27b": "Qwen3.8-27B-Q4_K_M.gguf",
  "qwen3.6:35b-a3b": "Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf",
  "granite4.2:30b": "granite-4.2-30b-Q4_K_M.gguf",
  "gemma4:e4b": "google_gemma-4-E4B-it-Q4_K_M.gguf",
};

export function prettyVoiceName(raw) {
  if (!raw) return "";
  let s = raw.replace(/[_]/g, " ");
  // Remove leading locale like "de_DE " / "de-DE-" / "en_US "
  s = s.replace(/^[a-z]{2}[-_][A-Za-z]{2}[-_\s]+/i, "");
  // Split CamelCase: "SeraphinaMultilingualNeural" -> "Seraphina Multilingual Neural"
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Normalize dashes
  s = s.replace(/[-]+/g, " ");
  // Title case
  s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  // Drop generic descriptors so only the voice name remains
  s = s.replace(/\b(Neural|Multilingual|Expressive|Medium|High|Low|Xlow)\b/gi, "");
  // Clean up common patterns
  s = s.replace(/\bTts\b/gi, "TTS");
  s = s.replace(/\bV2\b/g, "v2");
  s = s.replace(/\bV3\b/g, "v3");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
