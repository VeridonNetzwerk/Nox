"""Supported languages for Nox.

Only languages that have at least one TTS engine (Kokoro or Edge TTS) are listed here.
This is the single source of truth for which languages Nox supports.
"""

# Union of Kokoro and Edge TTS supported languages
# Each entry: lang_code -> (language_name, language_native)
SUPPORTED_LANGUAGES = {
    "de_DE": ("German", "Deutsch"),
    "en_US": ("English (US)", "English (US)"),
    "en_GB": ("English (UK)", "English (UK)"),
    "fr_FR": ("French", "Fran\u00e7ais"),
    "es_ES": ("Spanish (Spain)", "Espa\u00f1ol (Espa\u00f1a)"),
    "es_MX": ("Spanish (Mexico)", "Espa\u00f1ol (M\u00e9xico)"),
    "it_IT": ("Italian", "Italiano"),
    "ja_JP": ("Japanese", "\u65e5\u672c\u8a9e"),
    "zh_CN": ("Chinese", "\u7b80\u4f53\u4e2d\u6587"),
    "nl_NL": ("Dutch", "Nederlands"),
    "pl_PL": ("Polish", "Polski"),
    "pt_BR": ("Portuguese (Brazil)", "Portugu\u00eas (Brasil)"),
    "pt_PT": ("Portuguese", "Portugu\u00eas"),
    "ru_RU": ("Russian", "\u0420\u0443\u0441\u0441\u043a\u0438\u0439"),
    "tr_TR": ("Turkish", "T\u00fcrk\u00e7e"),
    "sv_SE": ("Swedish", "Svenska"),
    "da_DK": ("Danish", "Dansk"),
    "cs_CZ": ("Czech", "\u010ce\u0161tina"),
    "fi_FI": ("Finnish", "Suomi"),
    "uk_UA": ("Ukrainian", "\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430"),
    "vi_VN": ("Vietnamese", "Ti\u1ebfng Vi\u1ec7t"),
    "ar_JO": ("Arabic", "\u0627\u0644\u0639\u0631\u0628\u064a\u0629"),
    "hu_HU": ("Hungarian", "Magyar"),
    "ro_RO": ("Romanian", "Rom\u00e2n\u0103"),
    "sk_SK": ("Slovak", "Sloven\u010dina"),
    "el_GR": ("Greek", "\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac"),
    "hi": ("Hindi", "\u0939\u093f\u0928\u094d\u0926\u0940"),
}


def get_supported_languages() -> dict:
    """Return supported languages in API-friendly format."""
    result = {}
    for lang_code, (name, native) in SUPPORTED_LANGUAGES.items():
        result[lang_code] = {
            "language_name": name,
            "language_native": native,
        }
    return result


def find_supported_language(lang_code: str) -> str | None:
    """Try to find a supported language matching the given code.
    
    Tries exact match, then prefix match (e.g. 'de' -> 'de_DE').
    Returns the matched code or None.
    """
    if lang_code in SUPPORTED_LANGUAGES:
        return lang_code
    
    # Try prefix match
    prefix = lang_code.split("_")[0].lower()
    for code in SUPPORTED_LANGUAGES:
        if code.lower().startswith(prefix + "_") or code.lower() == prefix:
            return code
    
    return None
