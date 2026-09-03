"""LLM backend abstraction – supports Ollama, OpenAI-compatible servers, and llama.cpp.

Auto-detects available backend at startup:
  1. Ollama (localhost:11434) — native /api/chat protocol
  2. OpenAI-compatible (LM Studio, llama.cpp server, etc.) — /v1/chat/completions
  3. llama.cpp in-process — loads GGUF directly via llama-cpp-python

All backends implement the same LLMBackend interface, so the orchestrator
works identically regardless of which backend is active.

Config keys:
  llm_backend: "auto" | "ollama" | "openai_compatible" | "llama_cpp"
  llm_endpoint: URL for OpenAI-compatible server (e.g. http://localhost:1234/v1)
  llm_model_path: Path to .gguf file for llama_cpp backend
  llm_api_key: API key for OpenAI-compatible server (optional, for remote services)
  ollama_host: URL for Ollama (kept for backward compat, used when llm_backend=ollama/auto)
  ollama_model: Model name (used for all backends)
  max_context_tokens: Context window size (default 8192)
  ollama_think: Enable thinking mode (Ollama only)
"""

import json
import logging
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
    ) -> AsyncIterator[Any]:
        """Stream chat completions. Yields str tokens or {"tool_calls": [...]} dicts."""
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


class OllamaBackend(LLMBackend):
    """Ollama native backend — uses /api/chat and /api/tags."""

    backend_type = "ollama"

    def __init__(self, host: str, model: str):
        self.endpoint = host.rstrip("/")
        self.model = model
        self._client: Optional[httpx.AsyncClient] = None
        self._tools_supported: Optional[bool] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(300.0, read=120.0),
            )
        return self._client

    async def check_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.endpoint}/api/tags")
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

    async def check_tools_support(self) -> bool:
        if self._tools_supported is not None:
            return self._tools_supported
        try:
            client = await self._get_client()
            resp = await client.get(f"{self.endpoint}/api/tags", timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    if m.get("name") == self.model or m.get("model") == self.model:
                        caps = m.get("capabilities", [])
                        self._tools_supported = "tools" in caps
                        return self._tools_supported
        except Exception as exc:
            logger.warning("Failed to check Ollama tools support: %s", exc)
        self._tools_supported = False
        return False

    def supports_tools(self) -> bool:
        return self._tools_supported is not None and self._tools_supported

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
    ) -> AsyncIterator[Any]:
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
                tool_calls = msg.get("tool_calls", [])
                if tool_calls:
                    yield {"tool_calls": tool_calls}
                    continue
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
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.endpoint}/models")
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

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
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


class LlamaCppBackend(LLMBackend):
    """In-process llama.cpp backend — loads GGUF models directly.

    Requires llama-cpp-python to be installed:
      pip install llama-cpp-python
    For GPU support:
      CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python
    """

    backend_type = "llama_cpp"

    def __init__(self, model_path: str, n_ctx: int = 8192, n_gpu_layers: int = -1, speed_mode: str = "balance"):
        self.model_path = model_path
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.speed_mode = speed_mode
        self._llm = None
        self._load_lock = None
        self.available = bool(model_path)

    def _get_preset(self) -> dict:
        return _SPEED_PRESETS.get(self.speed_mode, _SPEED_PRESETS["balance"])

    def set_speed_mode(self, mode: str) -> None:
        if mode in _SPEED_PRESETS:
            self.speed_mode = mode
            logger.info("LlamaCpp speed mode set to: %s", mode)

    def _load_model(self):
        """Load the GGUF model (lazy, synchronous)."""
        if self._llm is not None:
            return
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python is not installed. "
                "Install with: pip install llama-cpp-python"
            )
        logger.info("Loading GGUF model: %s (n_ctx=%d, n_gpu_layers=%d, speed_mode=%s)",
                    self.model_path, self.n_ctx, self.n_gpu_layers, self.speed_mode)
        self._llm = Llama(
            model_path=self.model_path,
            n_ctx=self.n_ctx,
            n_gpu_layers=self.n_gpu_layers,
            verbose=False,
        )
        logger.info("GGUF model loaded successfully")

    def unload_model(self) -> None:
        """Unload the GGUF model to free VRAM/RAM."""
        if self._llm is not None:
            logger.info("Unloading GGUF model to free resources")
            del self._llm
            self._llm = None
            import gc
            gc.collect()
            logger.info("GGUF model unloaded")

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

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict[str, Any]]] = None,
        think: bool = False,
        num_ctx: int = 8192,
        keep_alive: Any = None,
    ) -> AsyncIterator[Any]:
        import asyncio

        preset = self._get_preset()

        def _generate():
            self._load_model()
            return self._llm.create_chat_completion(
                messages=messages,
                stream=True,
                max_tokens=min(preset["max_tokens"], num_ctx),
                tools=tools if tools else None,
                temperature=preset["temperature"],
                top_p=preset["top_p"],
                top_k=preset["top_k"],
                repeat_penalty=preset["repeat_penalty"],
            )

        loop = asyncio.get_running_loop()
        stream = await loop.run_in_executor(None, _generate)

        # Iterate the synchronous generator in a thread to avoid blocking the event loop
        for chunk in stream:
            choices = chunk.get("choices", [])
            if not choices:
                continue
            delta = choices[0].get("delta", {})
            tool_calls = delta.get("tool_calls", [])
            if tool_calls:
                yield {"tool_calls": tool_calls}
                continue
            token = delta.get("content", "")
            if token:
                yield token
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
            await asyncio.sleep(0)  # Yield control to the event loop between chunks


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
        backend = LlamaCppBackend(model_path, n_ctx=num_ctx, n_gpu_layers=n_gpu, speed_mode=speed_mode)
        if await backend.check_available():
            logger.info("LLM backend: llama.cpp (GGUF: %s, speed: %s)", model_path, speed_mode)
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
        cpp_backend = LlamaCppBackend(model_path, n_ctx=num_ctx, n_gpu_layers=n_gpu, speed_mode=speed_mode)
        if await cpp_backend.check_available():
            logger.info("Auto-detected: llama.cpp (GGUF: %s, speed: %s)", model_path, speed_mode)
            return cpp_backend

    logger.warning("No LLM backend available in auto mode")
    return None
