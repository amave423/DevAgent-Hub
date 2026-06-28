"""Unified LLM provider interface for Ollama, OpenAI-compatible and mock backends."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Protocol, runtime_checkable

import httpx


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class LLMProvider(Protocol):
    """Minimal chat-completion interface every provider must implement."""

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str: ...


# ---------------------------------------------------------------------------
# Ollama provider
# ---------------------------------------------------------------------------

class OllamaProvider:
    """Calls the local Ollama HTTP API."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=10.0))

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        response = await self._client.post(
            f"{self.base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        body = response.json()
        return str(body.get("message", {}).get("content", ""))


# ---------------------------------------------------------------------------
# OpenAI-compatible provider (also works with OpenRouter & custom endpoints)
# ---------------------------------------------------------------------------

class OpenAIProvider:
    """Calls any OpenAI-compatible chat-completions endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        from openai import AsyncOpenAI  # lazily imported so mock works without it

        resolved_key = api_key or os.getenv("AGENT_STUDIO_API_KEY", "")
        resolved_url = base_url  # may be None — the SDK uses its default

        self._client = AsyncOpenAI(
            api_key=resolved_key or "unused",
            base_url=resolved_url,
        )

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str:
        response = await self._client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choice = response.choices[0] if response.choices else None
        return str(choice.message.content) if choice and choice.message.content else ""


# ---------------------------------------------------------------------------
# Mock provider (deterministic simulation)
# ---------------------------------------------------------------------------

class MockProvider:
    """Simulates LLM calls without any external service."""

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str:
        await asyncio.sleep(0.3)
        last_user = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"),
            "",
        )
        compact = " ".join(last_user.strip().split())
        if len(compact) > 260:
            compact = compact[:257] + "..."
        return f"[mock:{model}] {compact}"


# ---------------------------------------------------------------------------
# Provider factory
# ---------------------------------------------------------------------------

def get_provider(provider_id: str, model: dict[str, Any] | None = None) -> LLMProvider:
    """Return the appropriate provider based on *provider_id*.

    Supported provider IDs: ``ollama``, ``openai``, ``openrouter``, ``mock``.
    ``openrouter`` is treated as an OpenAI-compatible provider with
    ``base_url`` pointing to OpenRouter's API.
    """
    if provider_id == "mock":
        return MockProvider()

    if provider_id == "ollama":
        base_url = model.get("baseUrl") if model else None
        return OllamaProvider(base_url=base_url)

    # openai, openrouter, and any custom OpenAI-compatible endpoint
    base_url = None
    api_key = None

    if model:
        base_url = model.get("baseUrl")  # type: ignore[assignment]
    elif provider_id == "openrouter":
        base_url = "https://openrouter.ai/api/v1"

    # API key resolution: model-specific env → generic env → empty
    if provider_id == "openrouter":
        api_key = (
            os.getenv("AGENT_STUDIO_OPENROUTER_API_KEY")
            or os.getenv("OPENROUTER_API_KEY")
            or os.getenv("AGENT_STUDIO_API_KEY")
            or ""
        )
    elif provider_id == "openai":
        api_key = (
            os.getenv("AGENT_STUDIO_OPENAI_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("AGENT_STUDIO_API_KEY")
            or ""
        )
    else:
        api_key_env = str(model.get("apiKeyEnv") or "") if model else ""
        api_key = (os.getenv(api_key_env) if api_key_env else "") or os.getenv("AGENT_STUDIO_API_KEY") or ""

    return OpenAIProvider(api_key=api_key, base_url=base_url)
