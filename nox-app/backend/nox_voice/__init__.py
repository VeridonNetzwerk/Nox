"""Nox Voice Pipeline Module

Provides wake word detection, speech-to-text (STT), and text-to-speech (TTS).
All components degrade gracefully if dependencies are missing.
"""

from .voice_manager import VoiceManager

__all__ = ["VoiceManager"]
