"""Kokoro-82M TTS engine wrapper.

Lightweight, high-quality local TTS. 82M params, <1GB model.
Apache 2.0 license. 54 voices across 8 languages.
No voice cloning, but built-in voices are very natural.
"""

import logging
import io
import wave
import os
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("nox.voice.tts_kokoro")

try:
    from kokoro import KPipeline
    _KOKORO_AVAILABLE = True
except ImportError:
    _KOKORO_AVAILABLE = False

_kokoro_pipelines = {}
_kokoro_lock = threading.Lock()

# Kokoro supported languages
KOKORO_LANGUAGES = {
    "en_US": "a",
    "en_GB": "b",
    "fr_FR": "f",
    "es_ES": "e",
    "it_IT": "i",
    "pt_BR": "p",
    "ja_JP": "j",
    "zh_CN": "z",
}

# Voice catalog per language — only voices that actually exist in hexgrad/Kokoro-82M repo (54 voices)
KOKORO_VOICES = {
    "en_US": [
        ("af_heart", "Heart", "female", "Female, warm and natural"),
        ("af_bella", "Bella", "female", "Female, friendly"),
        ("af_nicole", "Nicole", "female", "Female, professional"),
        ("af_sky", "Sky", "female", "Female, young"),
        ("af_alloy", "Alloy", "female", "Female, neutral"),
        ("af_aoede", "Aoede", "female", "Female, singing"),
        ("af_jessica", "Jessica", "female", "Female, calm"),
        ("af_kore", "Kore", "female", "Female, soft"),
        ("af_nova", "Nova", "female", "Female, energetic"),
        ("af_river", "River", "female", "Female, mature"),
        ("af_sarah", "Sarah", "female", "Female, warm"),
        ("am_adam", "Adam", "male", "Male, natural"),
        ("am_michael", "Michael", "male", "Male, professional"),
        ("am_echo", "Echo", "male", "Male, deep"),
        ("am_eric", "Eric", "male", "Male, clear"),
        ("am_fenrir", "Fenrir", "male", "Male, rough"),
        ("am_liam", "Liam", "male", "Male, young"),
        ("am_onyx", "Onyx", "male", "Male, authoritative"),
        ("am_puck", "Puck", "male", "Male, lively"),
        ("am_santa", "Santa", "male", "Male, festive"),
    ],
    "en_GB": [
        ("bf_alice", "Alice", "female", "Female British"),
        ("bf_emma", "Emma", "female", "Female British, soft"),
        ("bf_isabella", "Isabella", "female", "Female British, elegant"),
        ("bf_lily", "Lily", "female", "Female British, young"),
        ("bm_daniel", "Daniel", "male", "Male British"),
        ("bm_fable", "Fable", "male", "Male British, narrative"),
        ("bm_george", "George", "male", "Male British, calm"),
        ("bm_lewis", "Lewis", "male", "Male British, young"),
    ],
    "fr_FR": [
        ("ff_siwis", "Siwis", "female", "Voix féminine française"),
    ],
    "es_ES": [
        ("ef_dora", "Dora", "female", "Voz femenina española"),
        ("em_alex", "Alex", "male", "Voz masculina española"),
        ("em_santa", "Santa", "male", "Voz masculina española, festiva"),
    ],
    "it_IT": [
        ("if_sara", "Sara", "female", "Voce femminile italiana"),
        ("im_nicola", "Nicola", "male", "Voce maschile italiana"),
    ],
    "pt_BR": [
        ("pf_dora", "Dora", "female", "Voz feminina brasileira"),
        ("pm_alex", "Alex", "male", "Voz masculina brasileira"),
        ("pm_santa", "Santa", "male", "Voz masculina brasileira, festiva"),
    ],
    "ja_JP": [
        ("jf_alpha", "Alpha", "female", "女性の声、自然"),
        ("jf_gongitsune", "Gongitsune", "female", "女性の声、可愛い"),
        ("jf_nezumi", "Nezumi", "female", "女性の声、小鼠"),
        ("jf_tebukuro", "Tebukuro", "female", "女性の声、手袋"),
        ("jm_kumo", "Kumo", "male", "男性の声"),
    ],
    "zh_CN": [
        ("zf_xiaobei", "Xiaobei", "female", "女声，自然"),
        ("zf_xiaoni", "Xiaoni", "female", "女声，温柔"),
        ("zf_xiaoxiao", "Xiaoxiao", "female", "女声，活泼"),
        ("zf_xiaoyi", "Xiaoyi", "female", "女声，优雅"),
        ("zm_yunjian", "Yunjian", "male", "男声"),
        ("zm_yunxi", "Yunxi", "male", "男声，年轻"),
        ("zm_yunxia", "Yunxia", "male", "男声，成熟"),
        ("zm_yunyang", "Yunyang", "male", "男声，阳光"),
    ],
}


def is_kokoro_available() -> bool:
    return _KOKORO_AVAILABLE


def get_kokoro_lang_code(lang_code: str) -> Optional[str]:
    return KOKORO_LANGUAGES.get(lang_code)


def get_kokoro_voices_for_lang(lang_code: str) -> list:
    return KOKORO_VOICES.get(lang_code, [])


def _get_pipeline(lang_code: str):
    """Get or create a Kokoro pipeline for the given language."""
    kokoro_lang = KOKORO_LANGUAGES.get(lang_code, "a")
    with _kokoro_lock:
        if kokoro_lang not in _kokoro_pipelines:
            logger.info("Kokoro: creating pipeline for lang '%s'", kokoro_lang)
            _kokoro_pipelines[kokoro_lang] = KPipeline(lang_code=kokoro_lang)
            logger.info("Kokoro: pipeline ready for lang '%s'", kokoro_lang)
        return _kokoro_pipelines[kokoro_lang]


def kokoro_to_wav(text: str, voice: str, lang_code: str = "de_DE") -> Optional[bytes]:
    """Synthesize text to WAV bytes using Kokoro-82M.

    Args:
        text: Text to synthesize.
        voice: Voice name (e.g. "yf_de", "af_heart").
        lang_code: Language code (e.g. "de_DE", "en_US").

    Returns:
        WAV bytes or None on error.
    """
    if not _KOKORO_AVAILABLE:
        logger.error("Kokoro: package not installed")
        return None

    try:
        pipeline = _get_pipeline(lang_code)
        logger.info("Kokoro: synthesizing %d chars with voice '%s'", len(text), voice)

        import torch
        import numpy as np
        import soundfile as sf

        # Generate audio
        generator = pipeline(text, voice=voice)
        audio_chunks = []
        for i, (graphemes, phonemes, audio) in enumerate(generator):
            audio_chunks.append(audio)

        if not audio_chunks:
            logger.error("Kokoro: no audio generated")
            return None

        # Concatenate audio chunks
        full_audio = torch.cat(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
        audio_np = full_audio.cpu().numpy()

        # Convert to WAV bytes
        buf = io.BytesIO()
        sf.write(buf, audio_np, 24000, format="WAV", subtype="PCM_16")
        wav_bytes = buf.getvalue()

        logger.info("Kokoro: synthesis complete, %d bytes", len(wav_bytes))
        return wav_bytes

    except Exception as exc:
        logger.error("Kokoro: synthesis failed: %s", exc, exc_info=True)
        return None
