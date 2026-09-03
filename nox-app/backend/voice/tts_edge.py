"""Edge TTS (Microsoft) engine wrapper.

Uses Microsoft Edge's online text-to-speech service via the edge-tts library.
Excellent quality neural voices in 50+ languages. Requires internet connection.
"""

import asyncio
import logging
import io
import wave
from typing import Optional

logger = logging.getLogger("nox.voice.tts_edge")

try:
    import edge_tts
    _EDGE_AVAILABLE = True
except ImportError:
    _EDGE_AVAILABLE = False

# Popular German voices
EDGE_GERMAN_VOICES = [
    ("de-DE-KatjaNeural", "Katja", "female", "Weiblich, natürlich und warm"),
    ("de-DE-ConradNeural", "Conrad", "male", "Männlich, natürlich und klar"),
    ("de-DE-FlorianMultilingualNeural", "Florian", "male", "Männlich, mehrsprachig"),
    ("de-DE-SeraphinaMultilingualNeural", "Seraphina", "female", "Weiblich, mehrsprachig"),
    ("de-DE-KillianNeural", "Killian", "male", "Männlich, modern"),
]

# Popular English voices
EDGE_ENGLISH_VOICES = [
    ("en-US-AriaNeural", "Aria", "female", "Female, natural"),
    ("en-US-GuyNeural", "Guy", "male", "Male, natural"),
    ("en-US-JennyNeural", "Jenny", "female", "Female, friendly"),
    ("en-US-EmmaNeural", "Emma", "female", "Female, professional"),
    ("en-US-BrianNeural", "Brian", "male", "Male, professional"),
]

# French voices
EDGE_FRENCH_VOICES = [
    ("fr-FR-DeniseNeural", "Denise", "female", "Voix féminine française"),
    ("fr-FR-HenriNeural", "Henri", "male", "Voix masculine française"),
]

# Spanish voices
EDGE_SPANISH_VOICES = [
    ("es-ES-ElviraNeural", "Elvira", "female", "Voz femenina española"),
    ("es-ES-AlvaroNeural", "Alvaro", "male", "Voz masculina española"),
]

# Italian voices
EDGE_ITALIAN_VOICES = [
    ("it-IT-ElsaNeural", "Elsa", "female", "Voce femminile italiana"),
    ("it-IT-DiegoNeural", "Diego", "male", "Voce maschile italiana"),
]

# Map language codes to Edge voice lists
EDGE_VOICES_BY_LANG = {
    "de_DE": EDGE_GERMAN_VOICES,
    "en_US": EDGE_ENGLISH_VOICES,
    "en_GB": [
        ("en-GB-SoniaNeural", "Sonia", "female", "Female British"),
        ("en-GB-RyanNeural", "Ryan", "male", "Male British"),
        ("en-GB-LibbyNeural", "Libby", "female", "Female British"),
        ("en-GB-ThomasNeural", "Thomas", "male", "Male British"),
    ],
    "fr_FR": EDGE_FRENCH_VOICES,
    "es_ES": EDGE_SPANISH_VOICES,
    "es_MX": [
        ("es-MX-DaliaNeural", "Dalia", "female", "Voz femenina mexicana"),
        ("es-MX-JorgeNeural", "Jorge", "male", "Voz masculina mexicana"),
    ],
    "it_IT": EDGE_ITALIAN_VOICES,
    "nl_NL": [
        ("nl-NL-ColetteNeural", "Colette", "female", "Vrouwelijke Nederlandse stem"),
        ("nl-NL-FennaNeural", "Fenna", "female", "Vrouwelijke Nederlandse stem"),
        ("nl-NL-MaartenNeural", "Maarten", "male", "Mannelijke Nederlandse stem"),
    ],
    "pl_PL": [
        ("pl-PL-MarekNeural", "Marek", "male", "Męski głos polski"),
    ],
    "pt_BR": [
        ("pt-BR-FranciscaNeural", "Francisca", "female", "Voz feminina brasileira"),
        ("pt-BR-AntonioNeural", "Antonio", "male", "Voz masculina brasileira"),
    ],
    "pt_PT": [
        ("pt-PT-RaquelNeural", "Raquel", "female", "Voz feminina portuguesa"),
        ("pt-PT-DuarteNeural", "Duarte", "male", "Voz masculina portuguesa"),
    ],
    "ru_RU": [
        ("ru-RU-SvetlanaNeural", "Svetlana", "female", "Женский голос"),
        ("ru-RU-DmitryNeural", "Dmitry", "male", "Мужской голос"),
    ],
    "tr_TR": [
        ("tr-TR-EmelNeural", "Emel", "female", "Kadın sesi"),
        ("tr-TR-AhmetNeural", "Ahmet", "male", "Erkek sesi"),
    ],
    "sv_SE": [
        ("sv-SE-SofieNeural", "Sofie", "female", "Kvinnlig svensk röst"),
        ("sv-SE-MattiasNeural", "Mattias", "male", "Manlig svensk röst"),
    ],
    "da_DK": [
        ("da-DK-ChristelNeural", "Christel", "female", "Kvindlig dansk stemme"),
        ("da-DK-JeppeNeural", "Jeppe", "male", "Mandlig dansk stemme"),
    ],
    "cs_CZ": [
        ("cs-CZ-VlastaNeural", "Vlasta", "female", "Ženský český hlas"),
        ("cs-CZ-AntoninNeural", "Antonin", "male", "Mužský český hlas"),
    ],
    "fi_FI": [
        ("fi-FI-NooraNeural", "Noora", "female", "Naisääni"),
        ("fi-FI-HarriNeural", "Harri", "male", "Miesääni"),
    ],
    "uk_UA": [
        ("uk-UA-PolinaNeural", "Polina", "female", "Жіночий голос"),
        ("uk-UA-OstapNeural", "Ostap", "male", "Чоловічий голос"),
    ],
    "vi_VN": [
        ("vi-VN-HoaiMyNeural", "HoaiMy", "female", "Giọng nữ Việt Nam"),
        ("vi-VN-NamMinhNeural", "NamMinh", "male", "Giọng nam Việt Nam"),
    ],
    "ja_JP": [
        ("ja-JP-NanamiNeural", "Nanami", "female", "女性の声、自然"),
        ("ja-JP-KeitaNeural", "Keita", "male", "男性の声、自然"),
    ],
    "zh_CN": [
        ("zh-CN-XiaoxiaoNeural", "Xiaoxiao", "female", "中文女声"),
        ("zh-CN-YunxiNeural", "Yunxi", "male", "中文男声"),
    ],
    "ar_JO": [
        ("ar-JO-TaimNeural", "Taim", "male", "صوت رجل"),
    ],
    "hu_HU": [
        ("hu-HU-NoemiNeural", "Noemi", "female", "Női hang"),
        ("hu-HU-TamasNeural", "Tamas", "male", "Férfi hang"),
    ],
    "ro_RO": [
        ("ro-RO-AlinaNeural", "Alina", "female", "Voce feminină"),
        ("ro-RO-EmilNeural", "Emil", "male", "Voce masculină"),
    ],
    "sk_SK": [
        ("sk-SK-ViktoriaNeural", "Viktoria", "female", "Ženský hlas"),
        ("sk-SK-LukasNeural", "Lukas", "male", "Mužský hlas"),
    ],
    "el_GR": [
        ("el-GR-AthinaNeural", "Athina", "female", "Γυναικεία φωνή"),
        ("el-GR-NestorasNeural", "Nestoras", "male", "Ανδρική φωνή"),
    ],
    "hi": [
        ("hi-IN-SwaraNeural", "Swara", "female", "हिंदी महिला आवाज़"),
        ("hi-IN-MadhurNeural", "Madhur", "male", "हिंदी पुरुष आवाज़"),
    ],
}


def get_edge_voices_for_lang(lang_code: str) -> list:
    """Get available Edge TTS voices for a language code."""
    return EDGE_VOICES_BY_LANG.get(lang_code, [])


async def edge_tts_to_wav(voice_id: str, text: str) -> Optional[bytes]:
    """Synthesize text using Edge TTS and return WAV bytes.

    Args:
        voice_id: e.g. "de-DE-KatjaNeural"
        text: Text to synthesize

    Returns:
        WAV bytes or None on error.
    """
    if not _EDGE_AVAILABLE:
        logger.warning("Edge TTS: edge-tts not available")
        return None

    try:
        logger.info("Edge TTS: starting synthesis with voice '%s', %d chars", voice_id, len(text))
        communicate = edge_tts.Communicate(text, voice_id)
        mp3_buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_buf.write(chunk["data"])

        mp3_data = mp3_buf.getvalue()
        if not mp3_data:
            logger.warning("Edge TTS: produced no audio for voice '%s'", voice_id)
            return None

        logger.info("Edge TTS: got %d bytes MP3, converting to WAV", len(mp3_data))

        # Convert MP3 to WAV using soundfile/librosa
        import soundfile as sf
        import numpy as np

        mp3_buf.seek(0)
        try:
            audio, sr = sf.read(mp3_buf, dtype="float32")
        except Exception as exc:
            logger.warning("Edge TTS: soundfile MP3 decode failed (%s), trying librosa", exc)
            import librosa
            mp3_buf.seek(0)
            import tempfile, os
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp.write(mp3_data)
                tmp_path = tmp.name
            try:
                audio, sr = librosa.load(tmp_path, sr=None)
            finally:
                os.unlink(tmp_path)

        if len(audio.shape) > 1:
            audio = audio[:, 0]

        audio_int16 = (audio * 32767).astype(np.int16)

        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sr)
            wav.writeframes(audio_int16.tobytes())
        wav_bytes = wav_buf.getvalue()
        logger.info("Edge TTS: WAV conversion complete, %d bytes", len(wav_bytes))
        return wav_bytes

    except Exception as exc:
        logger.error("Edge TTS: error for voice '%s': %s", voice_id, exc, exc_info=True)
        return None
