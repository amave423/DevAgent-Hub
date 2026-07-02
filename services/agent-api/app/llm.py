"""Unified LLM provider interface for Ollama, OpenAI-compatible and mock backends."""

from __future__ import annotations

import asyncio
import os
import re
import asyncio
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
        request_url = f"{self.base_url}/api/chat"
        response = await self._client.post(request_url, json=payload)
        response.raise_for_status()
        body = parse_json_response(response, request_url, "ollama")
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
            requestUrl=request_url,
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
        api_format: str = "openai-chat-completions",
        endpoint_path: str | None = None,
    ) -> None:
        resolved_key = api_key or os.getenv("AGENT_STUDIO_API_KEY", "")
        self.base_url = (base_url or "").strip().rstrip("/")
        self.api_key = resolved_key
        self.provider_id = provider_id
        self.api_format = api_format or "openai-chat-completions"
        self.endpoint_path = endpoint_path
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=20.0))

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
        api_format = self._resolved_api_format(model)
        if api_format == "auto":
            return await self._auto_chat(model, messages, temperature, max_tokens, started)
        if api_format == "anthropic-messages":
            return await self._anthropic_messages(model, messages, temperature, max_tokens, started)
        if api_format == "openai-responses":
            return await self._openai_responses(model, messages, temperature, max_tokens, started)

        return await self._openai_chat_completions(model, messages, temperature, max_tokens, started)

    def _resolved_api_format(self, model: str) -> str:
        explicit = (self.api_format or "auto").strip() or "auto"
        if explicit != "custom-openai-path":
            return explicit
        return infer_format_from_url(self.base_url, self.endpoint_path) or "openai-chat-completions"

    async def _auto_chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        started: float,
    ) -> LLMCallResult:
        inferred = infer_format_from_url(self.base_url, self.endpoint_path)
        if inferred:
            attempts = [inferred]
        else:
            model_l = model.lower()
            provider_l = self.provider_id.lower()
            looks_anthropic = "claude" in model_l or "anthropic" in model_l or provider_l == "anthropic"
            looks_responses = model_l.startswith(("gpt-5", "o1", "o3", "o4"))
            if looks_anthropic:
                attempts = ["anthropic-messages", "openai-chat-completions", "openai-responses"]
            elif looks_responses:
                attempts = ["openai-responses", "openai-chat-completions", "anthropic-messages"]
            else:
                attempts = ["openai-chat-completions", "openai-responses", "anthropic-messages"]

        errors: list[str] = []
        for attempt in attempts:
            try:
                if attempt == "anthropic-messages":
                    return await self._anthropic_messages(model, messages, temperature, max_tokens, started, api_format="auto/anthropic-messages")
                if attempt == "openai-responses":
                    return await self._openai_responses(model, messages, temperature, max_tokens, started, api_format="auto/openai-responses")
                return await self._openai_chat_completions(model, messages, temperature, max_tokens, started, api_format="auto/openai-chat-completions")
            except Exception as exc:
                errors.append(f"{attempt}: {exc}")

        raise RuntimeError("All auto API format attempts failed. " + " | ".join(errors))

    async def _openai_chat_completions(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        started: float,
        api_format: str | None = None,
    ) -> LLMCallResult:
        format_name = api_format or self.api_format or "openai-chat-completions"
        request_url = build_request_url(self.base_url, self.endpoint_path, "/chat/completions")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = await self._post_json(
            request_url,
            headers=headers,
            payload={
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(format_provider_error(response, request_url, format_name))

        body = parse_json_response(response, request_url, format_name)
        choices = body.get("choices") if isinstance(body, dict) else []
        choice = choices[0] if isinstance(choices, list) and choices else {}
        message = choice.get("message") if isinstance(choice, dict) else {}
        content = ""
        if isinstance(message, dict):
            content = str(message.get("content") or "")
        elif isinstance(choice, dict):
            content = str(choice.get("text") or "")
        usage = usage_from_openai_response(body.get("usage") if isinstance(body, dict) else None)
        return LLMCallResult(
            text=content,
            provider=self.provider_id,
            requestedModel=model,
            resolvedModel=str(body.get("model") or model) if isinstance(body, dict) else model,
            baseUrl=self.base_url,
            requestUrl=request_url,
            usage=usage,
            finishReason=str(choice.get("finish_reason") or "") if isinstance(choice, dict) else None,
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=usage is not None,
        )

    async def _openai_responses(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        started: float,
        api_format: str | None = None,
    ) -> LLMCallResult:
        format_name = api_format or self.api_format or "openai-responses"
        request_url = build_request_url(self.base_url, self.endpoint_path, "/responses")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = await self._post_json(
            request_url,
            headers=headers,
            payload={
                "model": model,
                "input": messages_to_responses_input(messages),
                "temperature": temperature,
                "max_output_tokens": max_tokens,
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(format_provider_error(response, request_url, format_name))

        body = parse_json_response(response, request_url, format_name)
        usage = usage_from_responses_response(body.get("usage") if isinstance(body, dict) else None)
        return LLMCallResult(
            text=extract_response_text(body),
            provider=self.provider_id,
            requestedModel=model,
            resolvedModel=str(body.get("model") or model) if isinstance(body, dict) else model,
            baseUrl=self.base_url,
            requestUrl=request_url,
            usage=usage,
            finishReason=str(body.get("status") or body.get("finish_reason") or "") if isinstance(body, dict) else None,
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=usage is not None,
        )

    async def _anthropic_messages(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        started: float,
        api_format: str | None = None,
    ) -> LLMCallResult:
        format_name = api_format or self.api_format or "anthropic-messages"
        request_url = build_request_url(self.base_url, self.endpoint_path, "/v1/messages")
        system_parts = [message["content"] for message in messages if message.get("role") == "system"]
        chat_messages = [
            {
                "role": "assistant" if message.get("role") == "assistant" else "user",
                "content": message.get("content", ""),
            }
            for message in messages
            if message.get("role") != "system"
        ]
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        if self.api_key:
            headers["x-api-key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload: dict[str, Any] = {
            "model": model,
            "messages": chat_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        response = await self._post_json(request_url, headers=headers, payload=payload)
        if response.status_code >= 400:
            fallback_url = build_request_url(self.base_url, self.endpoint_path, "/messages")
            if not self.endpoint_path and fallback_url != request_url and response.status_code in {404, 405, 502}:
                response = await self._post_json(fallback_url, headers=headers, payload=payload)
                request_url = fallback_url
            if response.status_code >= 400:
                raise RuntimeError(format_provider_error(response, request_url, format_name))

        body = parse_json_response(response, request_url, format_name)
        content_blocks = body.get("content", []) if isinstance(body, dict) else []
        text_parts = [
            str(block.get("text") or "")
            for block in content_blocks
            if isinstance(block, dict) and (block.get("type") == "text" or block.get("text"))
        ]
        usage = anthropic_usage(body.get("usage") if isinstance(body, dict) else None)
        return LLMCallResult(
            text="\n".join(part for part in text_parts if part).strip(),
            provider=self.provider_id,
            requestedModel=model,
            resolvedModel=str(body.get("model") or model) if isinstance(body, dict) else model,
            baseUrl=self.base_url,
            requestUrl=request_url,
            usage=usage,
            finishReason=str(body.get("stop_reason") or "") if isinstance(body, dict) else None,
            latencyMs=round((time.perf_counter() - started) * 1000),
            rawUsageAvailable=usage is not None,
        )

    async def _post_json(self, url: str, *, headers: dict[str, str], payload: dict[str, Any]) -> httpx.Response:
        last_response: httpx.Response | None = None
        for attempt in range(3):
            response = await self._client.post(url, headers=headers, json=payload)
            last_response = response
            if response.status_code not in {429, 500, 502, 503, 504}:
                return response
            if attempt < 2:
                await asyncio.sleep(0.8 * (attempt + 1))
        return last_response


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

    api_format = str(model.get("apiFormat") or "") if model else ""
    endpoint_path = str(model.get("endpointPath") or "") if model else ""
    if not api_format:
        api_format = "auto"

    return OpenAIProvider(
        api_key=api_key,
        base_url=base_url,
        provider_id=provider_id,
        api_format=api_format,
        endpoint_path=endpoint_path or None,
    )


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


def usage_from_responses_response(raw_usage: Any) -> LLMUsage | None:
    if raw_usage is None:
        return None
    prompt = getattr(raw_usage, "input_tokens", None)
    completion = getattr(raw_usage, "output_tokens", None)
    total = getattr(raw_usage, "total_tokens", None)
    if isinstance(raw_usage, dict):
        prompt = raw_usage.get("input_tokens", raw_usage.get("prompt_tokens", prompt))
        completion = raw_usage.get("output_tokens", raw_usage.get("completion_tokens", completion))
        total = raw_usage.get("total_tokens", total)
    if prompt is None and completion is None and total is None:
        return None
    return LLMUsage(
        promptTokens=int(prompt) if prompt is not None else None,
        completionTokens=int(completion) if completion is not None else None,
        totalTokens=int(total) if total is not None else None,
    )


def anthropic_usage(raw_usage: Any) -> LLMUsage | None:
    if not isinstance(raw_usage, dict):
        return None
    prompt = raw_usage.get("input_tokens")
    completion = raw_usage.get("output_tokens")
    if prompt is None and completion is None:
        return None
    return LLMUsage(
        promptTokens=int(prompt) if prompt is not None else None,
        completionTokens=int(completion) if completion is not None else None,
        totalTokens=(int(prompt or 0) + int(completion or 0)),
    )


def messages_to_responses_input(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for message in messages:
        role = message.get("role") or "user"
        if role not in {"system", "user", "assistant", "developer"}:
            role = "user"
        result.append({"role": role, "content": message.get("content", "")})
    return result


def extract_response_text(body: dict[str, Any]) -> str:
    output_text = body.get("output_text")
    if isinstance(output_text, str):
        return output_text

    parts: list[str] = []
    output = body.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        text = block.get("text")
                        if isinstance(text, str):
                            parts.append(text)
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)

    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        choice = choices[0]
        if isinstance(choice, dict):
            message = choice.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                parts.append(message["content"])
            elif isinstance(choice.get("text"), str):
                parts.append(choice["text"])

    return "\n".join(part for part in parts if part).strip()


def infer_format_from_url(base_url: str | None, endpoint_path: str | None) -> str | None:
    text = f"{base_url or ''} {endpoint_path or ''}".lower()
    if "/responses" in text:
        return "openai-responses"
    if "/chat/completions" in text:
        return "openai-chat-completions"
    if "/messages" in text:
        return "anthropic-messages"
    return None


def build_request_url(base_url: str | None, endpoint_path: str | None, default_path: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        base = "https://api.openai.com/v1"
    path = (endpoint_path or "").strip()
    if path.startswith(("http://", "https://")):
        return path
    if not path:
        parsed = urlparse(base)
        if parsed.path.endswith(default_path) or parsed.path.endswith("/chat/completions") or parsed.path.endswith("/messages"):
            return base
        path = default_path
    if not path.startswith("/"):
        path = f"/{path}"
    parsed = urlparse(base)
    base_path = parsed.path.rstrip("/")
    # If the base path already ends with the same endpoint (e.g. base ends with
    # /chat/completions and path is /chat/completions), collapse to avoid
    # https://host/v1/chat/completions/chat/completions for reseller APIs.
    if base_path and (path == base_path or base_path.endswith(path)):
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return f"{origin}{base_path}"
    if base_path and path.startswith(f"{base_path}/"):
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return f"{origin}{path}"
    return f"{base}{path}"


def format_provider_error(response: httpx.Response, request_url: str, api_format: str) -> str:
    text = response.text[:3000]
    compact = " ".join(strip_html(text).split())
    if len(compact) > 600:
        compact = compact[:597] + "..."
    hint = "Check API format and endpoint path."
    if response.status_code in {429, 500, 502, 503, 504}:
        hint = "The endpoint is reachable, but the provider returned a temporary capacity/server error after retries. Retry later or check provider balance/limits."
    if response.status_code in {404, 405}:
        hint = "The endpoint path looks wrong for this API format. Check Base URL, API format and endpoint path."
    return (
        f"Provider request failed with HTTP {response.status_code} at {request_url}. "
        f"Format: {api_format}. {hint} Response: {compact or response.reason_phrase}"
    )


def parse_json_response(response: httpx.Response, request_url: str, api_format: str) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError as exc:
        text = " ".join(strip_html(response.text[:1200]).split())
        raise RuntimeError(
            f"Provider returned non-JSON response at {request_url}. "
            f"Format: {api_format}. Response: {text[:600]}"
        ) from exc
    if not isinstance(body, dict):
        raise RuntimeError(f"Provider returned unsupported JSON at {request_url}. Expected object.")
    return body


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


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
