"""Orchestrator module – central coordination for chat processing.

Exports the Orchestrator class which manages:
- Context retrieval (nox_eye)
- Conversation history (SQLite)
- System prompt assembly (persona + voice/text mode)
- Ollama streaming (token-by-token)
- TTS sentence streaming
- Tool-calling (native + fallback)
- Context window management (summarization)
"""

from .orchestrator import Orchestrator

__all__ = ["Orchestrator"]
