"""LLM backend abstraction – supports Ollama, OpenAI-compatible servers, and llama.cpp.

Auto-detects available backend at startup:
  1. Ollama (localhost:11434) — native /api/chat protocol
  2. OpenAI-compatible (LM Studio, llama.cpp server, etc.) — /v1/chat/completions
  3. llama.cpp in-process — loads GGUF directly via llama-cpp-python

All backends implement the same LLMBackend interface, so the orchestrator
works identically regardless of which backend is active.

Features supported across all backends:
  - Streaming chat completions with tool calling
  - Thinking mode (reasoning trace separation)
  - Structured outputs / JSON mode (response_format)
  - Embeddings (text → vector)
  - Performance statistics (token counts, timings)
  - keep_alive (automatic model unloading after inactivity)
  - Vision / multimodal (image input for compatible models)
  - Speculative decoding (llama.cpp only, via draft_model)

Config keys:
  llm_backend: "auto" | "ollama" | "openai_compatible" | "llama_cpp"
  llm_endpoint: URL for OpenAI-compatible server (e.g. http://localhost:1234/v1)
  llm_model_path: Path to .gguf file for llama_cpp backend
  llm_api_key: API key for OpenAI-compatible server (optional, for remote services)
  ollama_host: URL for Ollama (kept for backward compat, used when llm_backend=ollama/auto)
  ollama_model: Model name (used for all backends)
  max_context_tokens: Context window size (default 8192)
  ollama_think: Enable thinking mode (all backends)
  llm_keep_alive: Seconds of inactivity before auto-unload (default 300, 0=never)
  llm_mmproj_path: Path to multimodal projector file (llama.cpp vision models)
  llm_draft_model_path: Path to draft model for speculative decoding (llama.cpp)
"""

import json
import logging
import re
import threading
import time
from typing import Any, AsyncIterator, Optional

import httpx

logger = logging.getLogger("nox.llm_backend")


class LLMBackend:
    """Abstract LLM backend that can stream chat completions."""

    backend_type: str = "unknown"
    endpoint: str = ""
    model: str = ""
    available: bool = False

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
        response_format: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[Any]:
        """Stream chat completions.

        Yields:
            str: Content tokens
            {"tool_calls": [...]}: Native tool call sentinel
            {"thinking": str}: Reasoning trace tokens (thinking mode)
            {"stats": dict}: Performance statistics on completion
        """
        raise NotImplementedError
        yield  # type: ignore

    async def get_available_models(self) -> list[str]:
        """Return list of available model names."""
        return []

    async def check_available(self) -> bool:
        """Check if this backend is reachable."""
        return False

    def supports_tools(self) -> bool:
        """Whether this backend supports native tool calling."""
        return False

    def supports_thinking(self) -> bool:
        """Whether this backend supports thinking/reasoning mode."""
        return False

    def supports_vision(self) -> bool:
        """Whether this backend supports image/multimodal input."""
        return False

    def supports_structured_output(self) -> bool:
        """Whether this backend supports JSON mode / structured outputs."""
        return False

    def supports_embeddings(self) -> bool:
        """Whether this backend can generate text embeddings."""
        return False

    async def embed(self, text: str | list[str]) -> Optional[list[list[float]]]:
        """Generate embeddings for the given text(s).

        Returns a list of embedding vectors (one per input string), or None on error.
        """
        return None

    def unload(self) -> None:
        """Unload model from memory (for keep_alive / resource management)."""
        pass


class OllamaBackend(LLMBackend):
    """Ollama native backend — uses /api/chat and /api/tags."""

    backend_type = "ollama"

    def __init__(self, host: str, model: str):
        self.endpoint = host.rstrip("/")
        self.model = model
        self._client: Optional[httpx.AsyncClient] = None
        self._tools_supported: Optional[bool] = None
        self._capabilities: Optional[list[str]] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(300.0, read=120.0),
            )
        return self._client

    async def check_available(self) -> bool:
        try:
            client = await self._get_client()
            resp = await client.get(
                f"{self.endpoint}/api/tags",
                timeout=5.0,
            )
            self.available = resp.status_code == 200
            return self.available
        except Exception:
            self.available = False
            return False

    async def get_available_models(self) -> list[str]:
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.endpoint}/api/tags", timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return [m.get("name", "") for m in data.get("models", [])]
        except Exception as exc:
            logger.error("Failed to fetch Ollama models: %s", exc)
            return []

    async def _ensure_capabilities(self) -> list[str]:
        """Fetch and cache model capabilities from Ollama."""
        if self._capabilities is not None:
            return self._capabilities
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.endpoint}/api/tags", timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    if m.get("name") == self.model or m.get("model") == self.model:
                        caps = m.get("capabilities", [])
                        self._capabilities = caps
                        self._tools_supported = "tools" in caps
                        return caps
        except Exception as exc:
            logger.warning("Failed to check Ollama capabilities: %s", exc)
        self._capabilities = []
        self._tools_supported = False
        return []

    async def check_tools_support(self) -> bool:
        await self._ensure_capabilities()
        return self._tools_supported is not None and self._tools_supported

    def supports_tools(self) -> bool:
        return self._tools_supported is not None and self._tools_supported

    def supports_thinking(self) -> bool:
        return "thinking" in (self._capabilities or [])

    def supports_vision(self) -> bool:
        return "vision" in (self._capabilities or [])

    def supports_structured_output(self) -> bool:
        return True

    def supports_embeddings(self) -> bool:
        return "embedding" in (self._capabilities or [])

    async def embed(self, text: str | list[str]) -> Optional[list[list[float]]]:
        """Generate embeddings via Ollama /api/embeddings."""
        inputs = [text] if isinstance(text, str) else text
        try:
            client = await self._get_client()
            results = []
            for inp in inputs:
                resp = await client.post(
                    f"{self.endpoint}/api/embeddings",
                    json={"model": self.model, "prompt": inp},
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.json()
                emb = data.get("embedding", [])
                results.append(emb)
            return results
        except Exception as exc:
            logger.error("Ollama embedding error: %s", exc)
            return None

    def unload(self) -> None:
        """Unload model from Ollama via keep_alive=0."""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(self._async_unload())
            else:
                loop.run_until_complete(self._async_unload())
        except Exception:
            pass

    async def _async_unload(self) -> None:
        try:
            client = await self._get_client()
            await client.post(
                f"{self.endpoint}/api/generate",
                json={"model": self.model, "keep_alive": 0},
                timeout=10.0,
            )
            logger.info("Ollama model unloaded: %s", self.model)
        except Exception as exc:
            logger.warning("Ollama unload failed: %s", exc)

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
        response_format: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[Any]:
        # Ensure capabilities are loaded for thinking/vision detection
        await self._ensure_capabilities()

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "think": think,
            "options": {
                "num_ctx": num_ctx,
                "temperature": 0.7,
                "top_p": 0.9,
                "repeat_penalty": 1.1,
                "top_k": 40,
            },
        }
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if tools:
            payload["tools"] = tools
        if response_format:
            payload["format"] = response_format.get("type", "json") if response_format.get("type") == "json_object" else response_format

        client = await self._get_client()
        async with client.stream(
            "POST",
            f"{self.endpoint}/api/chat",
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                try:
                    err_body = json.loads(body)
                except Exception:
                    err_body = {"error": body.decode(errors="replace")}
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}",
                    request=resp.request,
                    response=httpx.Response(
                        resp.status_code,
                        content=body,
                        headers=dict(resp.headers),
                        request=resp.request,
                    ),
                )
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON from Ollama stream: %s", line[:200])
                    continue
                msg = chunk.get("message", {})
                token = msg.get("content", "")
                thinking = msg.get("thinking", "")
                tool_calls = msg.get("tool_calls", [])
                if tool_calls:
                    yield {"tool_calls": tool_calls}
                    continue
                if thinking:
                    yield {"thinking": thinking}
                if token:
                    yield token
                if chunk.get("done", False):
                    stats = {
                        "prompt_eval_count": chunk.get("prompt_eval_count", 0),
                        "eval_count": chunk.get("eval_count", 0),
                        "prompt_eval_duration_ns": chunk.get("prompt_eval_duration", 0),
                        "eval_duration_ns": chunk.get("eval_duration", 0),
                        "total_duration_ns": chunk.get("total_duration", 0),
                        "load_duration_ns": chunk.get("load_duration", 0),
                    }
                    yield {"stats": stats}
                    break


class OpenAICompatibleBackend(LLMBackend):
    """OpenAI-compatible backend — works with LM Studio, llama.cpp server, etc."""

    backend_type = "openai_compatible"

    def __init__(self, endpoint: str, model: str, api_key: str = ""):
        self.endpoint = endpoint.rstrip("/")
        if not self.endpoint.endswith("/v1"):
            self.endpoint = self.endpoint + "/v1"
        self.model = model
        self.api_key = api_key or "not-needed"
        self._client: Optional[httpx.AsyncClient] = None
        self._tools_supported: Optional[bool] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=300.0,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
        return self._client

    async def check_available(self) -> bool:
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.endpoint}/models", timeout=5.0)
            self.available = resp.status_code == 200
            return self.available
        except Exception:
            self.available = False
            return False

    async def get_available_models(self) -> list[str]:
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.endpoint}/models", timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return [m.get("id", "") for m in data.get("data", [])]
        except Exception as exc:
            logger.error("Failed to fetch OpenAI-compatible models: %s", exc)
            return []

    async def check_tools_support(self) -> bool:
        # Most OpenAI-compatible servers support tools, but we can't be sure.
        # Default to True — if it fails, the orchestrator falls back to text parsing.
        if self._tools_supported is None:
            self._tools_supported = True
        return self._tools_supported

    def supports_tools(self) -> bool:
        return self._tools_supported is not None and self._tools_supported

    def supports_thinking(self) -> bool:
        return True

    def supports_vision(self) -> bool:
        return True

    def supports_structured_output(self) -> bool:
        return True

    def supports_embeddings(self) -> bool:
        return True

    async def embed(self, text: str | list[str]) -> Optional[list[list[float]]]:
        """Generate embeddings via OpenAI-compatible /v1/embeddings."""
        inputs = [text] if isinstance(text, str) else text
        try:
            client = await self._get_client()
            resp = await client.post(
                f"{self.endpoint}/embeddings",
                json={"model": self.model, "input": inputs},
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return [item["embedding"] for item in data.get("data", [])]
        except Exception as exc:
            logger.error("OpenAI-compatible embedding error: %s", exc)
            return None

    def unload(self) -> None:
        pass

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
        response_format: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": num_ctx,
            "temperature": 0.7,
            "top_p": 0.9,
            "frequency_penalty": 0.1,
        }
        if tools:
            payload["tools"] = [
                {"type": "function", "function": t} if "function" not in t else t
                for t in tools
            ]
        if response_format:
            payload["response_format"] = response_format

        client = await self._get_client()
        async with client.stream(
            "POST",
            f"{self.endpoint}/chat/completions",
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                try:
                    err_body = json.loads(body)
                except Exception:
                    err_body = {"error": body.decode(errors="replace")}
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}",
                    request=resp.request,
                    response=httpx.Response(
                        resp.status_code,
                        content=body,
                        headers=dict(resp.headers),
                        request=resp.request,
                    ),
                )
            async for line in resp.aiter_lines():
                if not line:
                    continue
                # SSE format: "data: {...}"
                if line.startswith("data: "):
                    line = line[6:]
                if line.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices", [])
                if not choices:
                    continue
                delta = choices[0].get("delta", {})
                tool_calls = delta.get("tool_calls", [])
                if tool_calls:
                    yield {"tool_calls": tool_calls}
                    continue
                # Thinking / reasoning trace (some servers use "reasoning_content")
                thinking = delta.get("thinking", "") or delta.get("reasoning_content", "")
                if thinking:
                    yield {"thinking": thinking}
                token = delta.get("content", "")
                if token:
                    yield token
                # Check for usage in final chunk
                usage = chunk.get("usage")
                if usage:
                    yield {"stats": {
                        "prompt_eval_count": usage.get("prompt_tokens", 0),
                        "eval_count": usage.get("completion_tokens", 0),
                        "total_duration_ns": 0,
                        "prompt_eval_duration_ns": 0,
                        "eval_duration_ns": 0,
                        "load_duration_ns": 0,
                    }}


_SPEED_PRESETS = {
    "superschnell": {"temperature": 0.3, "top_p": 0.8, "top_k": 20, "repeat_penalty": 1.05, "max_tokens": 2048},
    "schnell":      {"temperature": 0.5, "top_p": 0.85, "top_k": 30, "repeat_penalty": 1.1, "max_tokens": 4096},
    "balance":      {"temperature": 0.7, "top_p": 0.9, "top_k": 40, "repeat_penalty": 1.1, "max_tokens": 8192},
    "qualitaet":    {"temperature": 0.8, "top_p": 0.95, "top_k": 60, "repeat_penalty": 1.15, "max_tokens": 8192},
}


# Thinking tag patterns for stream parsing
_THINK_OPEN = re.compile(r"<think>")
_THINK_CLOSE = re.compile(r"</think>")


class _ThinkingStreamParser:
    """Parses thinking tags from a token stream in real-time.

    Splits incoming tokens into thinking trace and content tokens.
    Handles tags that span across token boundaries.
    """

    def __init__(self):
        self._in_thinking = False
        self._buffer = ""

    def feed(self, token: str):
        """Feed a token into the parser. Yields (kind, text) tuples.

        kind is "thinking" or "content".
        """
        self._buffer += token
        while self._buffer:
            if self._in_thinking:
                # Look for closing tag
                m = _THINK_CLOSE.search(self._buffer)
                if m:
                    # Emit thinking text before tag
                    text = self._buffer[:m.start()]
                    if text:
                        yield ("thinking", text)
                    self._buffer = self._buffer[m.end():]
                    self._in_thinking = False
                else:
                    # Check if buffer ends with partial closing tag
                    partial = self._partial_tag_match(self._buffer, "</think>")
                    if partial:
                        # Emit everything except the partial tag
                        text = self._buffer[:-partial]
                        if text:
                            yield ("thinking", text)
                        self._buffer = self._buffer[-partial:]
                        break
                    else:
                        # No closing tag found, emit all as thinking
                        yield ("thinking", self._buffer)
                        self._buffer = ""
                        break
            else:
                # Look for opening tag
                m = _THINK_OPEN.search(self._buffer)
                if m:
                    # Emit content before tag
                    text = self._buffer[:m.start()]
                    if text:
                        yield ("content", text)
                    self._buffer = self._buffer[m.end():]
                    self._in_thinking = True
                else:
                    # Check if buffer ends with partial opening tag
                    partial = self._partial_tag_match(self._buffer, "<think>")
                    if partial:
                        text = self._buffer[:-partial]
                        if text:
                            yield ("content", text)
                        self._buffer = self._buffer[-partial:]
                        break
                    else:
                        yield ("content", self._buffer)
                        self._buffer = ""
                        break

    def flush(self):
        """Flush any remaining buffer content at end of stream."""
        if self._buffer:
            if self._in_thinking:
                yield ("thinking", self._buffer)
            else:
                yield ("content", self._buffer)
            self._buffer = ""

    @staticmethod
    def _partial_tag_match(buffer: str, tag: str) -> int:
        """Check if buffer ends with a partial match of tag. Returns length of partial match or 0."""
        for i in range(min(len(tag) - 1, len(buffer)), 0, -1):
            if buffer[-i:] == tag[:i]:
                return i
        return 0


class LlamaCppBackend(LLMBackend):
    """In-process llama.cpp backend — loads GGUF models directly.

    Requires llama-cpp-python to be installed:
      pip install llama-cpp-python
    For GPU support:
      CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python

    Features:
      - Thinking mode: parses thinking tags from content stream
      - Structured outputs: JSON mode and JSON schema via response_format
      - Embeddings: via embedding=True constructor flag
      - Performance stats: token counts and timing from llama-cpp-python
      - keep_alive: timer-based automatic model unloading
      - Vision: multimodal models via chat_handler (mmproj file)
      - Speculative decoding: via draft_model parameter
    """

    backend_type = "llama_cpp"

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        speed_mode: str = "balance",
        mmproj_path: str = "",
        draft_model_path: str = "",
        keep_alive_seconds: float = 0,
    ):
        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.speed_mode = speed_mode
        self._mmproj_path = mmproj_path
        self._draft_model_path = draft_model_path
        self._keep_alive_seconds = keep_alive_seconds
        self._llm = None
        self._last_activity = 0.0
        self._unload_timer: Optional[threading.Timer] = None
        self._is_vision = False
        self._is_embedding = False
        self.available = bool(model_path)

    def _get_preset(self) -> dict:
        return _SPEED_PRESETS.get(self.speed_mode, _SPEED_PRESETS["balance"])

    def set_speed_mode(self, mode: str) -> None:
        if mode in _SPEED_PRESETS:
            self.speed_mode = mode
            logger.info("LlamaCpp speed mode set to: %s", mode)

    def _load_model(self):
        """Load the GGUF model (lazy, synchronous)."""
        if self._llm is not None and not self._is_embedding:
            return
        if self._llm is not None and self._is_embedding:
            # Model was loaded in embedding mode — reload in chat mode
            del self._llm
            import gc
            gc.collect()
            self._llm = None
            self._is_embedding = False
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python is not installed. "
                "Install with: pip install llama-cpp-python"
            )

        # Check if this is a vision model (has mmproj file)
        if self._mmproj_path:
            self._is_vision = True
            self._load_vision_model()
            return

        logger.info("Loading GGUF model: %s (n_ctx=%d, n_gpu_layers=%d, speed_mode=%s)",
                    self.model_path, self.n_ctx, self.n_gpu_layers, self.speed_mode)

        # Build kwargs for model loading
        kwargs: dict[str, Any] = {
            "model_path": self.model_path,
            "n_ctx": self.n_ctx,
            "n_gpu_layers": self.n_gpu_layers,
            "verbose": False,
            "no_perf": False,  # Enable performance timing
        }

        # Speculative decoding via draft model
        if self._draft_model_path:
            try:
                from llama_cpp import LlamaDraftModel
                kwargs["draft_model"] = LlamaDraftModel(
                    model_path=self._draft_model_path,
                    n_gpu_layers=self.n_gpu_layers,
                    verbose=False,
                )
                logger.info("Speculative decoding enabled with draft model: %s", self._draft_model_path)
            except Exception as exc:
                logger.warning("Failed to load draft model: %s — speculative decoding disabled", exc)

        self._llm = Llama(**kwargs)
        self._last_activity = time.monotonic()
        logger.info("GGUF model loaded successfully")

    def _load_vision_model(self):
        """Load a multimodal/vision model with chat handler."""
        try:
            from llama_cpp import Llama
            from pathlib import Path

            # Determine chat handler based on model name
            model_name = Path(self.model_path).stem.lower()
            chat_handler = self._get_vision_chat_handler(model_name)
            if chat_handler is None:
                logger.warning("Unknown vision model type: %s — loading as text model", model_name)
                self._is_vision = False
                self._mmproj_path = ""
                self._load_model()
                return

            logger.info("Loading vision GGUF model: %s (mmproj: %s)", self.model_path, self._mmproj_path)
            self._llm = Llama(
                model_path=self.model_path,
                n_ctx=self.n_ctx,
                n_gpu_layers=self.n_gpu_layers,
                verbose=False,
                no_perf=False,
                chat_handler=chat_handler,
                chat_format=self._get_vision_chat_format(model_name),
            )
            self._last_activity = time.monotonic()
            logger.info("Vision model loaded successfully")
        except Exception as exc:
            logger.error("Failed to load vision model: %s", exc)
            raise

    def _get_vision_chat_handler(self, model_name: str):
        """Get the appropriate chat handler for a vision model."""
        try:
            from llama_cpp.llama_chat_format import (
                Llava15ChatHandler,
                Llava16ChatHandler,
                MoondreamChatHandler,
                NanoLlavaChatHandler,
                Llama3VisionAlphaChatHandler,
                MiniCPMv26ChatHandler,
                Qwen25VLChatHandler,
                Gemma4ChatHandler,
            )

            handlers = {
                "llava-1.5": Llava15ChatHandler,
                "llava15": Llava15ChatHandler,
                "llava-1.6": Llava16ChatHandler,
                "llava16": Llava16ChatHandler,
                "moondream": MoondreamChatHandler,
                "nanollava": NanoLlavaChatHandler,
                "llama-3-vision": Llama3VisionAlphaChatHandler,
                "minicpm": MiniCPMv26ChatHandler,
                "qwen2.5-vl": Qwen25VLChatHandler,
                "qwen25vl": Qwen25VLChatHandler,
                "gemma4": Gemma4ChatHandler,
                "gemma-4": Gemma4ChatHandler,
            }

            for key, handler_cls in handlers.items():
                if key in model_name:
                    return handler_cls(clip_model_path=self._mmproj_path, verbose=False)
            return None
        except ImportError:
            logger.warning("llama-cpp-python vision handlers not available")
            return None

    def _get_vision_chat_format(self, model_name: str) -> str:
        """Get the chat format string for a vision model."""
        formats = {
            "llava-1.5": "llava-1-5",
            "llava15": "llava-1-5",
            "llava-1.6": "llava-1-6",
            "llava16": "llava-1-6",
            "moondream": "moondream2",
            "nanollava": "nanollava",
            "llama-3-vision": "llama-3-vision-alpha",
            "minicpm": "minicpm-v-2.6",
            "qwen2.5-vl": "qwen2.5-vl",
            "qwen25vl": "qwen2.5-vl",
            "gemma4": "gemma4",
            "gemma-4": "gemma4",
        }
        for key, fmt in formats.items():
            if key in model_name:
                return fmt
        return "chatml"

    def unload_model(self) -> None:
        """Unload the GGUF model to free VRAM/RAM."""
        self._cancel_unload_timer()
        if self._llm is not None:
            logger.info("Unloading GGUF model to free resources")
            del self._llm
            self._llm = None
            import gc
            gc.collect()
            logger.info("GGUF model unloaded")

    def unload(self) -> None:
        """Public unload method (LLMBackend interface)."""
        self.unload_model()

    def _cancel_unload_timer(self):
        if self._unload_timer is not None:
            self._unload_timer.cancel()
            self._unload_timer = None

    def _schedule_unload_timer(self):
        """Schedule automatic model unload after keep_alive_seconds of inactivity."""
        self._cancel_unload_timer()
        if self._keep_alive_seconds and self._keep_alive_seconds > 0:
            self._unload_timer = threading.Timer(
                self._keep_alive_seconds,
                self.unload_model,
            )
            self._unload_timer.daemon = True
            self._unload_timer.start()
            logger.debug("Scheduled model unload in %.0fs", self._keep_alive_seconds)

    def _touch_activity(self):
        """Record activity and reschedule unload timer."""
        self._last_activity = time.monotonic()
        self._schedule_unload_timer()

    async def check_available(self) -> bool:
        if not self.model_path:
            self.available = False
            return False
        try:
            from pathlib import Path
            p = Path(self.model_path)
            self.available = p.exists() and p.suffix == ".gguf"
        except Exception:
            self.available = False
        return self.available

    async def get_available_models(self) -> list[str]:
        if await self.check_available():
            from pathlib import Path
            return [Path(self.model_path).name]
        return []

    def supports_tools(self) -> bool:
        return True

    def supports_thinking(self) -> bool:
        return True  # Thinking tags are parsed from content stream

    def supports_vision(self) -> bool:
        return self._is_vision or bool(self._mmproj_path)

    def supports_structured_output(self) -> bool:
        return True  # llama-cpp-python supports response_format

    def supports_embeddings(self) -> bool:
        return True  # We enable embedding=True on demand

    async def embed(self, text: str | list[str]) -> Optional[list[list[float]]]:
        """Generate embeddings using llama-cpp-python's create_embedding."""
        import asyncio
        inputs = [text] if isinstance(text, str) else text

        def _embed():
            # Reload with embedding=True if not already in embedding mode
            if self._llm is None or not self._is_embedding:
                if self._llm is not None:
                    del self._llm
                    import gc
                    gc.collect()
                from llama_cpp import Llama
                logger.info("Reloading GGUF model with embedding=True")
                self._llm = Llama(
                    model_path=self.model_path,
                    n_ctx=self.n_ctx,
                    n_gpu_layers=self.n_gpu_layers,
                    verbose=False,
                    embedding=True,
                    no_perf=False,
                )
                self._is_embedding = True
                self._last_activity = time.monotonic()
            results = []
            for inp in inputs:
                emb = self._llm.create_embedding(inp)
                data = emb.get("data", [])
                if data:
                    results.append(data[0].get("embedding", []))
                else:
                    results.append([])
            return results

        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, _embed)
        except Exception as exc:
            logger.error("LlamaCpp embedding error: %s", exc)
            return None

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
        response_format: Optional[dict[str, Any]] = None,
    ) -> AsyncIterator[Any]:
        import asyncio

        preset = self._get_preset()

        # Build generation kwargs
        gen_kwargs: dict[str, Any] = {
            "messages": messages,
            "stream": True,
            "max_tokens": min(preset["max_tokens"], num_ctx),
            "temperature": preset["temperature"],
            "top_p": preset["top_p"],
            "top_k": preset["top_k"],
            "repeat_penalty": preset["repeat_penalty"],
        }
        if tools:
            gen_kwargs["tools"] = tools

        # Structured outputs / JSON mode
        if response_format:
            fmt = response_format.get("type", "")
            if fmt == "json_object":
                if response_format.get("schema"):
                    gen_kwargs["response_format"] = {
                        "type": "json_object",
                        "schema": response_format["schema"],
                    }
                else:
                    gen_kwargs["response_format"] = {"type": "json_object"}
            elif fmt == "json_schema":
                gen_kwargs["response_format"] = {
                    "type": "json_object",
                    "schema": response_format.get("schema", {}),
                }
            else:
                gen_kwargs["response_format"] = response_format

        # Thinking mode: enable thinking in chat template if supported
        if think:
            gen_kwargs["chat_template_kwargs"] = {"enable_thinking": True}

        def _generate():
            self._load_model()
            self._touch_activity()
            return self._llm.create_chat_completion(**gen_kwargs)

        loop = asyncio.get_running_loop()
        stream = await loop.run_in_executor(None, _generate)

        # Thinking parser: splits content stream into thinking and content tokens
        thinking_parser = _ThinkingStreamParser() if think else None

        for chunk in stream:
            self._touch_activity()
            choices = chunk.get("choices", [])
            if not choices:
                continue
            delta = choices[0].get("delta", {})
            tool_calls = delta.get("tool_calls", [])
            if tool_calls:
                yield {"tool_calls": tool_calls}
                continue

            # Check for native thinking field (some llama-cpp-python versions)
            native_thinking = delta.get("thinking", "") or delta.get("reasoning_content", "")
            token = delta.get("content", "")

            if native_thinking:
                yield {"thinking": native_thinking}

            if token:
                if thinking_parser:
                    for kind, text in thinking_parser.feed(token):
                        if kind == "thinking":
                            yield {"thinking": text}
                        else:
                            yield text
                else:
                    yield token

            # Performance statistics
            usage = chunk.get("usage")
            if usage:
                # Extract timing from llama-cpp-python if available
                timings = chunk.get("timings", {})
                stats = {
                    "prompt_eval_count": usage.get("prompt_tokens", 0),
                    "eval_count": usage.get("completion_tokens", 0),
                    "total_duration_ns": int(timings.get("total_time_ms", 0) * 1_000_000),
                    "prompt_eval_duration_ns": int(timings.get("prompt_eval_time_ms", 0) * 1_000_000),
                    "eval_duration_ns": int(timings.get("eval_time_ms", 0) * 1_000_000),
                    "load_duration_ns": int(timings.get("load_time_ms", 0) * 1_000_000),
                    "prompt_eval_cached_count": timings.get("prompt_cache_hit_tokens", 0),
                }
                yield {"stats": stats}

            await asyncio.sleep(0)

        # Flush any remaining thinking parser buffer
        if thinking_parser:
            for kind, text in thinking_parser.flush():
                if kind == "thinking":
                    yield {"thinking": text}
                else:
                    yield text

        # Schedule unload if keep_alive is configured
        if self._keep_alive_seconds and self._keep_alive_seconds > 0:
            self._schedule_unload_timer()


# Common OpenAI-compatible endpoints to try in auto mode
_AUTO_OPENAI_ENDPOINTS = [
    "http://localhost:1234/v1",      # LM Studio default
    "http://127.0.0.1:8080/v1",      # llama.cpp server default
    "http://localhost:5000/v1",      # some servers
]


async def create_backend(config: dict[str, Any]) -> Optional[LLMBackend]:
    """Create and auto-detect the best LLM backend.

    Returns an initialized, available backend or None if no backend is available.
    If a specific backend is configured but not available, falls through to
    auto-detection (e.g. LM Studio was configured but only Ollama is running).
    """
    backend_type = config.get("llm_backend", "auto")
    model = config.get("ollama_model", "qwen3:14b")
    num_ctx = config.get("max_context_tokens", 8192)

    if backend_type == "ollama":
        host = config.get("ollama_host", "http://localhost:11434")
        backend = OllamaBackend(host, model)
        if await backend.check_available():
            logger.info("LLM backend: Ollama at %s", host)
            return backend
        logger.warning("Ollama backend not available at %s — falling through to auto-detect", host)
        # Fall through to auto-detection

    if backend_type == "openai_compatible":
        endpoint = config.get("llm_endpoint", "http://localhost:1234/v1")
        api_key = config.get("llm_api_key", "")
        backend = OpenAICompatibleBackend(endpoint, model, api_key)
        if await backend.check_available():
            logger.info("LLM backend: OpenAI-compatible at %s", endpoint)
            return backend
        logger.warning("OpenAI-compatible backend not available at %s — falling through to auto-detect", endpoint)
        # Fall through to auto-detection

    if backend_type == "llama_cpp":
        model_path = config.get("llm_model_path", "")
        n_gpu = config.get("llm_gpu_layers", -1)
        speed_mode = config.get("llm_speed_mode", "balance")
        mmproj = config.get("llm_mmproj_path", "")
        draft_model = config.get("llm_draft_model_path", "")
        keep_alive = config.get("llm_keep_alive", 0)
        backend = LlamaCppBackend(
            model_path, n_ctx=num_ctx, n_gpu_layers=n_gpu, speed_mode=speed_mode,
            mmproj_path=mmproj, draft_model_path=draft_model, keep_alive_seconds=keep_alive,
        )
        if await backend.check_available():
            extras = []
            if mmproj:
                extras.append("vision")
            if draft_model:
                extras.append("speculative")
            if keep_alive:
                extras.append(f"keep_alive={keep_alive}s")
            extra_str = f" [{', '.join(extras)}]" if extras else ""
            logger.info("LLM backend: llama.cpp (GGUF: %s, speed: %s%s)", model_path, speed_mode, extra_str)
            return backend
        logger.warning("llama.cpp backend not available (model path: %s) — falling through to auto-detect", model_path)
        # Fall through to auto-detection

    # Auto mode: try Ollama first, then OpenAI-compatible endpoints
    logger.info("Auto-detecting LLM backend...")

    # 1. Try Ollama
    ollama_host = config.get("ollama_host", "http://localhost:11434")
    ollama_backend = OllamaBackend(ollama_host, model)
    if await ollama_backend.check_available():
        logger.info("Auto-detected: Ollama at %s", ollama_host)
        return ollama_backend

    # 2. Try OpenAI-compatible endpoints
    configured_endpoint = config.get("llm_endpoint", "")
    api_key = config.get("llm_api_key", "")
    endpoints_to_try = []
    if configured_endpoint:
        endpoints_to_try.append(configured_endpoint)
    endpoints_to_try.extend(
        ep for ep in _AUTO_OPENAI_ENDPOINTS if ep not in endpoints_to_try
    )

    for endpoint in endpoints_to_try:
        oai_backend = OpenAICompatibleBackend(endpoint, model, api_key)
        if await oai_backend.check_available():
            logger.info("Auto-detected: OpenAI-compatible at %s", endpoint)
            config["llm_endpoint"] = endpoint
            return oai_backend

    # 3. Try llama.cpp if a model path is configured
    model_path = config.get("llm_model_path", "")
    if model_path:
        n_gpu = config.get("llm_gpu_layers", -1)
        speed_mode = config.get("llm_speed_mode", "balance")
        mmproj = config.get("llm_mmproj_path", "")
        draft_model = config.get("llm_draft_model_path", "")
        keep_alive = config.get("llm_keep_alive", 0)
        cpp_backend = LlamaCppBackend(
            model_path, n_ctx=num_ctx, n_gpu_layers=n_gpu, speed_mode=speed_mode,
            mmproj_path=mmproj, draft_model_path=draft_model, keep_alive_seconds=keep_alive,
        )
        if await cpp_backend.check_available():
            logger.info("Auto-detected: llama.cpp (GGUF: %s, speed: %s)", model_path, speed_mode)
            return cpp_backend

    logger.warning("No LLM backend available in auto mode")
    return None
