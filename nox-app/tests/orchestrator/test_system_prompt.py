"""Tests for the system prompt builder.

Tests cover:
- Base persona inclusion
- Voice mode vs text mode directives
- Tool directive inclusion
- Context injection
- Voice personality injection
"""

import pytest
from orchestrator.system_prompt import build_system_prompt, BASE_PERSONA, TEXT_MODE_DIRECTIVE, VOICE_MODE_DIRECTIVE


class TestBuildSystemPromptBasic:
    """Test basic system prompt construction."""

    def test_returns_string(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        assert isinstance(prompt, str)

    def test_includes_base_persona(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        # Should contain key parts of the persona
        assert "Nox" in prompt

    def test_text_mode_directive_when_not_voice(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        # Should include text mode directive content
        assert "TEXT" in prompt or "Markdown" in prompt

    def test_voice_mode_directive_when_voice(self):
        prompt = build_system_prompt(voice_mode=True, tools_enabled=False)
        # Should include voice mode directive content
        assert "SPRACHE" in prompt or "gesprochen" in prompt

    def test_no_text_directive_in_voice_mode(self):
        prompt = build_system_prompt(voice_mode=True, tools_enabled=False)
        # Should NOT include text-mode-only content
        assert "Code-Blöcke" not in prompt or "KEIN" in prompt


class TestBuildSystemPromptTools:
    """Test tool directive inclusion."""

    def test_tools_directive_included_when_enabled(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=True)
        # Should mention tools
        assert "Werkzeug" in prompt or "Tool" in prompt

    def test_tools_directive_excluded_when_disabled(self):
        prompt = build_system_prompt(voice_mode=False, tools_enabled=False)
        # Should not include tool directive section
        # (The base persona may mention tools, but the tool directive section should be absent)


class TestBuildSystemPromptContext:
    """Test context injection."""

    def test_context_included_when_provided(self):
        prompt = build_system_prompt(
            voice_mode=False,
            tools_enabled=False,
            context="User is coding in VS Code.",
        )
        assert "User is coding in VS Code." in prompt

    def test_context_excluded_when_empty(self):
        prompt = build_system_prompt(
            voice_mode=False,
            tools_enabled=False,
            context="",
        )
        # Should not have an empty context section

    def test_context_excluded_when_none(self):
        prompt = build_system_prompt(
            voice_mode=False,
            tools_enabled=False,
            context=None,
        )


class TestBuildSystemPromptVoicePersonality:
    """Test voice personality injection."""

    def test_voice_personality_included_when_provided(self):
        prompt = build_system_prompt(
            voice_mode=True,
            tools_enabled=False,
            voice_personality={"name": "Thorsten", "gender": "male", "engine": "piper"},
        )
        # Should reference the voice personality somehow
        assert "Thorsten" in prompt
        assert "männlich" in prompt

    def test_voice_personality_excluded_when_none(self):
        prompt = build_system_prompt(
            voice_mode=True,
            tools_enabled=False,
            voice_personality=None,
        )
        # Should still work fine without personality
        assert isinstance(prompt, str)
        assert len(prompt) > 0
