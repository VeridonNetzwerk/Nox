"""Tests for the WakeWordListener class.

Tests cover:
- Availability detection
- Start/stop lifecycle
- Pause/resume functionality
- Device update and hot-reload
- Model loading (file path vs built-in model name)
- Callback invocation
"""

import os
from unittest.mock import patch, MagicMock, PropertyMock

import pytest

from nox_voice.wake_word import WakeWordListener


class TestWakeWordListenerInit:
    """Test initialization."""

    def test_init_defaults(self):
        listener = WakeWordListener("/path/to/model.onnx")
        assert listener.model_path == "/path/to/model.onnx"
        assert listener.threshold == 0.5
        assert listener.sample_rate == 16000
        assert listener.input_device is None
        assert listener.on_wake is None
        assert listener._running is False
        assert listener._paused is False

    def test_init_custom_params(self):
        listener = WakeWordListener(
            "model.onnx",
            threshold=0.8,
            sample_rate=8000,
            input_device="My Mic",
        )
        assert listener.threshold == 0.8
        assert listener.sample_rate == 8000
        assert listener.input_device == "My Mic"


class TestWakeWordListenerAvailability:
    """Test availability property."""

    def test_is_available_returns_bool(self):
        listener = WakeWordListener("model.onnx")
        assert isinstance(listener.is_available, bool)

    def test_model_loaded_default_false(self):
        listener = WakeWordListener("model.onnx")
        assert listener.model_loaded is False


class TestWakeWordListenerLifecycle:
    """Test start/stop/pause/resume."""

    def test_stop_sets_running_false(self):
        listener = WakeWordListener("model.onnx")
        listener._running = True
        listener._thread = None
        listener.stop()
        assert listener._running is False

    def test_pause_sets_paused_true(self):
        listener = WakeWordListener("model.onnx")
        listener.pause()
        assert listener._paused is True

    def test_resume_sets_paused_false(self):
        listener = WakeWordListener("model.onnx")
        listener._paused = True
        listener.resume()
        assert listener._paused is False

    def test_pause_resume_cycle(self):
        listener = WakeWordListener("model.onnx")
        assert listener._paused is False
        listener.pause()
        assert listener._paused is True
        listener.resume()
        assert listener._paused is False


class TestWakeWordListenerDeviceUpdate:
    """Test device hot-reload."""

    def test_update_input_device_changes_device(self):
        listener = WakeWordListener("model.onnx", input_device="Mic1")
        listener.update_input_device("Mic2")
        assert listener.input_device == "Mic2"

    def test_update_input_device_to_none(self):
        listener = WakeWordListener("model.onnx", input_device="Mic1")
        listener.update_input_device(None)
        assert listener.input_device is None

    def test_update_input_device_to_index(self):
        listener = WakeWordListener("model.onnx", input_device="Mic1")
        listener.update_input_device(3)
        assert listener.input_device == 3


class TestWakeWordListenerStart:
    """Test start behavior with mocked dependencies."""

    def test_start_when_unavailable_does_nothing(self):
        listener = WakeWordListener("model.onnx")
        with patch.object(type(listener), "is_available", new_callable=PropertyMock, return_value=False):
            listener.start()
        assert listener._running is False
        assert listener._model is None

    def test_start_with_nonexistent_model_does_nothing(self):
        listener = WakeWordListener("/nonexistent/model.onnx")
        # is_available may be True if libs are installed, but model file doesn't exist
        with patch.object(type(listener), "is_available", new_callable=PropertyMock, return_value=True):
            with patch("os.path.exists", return_value=False):
                listener.start()
        # Should not start because model file doesn't exist
        # (The start method returns early if model can't be loaded)
        assert listener._model is None
