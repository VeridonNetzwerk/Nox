"""Piper TTS voice catalog.

All available Piper voices organized by language, with download URLs
from the official Hugging Face repository (rhasspy/piper-voices v1.0.0).
"""

# Base URL for Piper voice downloads
PIPER_VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

# Sample sentences per language for TTS voice demos
SAMPLE_SENTENCES = {
    "de_DE": "Hallo, ich bin Nox, dein lokaler KI-Assistent. Wie kann ich dir heute helfen?",
    "en_US": "Hello, I am Nox, your local AI assistant. How can I help you today?",
    "en_GB": "Hello, I am Nox, your local AI assistant. How can I help you today?",
    "fr_FR": "Bonjour, je suis Nox, votre assistant IA local. Comment puis-je vous aider aujourd'hui?",
    "es_ES": "Hola, soy Nox, tu asistente de IA local. ¿Cómo puedo ayudarte hoy?",
    "es_MX": "Hola, soy Nox, tu asistente de IA local. ¿Cómo puedo ayudarte hoy?",
    "it_IT": "Ciao, sono Nox, il tuo assistente IA locale. Come posso aiutarti oggi?",
    "ja_JP": "こんにちは、私はNox、あなたのローカルAIアシスタントです。今日はどうお手伝いしましょうか？",
    "nl_NL": "Hallo, ik ben Nox, je lokale AI-assistent. Hoe kan ik je vandaag helpen?",
    "nl_BE": "Hallo, ik ben Nox, je lokale AI-assistent. Hoe kan ik je vandaag helpen?",
    "pl_PL": "Cześć, jestem Nox, twój lokalny asystent AI. Jak mogę ci dziś pomóc?",
    "pt_BR": "Olá, sou Nox, seu assistente de IA local. Como posso ajudar você hoje?",
    "pt_PT": "Olá, sou Nox, o seu assistente de IA local. Como posso ajudar hoje?",
    "ru_RU": "Привет, я Nox, ваш локальный ИИ-ассистент. Как я могу помочь вам сегодня?",
    "tr_TR": "Merhaba, ben Nox, yerel yapay zeka asistanınızım. Bugün size nasıl yardımcı olabilirim?",
    "sv_SE": "Hej, jag är Nox, din lokala AI-assistent. Hur kan jag hjälpa dig idag?",
    "no_NO": "Hei, jeg er Nox, din lokale AI-assistent. Hvordan kan jeg hjelpe deg i dag?",
    "da_DK": "Hej, jeg er Nox, din lokale AI-assistent. Hvordan kan jeg hjælpe dig i dag?",
    "cs_CZ": "Ahoj, jsem Nox, tvůj lokální AI asistent. Jak ti mohu dnes pomoci?",
    "fi_FI": "Hei, olen Nox, paikallinen tekoälyavustajasi. Kuinka voin auttaa sinua tänään?",
    "uk_UA": "Привіт, я Nox, ваш локальний ШІ-асистент. Як я можу допомогти вам сьогодні?",
    "vi_VN": "Xin chào, tôi là Nox, trợ lý AI cục bộ của bạn. Tôi có thể giúp gì cho bạn hôm nay?",
    "zh_CN": "你好，我是Nox，你的本地AI助手。今天我能帮你什么忙？",
    "ar_JO": "مرحبا، أنا Nox، مساعد الذكاء الاصطناعي المحلي الخاص بك. كيف يمكنني مساعدتك اليوم؟",
    "ca_ES": "Hola, soc Nox, el teu assistent d'IA local. Com et puc ajudar avui?",
    "el_GR": "Γεια, είμαι ο Nox, ο τοπικός βοηθός AI σου. Πώς μπορώ να σε βοηθήσω σήμερα;",
    "fa_IR": "سلام، من Nox هستم، دستیار هوش مصنوعی محلی شما. امروز چطور می‌توانم به شما کمک کنم؟",
    "hu_HU": "Szia, Nox vagyok, a helyi AI asszisztensed. Hogyan segíthetek ma?",
    "is_IS": "Halló, ég er Nox, staðbundinn AI aðstoðarmaðurinn þinn. Hvernig get ég aðstoðað þig í dag?",
    "ro_RO": "Salut, sunt Nox, asistentul tău AI local. Cum te pot ajuta astăzi?",
    "sk_SK": "Ahoj, som Nox, tvoj lokálny AI asistent. Ako ti môžem dnes pomôcť?",
    "sr_RS": "Здраво, ја сам Nox, твој локални АИ асистент. Како могу да ти помогнем данас?",
    "ka_GE": "მოგესალმებით, მე ვარ Nox, თქვენი ლოკალური AI ასისტენტი. როგორ შემიძლია დაგეხმარო დღეს?",
    "kk_KZ": "Сәлем, мен Nox, жергілікті ЖИ көмекшісімін. Бүгін саған қалай көмектесе аламын?",
    "lb_LU": "Moien, ech sinn Nox, däi lokalen AI-Assistent. Wéi kann ech dir haut hëllefen?",
    "ne_NP": "नमस्ते, म नक्स हुँ, तिम्रो स्थानीय एआई सहायक। आज म तिमीलाई कसरी मद्दत गर्न सक्छु?",
    "sl_SI": "Živjo, sem Nox, tvoj lokalni AI asistent. Kako ti lahko danes pomagam?",
    "sw_CD": "Habari, mimi ni Nox, msaidizi wako wa AI wa ndani. Ninaweza kukusaidia vipi leo?",
    "cy_GB": "Helo, fi yw Nox, eich cynorthwy-ydd AI lleol. Sut y gallaf eich helpu heddiw?",
    "hi": "नमस्ते, मैं नोक्स हूं, आपका स्थानीय एआई सहायक। आज मैं आपकी कैसे मदद कर सकता हूं?",
    "te": "నమస్తే, నేను నాక్స్, మీ స్థానిక ఏఐ సహాయకుడిని. నేను ఈరోజు మీకు ఎలా సహాయం చేయగలను?",
}

# Voice catalog: language_code -> list of voices
# Each voice: (name, quality, size_mb, gender, description)
# Gender: "male", "female", "neutral"

PIPER_VOICE_CATALOG = {
    "de_DE": {
        "language_name": "Deutsch",
        "language_native": "Deutsch",
        "voices": [
            ("thorsten", "medium", 63, "male", "Klare männliche Standardstimme"),
            ("thorsten", "high", 109, "male", "Höchste Qualität, männlich"),
            ("thorsten", "low", 21, "male", "Kompakte männliche Stimme"),
            ("thorsten_emotional", "medium", 63, "male", "Männlich mit Emotionskontrolle"),
            ("eva_k", "x_low", 12, "female", "Weiblich, sehr kompakt"),
            ("kerstin", "low", 21, "female", "Weibliche Stimme"),
            ("ramona", "low", 21, "female", "Weibliche Alternative"),
            ("karlsson", "low", 21, "male", "Männliche Alternative"),
            ("pavoque", "low", 21, "male", "Männlich, klare Aussprache"),
            ("mls", "medium", 63, "neutral", "Multi-speaker Dataset"),
        ],
    },
    "en_US": {
        "language_name": "English (US)",
        "language_native": "English (US)",
        "voices": [
            ("lessac", "medium", 63, "neutral", "Popular general-purpose voice"),
            ("lessac", "high", 109, "neutral", "Highest quality unisex voice"),
            ("lessac", "low", 21, "neutral", "Compact unisex voice"),
            ("ryan", "medium", 63, "male", "Male voice, good performance"),
            ("ryan", "high", 109, "male", "Male voice, highest quality"),
            ("amy", "medium", 63, "female", "Female, clear pronunciation"),
            ("amy", "low", 21, "female", "Female, compact"),
            ("ljspeech", "medium", 63, "female", "Female, LibriSpeech dataset"),
            ("ljspeech", "high", 109, "female", "Female, highest quality"),
            ("libritts", "high", 109, "neutral", "Multi-speaker, high quality"),
            ("arctic", "medium", 63, "neutral", "Multi-speaker, various accents"),
        ],
    },
    "en_GB": {
        "language_name": "English (UK)",
        "language_native": "English (UK)",
        "voices": [
            ("alan", "low", 21, "male", "Male British voice"),
            ("alan", "medium", 63, "male", "Male British, medium quality"),
            ("jenny_diann", "medium", 63, "female", "Female British voice"),
            ("cori", "high", 109, "female", "Female British, high quality"),
            ("cori", "medium", 63, "female", "Female British, medium"),
        ],
    },
    "fr_FR": {
        "language_name": "French",
        "language_native": "Français",
        "voices": [
            ("siwis", "medium", 63, "female", "Voix féminine française"),
            ("siwis", "low", 21, "female", "Voix féminine, compacte"),
            ("upmc", "medium", 63, "neutral", "Voix universitaire"),
            ("tom", "medium", 63, "male", "Voix masculine française"),
        ],
    },
    "es_ES": {
        "language_name": "Spanish (Spain)",
        "language_native": "Español (España)",
        "voices": [
            ("davefx", "medium", 63, "male", "Voz masculina española"),
            ("carlfm", "x_low", 12, "male", "Voz masculina, compacta"),
            ("mls_10246", "low", 21, "neutral", "Multi-speaker dataset"),
        ],
    },
    "es_MX": {
        "language_name": "Spanish (Mexico)",
        "language_native": "Español (México)",
        "voices": [
            ("ald", "medium", 63, "male", "Voz masculina mexicana"),
            ("claude", "high", 109, "male", "Voz masculina, alta calidad"),
        ],
    },
    "it_IT": {
        "language_name": "Italian",
        "language_native": "Italiano",
        "voices": [
            ("paola", "medium", 63, "female", "Voce femminile italiana"),
            ("riccardo", "x_low", 12, "male", "Voce maschile, compatta"),
        ],
    },
    "nl_NL": {
        "language_name": "Dutch",
        "language_native": "Nederlands",
        "voices": [
            ("mls", "medium", 63, "neutral", "Nederlandse stem"),
            ("flemishguy", "medium", 63, "male", "Mannelijke Vlaamse stem"),
            ("nathalie", "x_low", 12, "female", "Vrouwelijke stem, compact"),
        ],
    },
    "nl_BE": {
        "language_name": "Dutch (Belgium)",
        "language_native": "Nederlands (België)",
        "voices": [
            ("nathalie", "x_low", 12, "female", "Vrouwelijke Vlaamse stem"),
            ("rdh", "x_low", 12, "male", "Mannelijke Vlaamse stem"),
            ("toms", "x_low", 12, "male", "Mannelijke Vlaamse stem"),
        ],
    },
    "pl_PL": {
        "language_name": "Polish",
        "language_native": "Polski",
        "voices": [
            ("mc", "medium", 63, "male", "Męski głos polski"),
            ("mc", "x_low", 12, "male", "Męski głos, kompakt"),
            ("nina", "x_low", 12, "female", "Żeński głos, kompakt"),
            ("wikipedia", "medium", 63, "neutral", "Głos z Wikipedii"),
        ],
    },
    "pt_BR": {
        "language_name": "Portuguese (Brazil)",
        "language_native": "Português (Brasil)",
        "voices": [
            ("faber", "medium", 63, "male", "Voz masculina brasileira"),
            ("faber", "x_low", 12, "male", "Voz masculina, compacta"),
        ],
    },
    "pt_PT": {
        "language_name": "Portuguese",
        "language_native": "Português",
        "voices": [
            ("tugao", "medium", 63, "male", "Voz masculina portuguesa"),
        ],
    },
    "ru_RU": {
        "language_name": "Russian",
        "language_native": "Русский",
        "voices": [
            ("irina", "medium", 63, "female", "Женский голос"),
            ("irina", "x_low", 12, "female", "Женский голос, компакт"),
            ("ruslan", "medium", 63, "male", "Мужской голос"),
            ("nikolaev", "x_low", 12, "male", "Мужской голос, компакт"),
        ],
    },
    "tr_TR": {
        "language_name": "Turkish",
        "language_native": "Türkçe",
        "voices": [
            ("fettah", "x_low", 12, "male", "Erkek sesi, kompakt"),
            ("dfki", "medium", 63, "neutral", "Universite sesi"),
        ],
    },
    "sv_SE": {
        "language_name": "Swedish",
        "language_native": "Svenska",
        "voices": [
            ("nist", "medium", 63, "female", "Kvinnlig svensk röst"),
        ],
    },
    "no_NO": {
        "language_name": "Norwegian",
        "language_native": "Norsk",
        "voices": [
            ("talesyntese", "medium", 63, "neutral", "Norsk stemme"),
        ],
    },
    "da_DK": {
        "language_name": "Danish",
        "language_native": "Dansk",
        "voices": [
            ("talesyntese", "medium", 63, "neutral", "Dansk stemme"),
        ],
    },
    "cs_CZ": {
        "language_name": "Czech",
        "language_native": "Čeština",
        "voices": [
            ("jirka", "medium", 63, "male", "Mužský český hlas"),
        ],
    },
    "fi_FI": {
        "language_name": "Finnish",
        "language_native": "Suomi",
        "voices": [
            ("harri", "low", 21, "male", "Miesääni"),
            ("harri", "medium", 63, "male", "Miesääni, keskitaso"),
        ],
    },
    "uk_UA": {
        "language_name": "Ukrainian",
        "language_native": "Українська",
        "voices": [
            ("ukrainian_tts", "medium", 63, "neutral", "Український голос"),
        ],
    },
    "vi_VN": {
        "language_name": "Vietnamese",
        "language_native": "Tiếng Việt",
        "voices": [
            ("vos", "medium", 63, "neutral", "Giọng tiếng Việt"),
            ("vos", "x_low", 12, "neutral", "Giọng tiếng Việt, nhỏ"),
        ],
    },
    "zh_CN": {
        "language_name": "Chinese",
        "language_native": "简体中文",
        "voices": [
            ("huayan", "medium", 63, "female", "中文女声"),
            ("huayan", "x_low", 12, "female", "中文女声, 小"),
        ],
    },
    "ar_JO": {
        "language_name": "Arabic",
        "language_native": "العربية",
        "voices": [
            ("kareem", "medium", 63, "male", "صوت رجل"),
            ("kareem", "low", 21, "male", "صوت رجل, صغير"),
        ],
    },
    "ca_ES": {
        "language_name": "Catalan",
        "language_native": "Català",
        "voices": [
            ("pau", "x_low", 12, "male", "Veu masculina"),
            ("pau", "low", 21, "male", "Veu masculina, petita"),
        ],
    },
    "el_GR": {
        "language_name": "Greek",
        "language_native": "Ελληνικά",
        "voices": [
            ("rapunzelina", "low", 21, "female", "Γυναικεία φωνή"),
        ],
    },
    "fa_IR": {
        "language_name": "Farsi",
        "language_native": "فارسی",
        "voices": [
            ("amir", "medium", 63, "male", "صدای مردانه"),
            ("amir", "x_low", 12, "male", "صدای مردانه, کوچک"),
        ],
    },
    "hu_HU": {
        "language_name": "Hungarian",
        "language_native": "Magyar",
        "voices": [
            ("anna", "medium", 63, "female", "Női hang"),
            ("berta", "x_low", 12, "female", "Női hang, kis"),
        ],
    },
    "is_IS": {
        "language_name": "Icelandic",
        "language_native": "íslenska",
        "voices": [
            ("ugla", "medium", 63, "female", "Kvenrödd"),
            ("steinn", "medium", 63, "male", "Karlrödd"),
        ],
    },
    "ro_RO": {
        "language_name": "Romanian",
        "language_native": "Română",
        "voices": [
            ("mihai", "medium", 63, "male", "Voce masculină"),
        ],
    },
    "sk_SK": {
        "language_name": "Slovak",
        "language_native": "Slovenčina",
        "voices": [
            ("lili", "medium", 63, "female", "Ženský hlas"),
        ],
    },
    "sr_RS": {
        "language_name": "Serbian",
        "language_native": "srpski",
        "voices": [
            ("serbian-tts", "medium", 63, "neutral", "Srpski glas"),
        ],
    },
    "ka_GE": {
        "language_name": "Georgian",
        "language_native": "ქართული",
        "voices": [
            ("natia", "medium", 63, "female", "ქართული ხმა"),
        ],
    },
    "kk_KZ": {
        "language_name": "Kazakh",
        "language_native": "қазақша",
        "voices": [
            ("issai", "medium", 63, "neutral", "Қазақ дауысы"),
            ("issai", "x_low", 12, "neutral", "Қазақ дауысы, кіші"),
        ],
    },
    "lb_LU": {
        "language_name": "Luxembourgish",
        "language_native": "Lëtzebuergesch",
        "voices": [
            ("letzeburgesch", "medium", 63, "neutral", "Lëtzebuerger Stëmm"),
        ],
    },
    "ne_NP": {
        "language_name": "Nepali",
        "language_native": "नेपाली",
        "voices": [
            ("ne-google", "medium", 63, "neutral", "नेपाली आवाज"),
            ("chitwan", "medium", 63, "neutral", "नेपाली आवाज"),
        ],
    },
    "sl_SI": {
        "language_name": "Slovenian",
        "language_native": "Slovenščina",
        "voices": [
            ("artur", "medium", 63, "male", "Moški glas"),
        ],
    },
    "sw_CD": {
        "language_name": "Swahili",
        "language_native": "Kiswahili",
        "voices": [
            ("lanfrica", "medium", 63, "neutral", "Sauti ya Kiswahili"),
        ],
    },
    "cy_GB": {
        "language_name": "Welsh",
        "language_native": "Cymraeg",
        "voices": [
            ("bu_tts", "medium", 63, "neutral", "Llais Cymraeg"),
        ],
    },
    "hi": {
        "language_name": "Hindi",
        "language_native": "हिन्दी",
        "voices": [
            ("chaowen", "medium", 63, "neutral", "हिंदी आवाज़"),
        ],
    },
    "te": {
        "language_name": "Telugu",
        "language_native": "తెలుగు",
        "voices": [
            ("maya", "medium", 63, "female", "తెలుగు స్వరం"),
        ],
    },
}


def get_voice_download_urls(lang_code: str, voice_name: str, quality: str) -> tuple[str, str]:
    """Get download URLs for a Piper voice model and config.

    Returns (model_url, config_url).
    """
    # Special case for Hindi and Telugu (no country code in path)
    if lang_code in ("hi", "te"):
        model_url = f"{PIPER_VOICES_BASE}/{lang_code}/{lang_code}/{voice_name}/{quality}/{lang_code}-{voice_name}-{quality}.onnx"
        config_url = f"{PIPER_VOICES_BASE}/{lang_code}/{lang_code}/{voice_name}/{quality}/{lang_code}-{voice_name}-{quality}.onnx.json"
    else:
        lang_prefix = lang_code.split("_")[0]
        model_url = f"{PIPER_VOICES_BASE}/{lang_prefix}/{lang_code}/{voice_name}/{quality}/{lang_code}-{voice_name}-{quality}.onnx"
        config_url = f"{PIPER_VOICES_BASE}/{lang_prefix}/{lang_code}/{voice_name}/{quality}/{lang_code}-{voice_name}-{quality}.onnx.json"

    return (model_url + "?download=true", config_url)


def get_voice_file_name(lang_code: str, voice_name: str, quality: str) -> str:
    """Get the standard file name for a Piper voice."""
    return f"{lang_code}-{voice_name}-{quality}.onnx"


def get_sample_sentence(lang_code: str) -> str:
    """Get a sample sentence for the given language code."""
    return SAMPLE_SENTENCES.get(lang_code, "Hello, I am Nox.")


def detect_system_language() -> str:
    """Detect the system language and return a supported language code.

    Falls back to 'de_DE' if the system language is not supported.
    """
    import locale
    from nox_voice.supported_languages import find_supported_language

    try:
        loc = locale.getdefaultlocale()
        sys_lang = loc[0] if loc[0] else "de_DE"
        matched = find_supported_language(sys_lang)
        if matched:
            return matched
    except Exception:
        pass

    return "de_DE"


# Default voice and engine per language
DEFAULT_VOICES = {
    "ar_JO": ("ar-JO-TaimNeural", "edge"),
    "zh_CN": ("zf_xiaoxiao", "kokoro"),
    "cs_CZ": ("cs-CZ-VlastaNeural", "edge"),
    "da_DK": ("da-DK-ChristelNeural", "edge"),
    "nl_NL": ("nl-NL-ColetteNeural", "edge"),
    "en_GB": ("bf_lily", "kokoro"),
    "en_US": ("af_sky", "kokoro"),
    "fi_FI": ("fi-FI-NooraNeural", "edge"),
    "fr_FR": ("ff_siwis", "kokoro"),
    "de_DE": ("de-DE-SeraphinaMultilingualNeural", "edge"),
    "el_GR": ("el-GR-AthinaNeural", "edge"),
    "hi": ("hi-IN-SwaraNeural", "edge"),
    "hu_HU": ("hu-HU-NoemiNeural", "edge"),
    "it_IT": ("if_sara", "kokoro"),
    "ja_JP": ("ja-JP-NanamiNeural", "edge"),
    "pl_PL": ("pl-PL-MarekNeural", "edge"),
    "pt_PT": ("pt-PT-RaquelNeural", "edge"),
    "pt_BR": ("pf_dora", "kokoro"),
    "ro_RO": ("ro-RO-AlinaNeural", "edge"),
    "ru_RU": ("ru-RU-SvetlanaNeural", "edge"),
    "sk_SK": ("sk-SK-ViktoriaNeural", "edge"),
    "es_MX": ("es-MX-DaliaNeural", "edge"),
    "es_ES": ("ef_dora", "kokoro"),
    "sv_SE": ("sv-SE-SofieNeural", "edge"),
    "tr_TR": ("tr-TR-EmelNeural", "edge"),
    "uk_UA": ("uk-UA-PolinaNeural", "edge"),
    "vi_VN": ("vi-VN-HoaiMyNeural", "edge"),
}


# Default MALE voice per language — used when user has a male voice and
# the AI outputs text in a different language. Does NOT affect DEFAULT_VOICES (female).
DEFAULT_MALE_VOICES = {
    "ar_JO": ("ar-JO-TaimNeural", "edge"),
    "zh_CN": ("zm_yunxi", "kokoro"),
    "cs_CZ": ("cs-CZ-AntoninNeural", "edge"),
    "da_DK": ("da-DK-JeppeNeural", "edge"),
    "nl_NL": ("nl-NL-MaartenNeural", "edge"),
    "en_GB": ("bm_george", "kokoro"),
    "en_US": ("am_michael", "kokoro"),
    "fi_FI": ("fi-FI-HarriNeural", "edge"),
    "fr_FR": ("fr-FR-HenriNeural", "edge"),
    "de_DE": ("de-DE-ConradNeural", "edge"),
    "el_GR": ("el-GR-NestorasNeural", "edge"),
    "hi": ("hi-IN-MadhurNeural", "edge"),
    "hu_HU": ("hu-HU-TamasNeural", "edge"),
    "it_IT": ("im_nicola", "kokoro"),
    "ja_JP": ("ja-JP-KeitaNeural", "edge"),
    "pl_PL": ("pl-PL-MarekNeural", "edge"),
    "pt_PT": ("pt-PT-DuarteNeural", "edge"),
    "pt_BR": ("pm_alex", "kokoro"),
    "ro_RO": ("ro-RO-EmilNeural", "edge"),
    "ru_RU": ("ru-RU-DmitryNeural", "edge"),
    "sk_SK": ("sk-SK-LukasNeural", "edge"),
    "es_MX": ("es-MX-JorgeNeural", "edge"),
    "es_ES": ("em_alex", "kokoro"),
    "sv_SE": ("sv-SE-MattiasNeural", "edge"),
    "tr_TR": ("tr-TR-AhmetNeural", "edge"),
    "uk_UA": ("uk-UA-OstapNeural", "edge"),
    "vi_VN": ("vi-VN-NamMinhNeural", "edge"),
}


def get_default_voice(lang_code: str) -> tuple[str, str] | None:
    """Get the default (female) voice ID and engine for a language.

    Returns (voice_id, engine) or None if no default is configured.
    """
    return DEFAULT_VOICES.get(lang_code)


def get_default_male_voice(lang_code: str) -> tuple[str, str] | None:
    """Get the default male voice ID and engine for a language.

    Used when the user has a male voice selected and the AI outputs
    text in a different language. Falls back to DEFAULT_VOICES (female)
    if no male voice is available for the language.

    Returns (voice_id, engine) or None if no default is configured.
    """
    male = DEFAULT_MALE_VOICES.get(lang_code)
    if male:
        return male
    # Fallback to female default if no male voice available
    return DEFAULT_VOICES.get(lang_code)
