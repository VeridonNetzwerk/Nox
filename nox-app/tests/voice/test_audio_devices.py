"""Tests for audio device utilities in nox_voice.audio_devices.

Tests cover:
- Device listing and resolution
- Handling of string device names vs indices
- Fallback behavior when sounddevice is unavailable
"""

from unittest.mock import patch, MagicMock

import pytest


class TestAudioDevicesResolution:
    """Test device resolution logic."""

    def test_resolve_input_device_default(self):
        from nox_voice.audio_devices import resolve_input_device
        # "default" should resolve to None (sounddevice default)
        result = resolve_input_device("default")
        assert result is None

    def test_resolve_input_device_none(self):
        from nox_voice.audio_devices import resolve_input_device
        result = resolve_input_device(None)
        assert result is None

    def test_resolve_output_device_default(self):
        from nox_voice.audio_devices import resolve_output_device
        result = resolve_output_device("default")
        assert result is None

    def test_resolve_output_device_none(self):
        from nox_voice.audio_devices import resolve_output_device
        result = resolve_output_device(None)
        assert result is None

    def test_resolve_input_device_by_index(self):
        from nox_voice.audio_devices import resolve_input_device
        # Integer indices should pass through
        result = resolve_input_device(2)
        assert result == 2

    def test_resolve_output_device_by_index(self):
        from nox_voice.audio_devices import resolve_output_device
        result = resolve_output_device(3)
        assert result == 3

    def test_resolve_input_device_empty_string(self):
        from nox_voice.audio_devices import resolve_input_device
        result = resolve_input_device("")
        assert result is None

    def test_resolve_output_device_empty_string(self):
        from nox_voice.audio_devices import resolve_output_device
        result = resolve_output_device("")
        assert result is None


class TestAudioDevicesListing:
    """Test device listing functions."""

    def test_list_devices_returns_dict(self):
        from nox_voice.audio_devices import list_devices
        devices = list_devices()
        assert isinstance(devices, dict)
        assert "input" in devices
        assert "output" in devices

    def test_list_devices_handles_no_sounddevice(self):
        """When sounddevice is not available, should return empty lists."""
        from nox_voice import audio_devices
        with patch.object(audio_devices, "_SD_AVAILABLE", False):
            devices = audio_devices.list_devices()
            assert devices == {"input": [], "output": []}

    def test_resolve_input_device_no_sounddevice(self):
        """When sounddevice is not available, should return None."""
        from nox_voice import audio_devices
        with patch.object(audio_devices, "_SD_AVAILABLE", False):
            result = audio_devices.resolve_input_device("Some Mic")
            assert result is None

    def test_resolve_output_device_no_sounddevice(self):
        """When sounddevice is not available, should return None."""
        from nox_voice import audio_devices
        with patch.object(audio_devices, "_SD_AVAILABLE", False):
            result = audio_devices.resolve_output_device("Some Speaker")
            assert result is None
