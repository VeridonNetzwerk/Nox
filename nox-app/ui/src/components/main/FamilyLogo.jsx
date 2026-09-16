import React, { useState } from "react";

// Brand-inspired family marks for the AI Marketplace.
// Maps a model family name to { gradient, mark } — falls back to an initial letter tile.

const FAMILIES = {
  Qwen: {
    gradient: "from-violet-500 to-fuchsia-500",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[60%] h-[60%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M20 12a8 8 0 1 1-3.1-6.3" />
        <path d="M17 12a5 5 0 1 1-2-4" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <path d="M17.5 17.5L21 21" />
      </svg>
    ),
  },
  Granite: {
    gradient: "from-sky-500 to-cyan-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="currentColor">
        <rect x="3" y="5" width="18" height="2.6" rx="1.3" />
        <rect x="3" y="10.7" width="13" height="2.6" rx="1.3" />
        <rect x="3" y="16.4" width="18" height="2.6" rx="1.3" />
      </svg>
    ),
  },
  Gemma: {
    gradient: "from-amber-500 to-orange-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]">
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" />
      </svg>
    ),
  },
  Phi: {
    gradient: "from-emerald-500 to-teal-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[58%] h-[58%]" fill="currentColor">
        <rect x="3" y="3" width="8.4" height="8.4" rx="1.5" />
        <rect x="12.6" y="3" width="8.4" height="8.4" rx="1.5" opacity="0.75" />
        <rect x="3" y="12.6" width="8.4" height="8.4" rx="1.5" opacity="0.75" />
        <rect x="12.6" y="12.6" width="8.4" height="8.4" rx="1.5" opacity="0.5" />
      </svg>
    ),
  },
  Llama: {
    gradient: "from-blue-500 to-indigo-500",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[64%] h-[64%]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M6.5 15.5a3.5 3.5 0 1 1 2.5-6c1.4 1.2 2.1 2.6 3 2.6s1.6-1.4 3-2.6a3.5 3.5 0 1 1 2.5 6" />
      </svg>
    ),
  },
  DeepSeek: {
    gradient: "from-blue-600 to-sky-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="currentColor">
        <path d="M3 13c3-6 9-8 15-6-1.2 1-2 2-2.4 3.2C18 11 20 12.4 21 15c-2.4-1.2-4.6-1.4-6.6-.8-2.8.8-5.6.4-8-1.2H3z" />
        <circle cx="16.4" cy="9.4" r="1" fill="#fff" />
      </svg>
    ),
  },
  Mistral: {
    gradient: "from-orange-500 to-amber-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="currentColor">
        <rect x="3" y="4" width="4" height="4" />
        <rect x="10" y="4" width="4" height="4" opacity="0.85" />
        <rect x="17" y="4" width="4" height="4" opacity="0.7" />
        <rect x="6.5" y="10" width="4" height="4" opacity="0.85" />
        <rect x="13.5" y="10" width="4" height="4" opacity="0.7" />
        <rect x="3" y="16" width="4" height="4" opacity="0.7" />
        <rect x="10" y="16" width="4" height="4" opacity="0.55" />
        <rect x="17" y="16" width="4" height="4" opacity="0.4" />
      </svg>
    ),
  },
  GLM: {
    gradient: "from-teal-500 to-emerald-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[58%] h-[58%]" fill="currentColor">
        <path d="M4 5h16v3.4H9.8L20 15.6V19H4v-3.4h10.2L4 8.4V5z" />
      </svg>
    ),
  },
  Nemotron: {
    gradient: "from-lime-500 to-green-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  Olmo: {
    gradient: "from-rose-500 to-orange-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[58%] h-[58%]" fill="currentColor">
        <circle cx="9" cy="10" r="2" />
        <circle cx="15" cy="10" r="2" />
        <path d="M5 16c2 2.4 4.6 3.4 7 3.4S17 18.4 19 16v3.6c0 2-1.6 3.4-3.6 3.4H8.6C6.6 23 5 21.6 5 19.6V16z" opacity="0.8" />
        <path d="M12 2c3.9 0 7 3.1 7 7v4h-3.4V9a3.6 3.6 0 1 0-7.2 0v4H5V9c0-3.9 3.1-7 7-7z" />
      </svg>
    ),
  },
  GPT: {
    gradient: "from-neutral-600 to-neutral-800",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
        <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3z" />
        <path d="M12 8.2l3.3 1.9v3.8L12 15.8l-3.3-1.9v-3.8L12 8.2z" />
      </svg>
    ),
  },
  LLaVA: {
    gradient: "from-fuchsia-500 to-purple-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="15" cy="11" r="1.6" fill="currentColor" stroke="none" />
        <path d="M8.5 15.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" />
      </svg>
    ),
  },
  Moondream: {
    gradient: "from-indigo-500 to-violet-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="currentColor">
        <path d="M20.4 14.2A8.8 8.8 0 0 1 9.8 3.6 9 9 0 1 0 20.4 14.2z" />
        <path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9L17 3z" opacity="0.85" />
      </svg>
    ),
  },
  Embedding: {
    gradient: "from-cyan-500 to-blue-400",
    mark: (
      <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="currentColor">
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="18" cy="8" r="2.2" opacity="0.8" />
        <circle cx="8" cy="17" r="2.2" opacity="0.8" />
        <circle cx="17" cy="17" r="2.2" opacity="0.6" />
        <path d="M7.4 7.6l8.6-.2-8 8.2 8.6-.4-8.4-7.6z" opacity="0.35" />
      </svg>
    ),
  },
};

const FAMILY_MATCHERS = [
  ["qwen", "Qwen"],
  ["granite", "Granite"],
  ["gemma", "Gemma"],
  ["phi", "Phi"],
  ["llama", "Llama"],
  ["deepseek", "DeepSeek"],
  ["mistral", "Mistral"],
  ["ministral", "Mistral"],
  ["devstral", "Mistral"],
  ["magistral", "Mistral"],
  ["glm", "GLM"],
  ["nemotron", "Nemotron"],
  ["olmo", "Olmo"],
  ["gpt-oss", "GPT"],
  ["gpt2", "GPT"],
  ["llava", "LLaVA"],
  ["moondream", "Moondream"],
  ["nomic", "Embedding"],
  ["embed", "Embedding"],
  ["bge", "Embedding"],
  ["mxbai", "Embedding"],
  ["snowflake", "Embedding"],
];

export function familyOf(name) {
  const n = (name || "").toLowerCase();
  for (const [needle, family] of FAMILY_MATCHERS) {
    if (n.includes(needle)) return family;
  }
  return null;
}

// Real brand logos from the HuggingFace CDN (stable social-thumbnail pattern).
// Maps a family to the HF organization whose avatar is used as the logo.
const FAMILY_TO_HF_ORG = {
  Qwen: "Qwen",
  Granite: "ibm-granite",
  Gemma: "google",
  Phi: "microsoft",
  Llama: "meta-llama",
  DeepSeek: "deepseek-ai",
  Mistral: "mistralai",
  GLM: "zai-org",
  Nemotron: "nvidia",
  Olmo: "allenai",
  GPT: "openai",
  LLaVA: "liuhaotian",
  Moondream: "vikhyatk",
  Embedding: "huggingface",
};

export function hfLogoUrl(family) {
  const org = FAMILY_TO_HF_ORG[family];
  return org ? `https://cdn-thumbnails.huggingface.co/social-thumbnails/${org}.png` : null;
}

export default function FamilyLogo({ family, name, size = 44, className = "" }) {
  const fam = family || familyOf(name) || (name || "?")[0].toUpperCase();
  const def = FAMILIES[fam];
  const gradient = def?.gradient || "from-nox-accent to-nox-glow3";
  const [imgFailed, setImgFailed] = useState(false);
  const remote = hfLogoUrl(fam);

  if (remote && !imgFailed) {
    return (
      <img
        src={remote}
        alt={fam}
        title={fam}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className={`rounded-xl object-cover bg-nox-surface border border-nox-border shadow-md shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`relative rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-md shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={fam}
    >
      {def?.mark || <span className="font-bold" style={{ fontSize: size * 0.42 }}>{fam[0]}</span>}
    </div>
  );
}
