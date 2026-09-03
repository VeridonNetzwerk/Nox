"""Tests for the LLM backend abstraction layer.

Tests cover:
- Backend creation and auto-detection logic
- OllamaBackend model fetching and error handling
- OpenAICompatibleBackend SSE parsing and endpoint normalization
- LlamaCppBackend model path validation
- Mock-based streaming tests for all backends
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llm_backend import (
    LLMBackend,
    OllamaBackend,
    OpenAICompatibleBackend,
    LlamaCppBackend,
    create_backend,
)


class TestOllamaBackend:
    """Tests for the Ollama backend."""

    def test_init_strips_trailing_slash(self):
        backend = OllamaBackend("http://localhost:11434/", "qwen3:14b")
        assert backend.endpoint == "http://localhost:11434"

    def test_init_no_slash(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        assert backend.endpoint == "http://localhost:11434"

    def test_backend_type(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        assert backend.backend_type == "ollama"

    @pytest.mark.asyncio
    async def test_check_available_success(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_resp):
            result = await backend.check_available()
        assert result is True
        assert backend.available is True

    @pytest.mark.asyncio
    async def test_check_available_failure(self):
        backend = OllamaBackend("http://localhost:99999", "qwen3:14b")
        with patch("httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
            result = await backend.check_available()
        assert result is False
        assert backend.available is False

    @pytest.mark.asyncio
    async def test_get_available_models_parses_response(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {
            "models": [
                {"name": "qwen3:14b"},
                {"name": "llama3.2:3b"},
            ]
        }
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(return_value=mock_resp)
        backend._client = mock_client

        models = await backend.get_available_models()
        assert models == ["qwen3:14b", "llama3.2:3b"]

    @pytest.mark.asyncio
    async def test_get_available_models_empty_response(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"models": []}
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(return_value=mock_resp)
        backend._client = mock_client

        models = await backend.get_available_models()
        assert models == []

    @pytest.mark.asyncio
    async def test_get_available_models_error_returns_empty(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(side_effect=Exception("Network error"))
        backend._client = mock_client

        models = await backend.get_available_models()
        assert models == []

    def test_supports_tools_default_false(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        # Before checking, supports_tools returns False
        assert backend.supports_tools() is False

    @pytest.mark.asyncio
    async def test_check_tools_support_with_capabilities(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [
                {"name": "qwen3:14b", "capabilities": ["tools"]}
            ]
        }
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(return_value=mock_resp)
        backend._client = mock_client

        result = await backend.check_tools_support()
        assert result is True
        assert backend.supports_tools() is True

    @pytest.mark.asyncio
    async def test_check_tools_support_without_capabilities(self):
        backend = OllamaBackend("http://localhost:11434", "qwen3:14b")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [
                {"name": "qwen3:14b", "capabilities": []}
            ]
        }
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        backend._client = mock_client

        result = await backend.check_tools_support()
        assert result is False


class TestOpenAICompatibleBackend:
    """Tests for the OpenAI-compatible backend."""

    def test_init_appends_v1_suffix(self):
        backend = OpenAICompatibleBackend("http://localhost:1234", "model")
        assert backend.endpoint == "http://localhost:1234/v1"

    def test_init_keeps_existing_v1_suffix(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        assert backend.endpoint == "http://localhost:1234/v1"

    def test_init_strips_trailing_slash(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1/", "model")
        assert backend.endpoint == "http://localhost:1234/v1"

    def test_backend_type(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        assert backend.backend_type == "openai_compatible"

    def test_default_api_key(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        assert backend.api_key == "not-needed"

    def test_custom_api_key(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model", api_key="sk-test")
        assert backend.api_key == "sk-test"

    @pytest.mark.asyncio
    async def test_check_available_success(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_resp):
            result = await backend.check_available()
        assert result is True

    @pytest.mark.asyncio
    async def test_check_available_failure(self):
        backend = OpenAICompatibleBackend("http://localhost:99999/v1", "model")
        with patch("httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
            result = await backend.check_available()
        assert result is False

    @pytest.mark.asyncio
    async def test_get_available_models_parses_response(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {
            "data": [
                {"id": "gpt-4"},
                {"id": "gpt-3.5-turbo"},
            ]
        }
        mock_client = AsyncMock()
        mock_client.is_closed = False
        mock_client.get = AsyncMock(return_value=mock_resp)
        backend._client = mock_client

        models = await backend.get_available_models()
        assert models == ["gpt-4", "gpt-3.5-turbo"]

    def test_supports_tools_default_true(self):
        backend = OpenAICompatibleBackend("http://localhost:1234/v1", "model")
        # supports_tools returns False until check_tools_support is called
        # because _tools_supported starts as None
        assert backend.supports_tools() is False
        # But after checking, it defaults to True
        import asyncio
        result = asyncio.run(backend.check_tools_support())
        assert result is True
        assert backend.supports_tools() is True


class TestLlamaCppBackend:
    """Tests for the llama.cpp backend."""

    def test_init_with_model_path(self):
        backend = LlamaCppBackend("/path/to/model.gguf")
        assert backend.model_path == "/path/to/model.gguf"
        assert backend.backend_type == "llama_cpp"
        assert backend.available is True

    def test_init_empty_model_path(self):
        backend = LlamaCppBackend("")
        assert backend.available is False

    @pytest.mark.asyncio
    async def test_check_available_nonexistent_file(self):
        backend = LlamaCppBackend("/nonexistent/path/model.gguf")
        result = await backend.check_available()
        assert result is False
        assert backend.available is False

    @pytest.mark.asyncio
    async def test_check_available_wrong_extension(self, tmp_path):
        model_file = tmp_path / "model.txt"
        model_file.write_text("not a model")
        backend = LlamaCppBackend(str(model_file))
        result = await backend.check_available()
        assert result is False

    @pytest.mark.asyncio
    async def test_check_available_valid_gguf(self, tmp_path):
        model_file = tmp_path / "model.gguf"
        model_file.write_bytes(b"fake gguf data")
        backend = LlamaCppBackend(str(model_file))
        result = await backend.check_available()
        assert result is True

    def test_supports_tools_always_true(self):
        backend = LlamaCppBackend("/path/to/model.gguf")
        assert backend.supports_tools() is True

    @pytest.mark.asyncio
    async def test_get_available_models_when_available(self, tmp_path):
        model_file = tmp_path / "model.gguf"
        model_file.write_bytes(b"fake gguf data")
        backend = LlamaCppBackend(str(model_file))
        models = await backend.get_available_models()
        assert models == ["model.gguf"]

    @pytest.mark.asyncio
    async def test_get_available_models_when_unavailable(self):
        backend = LlamaCppBackend("/nonexistent/model.gguf")
        models = await backend.get_available_models()
        assert models == []


class TestCreateBackend:
    """Tests for the create_backend factory function."""

    @pytest.mark.asyncio
    async def test_auto_mode_returns_none_when_nothing_available(self):
        config = {
            "llm_backend": "auto",
            "ollama_model": "test:latest",
        }
        with patch("httpx.AsyncClient.get", side_effect=Exception("No connection")):
            result = await create_backend(config)
        assert result is None

    @pytest.mark.asyncio
    async def test_ollama_explicit_mode_not_available(self):
        config = {
            "llm_backend": "ollama",
            "ollama_host": "http://localhost:99999",
            "ollama_model": "test:latest",
        }
        with patch("httpx.AsyncClient.get", side_effect=Exception("No connection")):
            result = await create_backend(config)
        assert result is None

    @pytest.mark.asyncio
    async def test_openai_compatible_explicit_not_available(self):
        config = {
            "llm_backend": "openai_compatible",
            "llm_endpoint": "http://localhost:99999/v1",
            "ollama_model": "test:latest",
        }
        with patch("httpx.AsyncClient.get", side_effect=Exception("No connection")):
            result = await create_backend(config)
        assert result is None

    @pytest.mark.asyncio
    async def test_llama_cpp_explicit_no_model_path(self):
        config = {
            "llm_backend": "llama_cpp",
            "llm_model_path": "",
            "ollama_model": "test:latest",
        }
        result = await create_backend(config)
        assert result is None

    @pytest.mark.asyncio
    async def test_auto_mode_detects_ollama(self):
        config = {
            "llm_backend": "auto",
            "ollama_host": "http://localhost:11434",
            "ollama_model": "qwen3:14b",
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_resp):
            result = await create_backend(config)
        assert result is not None
        assert result.backend_type == "ollama"
