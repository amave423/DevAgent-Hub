"""Unified LLM provider interface for Ollama, OpenAI-compatible and mock backends."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlparse, urlunparse

import httpx

from .models import LLMCallResult, LLMUsage


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
    ) -> LLMCallResult: ...


class OllamaProvider:
    """Calls the local Ollama HTTP API."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = normalize_ollama_base_url(base_url or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"))
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=10.0),
            trust_env=False,
        )

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> LLMCallResult:
        started = time.perf_counter()
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        response = await self._client.post(f"{self.base_url}/api/chat", json=payload)
        response.raise_for_status()
        body = response.json()
        prompt_tokens = int(body.get("prompt_eval_count") or 0) or None
        completion_tokens = int(body.get("eval_count") or 0) or None
        total_tokens = (
            (prompt_tokens or 0) + (completion_tokens or 0)
            if prompt_tokens is not None or completion_tokens is not None
            else None
        )
        usage = None
        if total_tokens is not None:
            usage = LLMUsage(
                promptTokens=prompt_tokens,
                completionTokens=completion_tokens,
                totalTokens=total_tokens,
            )
        return LLMCallResult(
            text=str(body.get("message", {}).get("content", "")),
            provider="ollama",
            requestedModel=model,
            resolvedModel=str(body.get("model") or model),
            baseUrl=self.base_url,
            usage=usage,
            finishReason=str(body.get("done_reason") or "") or None,
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=usage is not None,
        )


class OpenAIProvider:
    """Calls any OpenAI-compatible chat-completions endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        provider_id: str = "openai-compatible",
    ) -> None:
        from openai import AsyncOpenAI

        resolved_key = api_key or os.getenv("AGENT_STUDIO_API_KEY", "")
        self.base_url = base_url
        self.provider_id = provider_id
        self._client = AsyncOpenAI(
            api_key=resolved_key or "unused",
            base_url=base_url,
        )

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> LLMCallResult:
        started = time.perf_counter()
        response = await self._client.chat.completions.create(
            model=model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        )
        choice = response.choices[0] if response.choices else None
        usage = usage_from_openai_response(getattr(response, "usage", None))
        return LLMCallResult(
            text=str(choice.message.content) if choice and choice.message.content else "",
            provider=self.provider_id,
            requestedModel=model,
            resolvedModel=str(getattr(response, "model", "") or model),
            baseUrl=self.base_url,
            usage=usage,
            finishReason=str(getattr(choice, "finish_reason", "") or "") if choice else None,
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=usage is not None,
        )


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
    ) -> LLMCallResult:
        started = time.perf_counter()
        await asyncio.sleep(0.3)
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        compact = " ".join(last_user.strip().split())
        if len(compact) > 260:
            compact = compact[:257] + "..."
        return LLMCallResult(
            text=f"[mock:{model}] {compact}",
            provider="mock",
            requestedModel=model,
            resolvedModel=model,
            usage=None,
            finishReason="mock",
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=False,
        )


def get_provider(provider_id: str, model: dict[str, Any] | None = None) -> LLMProvider:
    if provider_id == "mock":
        return MockProvider()

    if provider_id == "ollama":
        base_url = model.get("baseUrl") if model else None
        return OllamaProvider(base_url=base_url)

    base_url = None
    api_key = None

    if model:
        base_url = model.get("baseUrl")  # type: ignore[assignment]
    elif provider_id == "openrouter":
        base_url = "https://openrouter.ai/api/v1"

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

    return OpenAIProvider(api_key=api_key, base_url=base_url, provider_id=provider_id)


def usage_from_openai_response(raw_usage: Any) -> LLMUsage | None:
    if raw_usage is None:
        return None
    prompt = getattr(raw_usage, "prompt_tokens", None)
    completion = getattr(raw_usage, "completion_tokens", None)
    total = getattr(raw_usage, "total_tokens", None)
    if isinstance(raw_usage, dict):
        prompt = raw_usage.get("prompt_tokens", prompt)
        completion = raw_usage.get("completion_tokens", completion)
        total = raw_usage.get("total_tokens", total)
    if prompt is None and completion is None and total is None:
        return None
    return LLMUsage(
        promptTokens=int(prompt) if prompt is not None else None,
        completionTokens=int(completion) if completion is not None else None,
        totalTokens=int(total) if total is not None else None,
    )


def normalize_ollama_base_url(raw_url: str) -> str:
    """Keep Ollama on loopback and outside system proxy routing."""
    cleaned = raw_url.strip() or "http://127.0.0.1:11434"
    parsed = urlparse(cleaned)
    if parsed.hostname == "localhost":
        netloc = "127.0.0.1"
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        cleaned = urlunparse(parsed._replace(netloc=netloc))
    return cleaned.rstrip("/")
