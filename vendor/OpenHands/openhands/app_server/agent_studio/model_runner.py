from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Literal

from openhands.app_server.agent_studio.models import (
    AgentDefinition,
    AgentModel,
    ModelKind,
)


RunnerMode = Literal['auto', 'live', 'mock']


class ModelRunnerError(RuntimeError):
    pass


class MissingModelCredentials(ModelRunnerError):
    pass


@dataclass(frozen=True)
class AgentStepResult:
    output: str
    provider: str
    model_name: str
    used_live_model: bool
    fallback_reason: str | None = None


class AgentModelRunner:
    def __init__(
        self,
        *,
        mode: RunnerMode = 'auto',
        timeout_seconds: int = 120,
        max_output_chars: int = 12000,
    ) -> None:
        env_mode = os.getenv('AGENT_STUDIO_RUNNER_MODE')
        self.mode: RunnerMode = normalize_runner_mode(env_mode or mode)
        self.timeout_seconds = timeout_seconds
        self.max_output_chars = max_output_chars

    async def run_step(
        self,
        *,
        agent: AgentDefinition,
        model: AgentModel,
        original_task: str,
        input_text: str,
    ) -> AgentStepResult:
        if self.mode == 'mock' or model.kind == ModelKind.none:
            return self._mock_result(agent, model, input_text)

        try:
            output = await self._run_live_model(
                agent=agent,
                model=model,
                original_task=original_task,
                input_text=input_text,
            )
            return AgentStepResult(
                output=trim_output(output, self.max_output_chars),
                provider=model.provider,
                model_name=model.name,
                used_live_model=True,
            )
        except Exception as exc:
            if self.mode == 'live':
                raise ModelRunnerError(str(exc)) from exc
            return self._mock_result(
                agent,
                model,
                input_text,
                fallback_reason=str(exc),
            )

    async def _run_live_model(
        self,
        *,
        agent: AgentDefinition,
        model: AgentModel,
        original_task: str,
        input_text: str,
    ) -> str:
        provider = model.provider.lower().strip()
        if provider == 'ollama':
            return await self._run_ollama(
                agent=agent,
                model=model,
                original_task=original_task,
                input_text=input_text,
            )

        return await self._run_openai_compatible(
            agent=agent,
            model=model,
            original_task=original_task,
            input_text=input_text,
        )

    async def _run_openai_compatible(
        self,
        *,
        agent: AgentDefinition,
        model: AgentModel,
        original_task: str,
        input_text: str,
    ) -> str:
        import httpx

        api_key = api_key_for_provider(model.provider)
        if model.kind == ModelKind.cloud and not api_key:
            raise MissingModelCredentials(
                f'Missing API key for provider "{model.provider}".'
            )

        url = chat_completions_url(model.baseUrl, model.provider)
        headers = build_headers(model.provider, api_key)
        payload = {
            'model': model.name,
            'messages': build_messages(agent, original_task, input_text),
            'temperature': 0.2,
            'stream': False,
        }

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        try:
            content = data['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelRunnerError('Unexpected OpenAI-compatible response shape.') from exc

        if not isinstance(content, str) or not content.strip():
            raise ModelRunnerError('Model returned an empty response.')
        return content

    async def _run_ollama(
        self,
        *,
        agent: AgentDefinition,
        model: AgentModel,
        original_task: str,
        input_text: str,
    ) -> str:
        import httpx

        base_url = (model.baseUrl or 'http://localhost:11434').rstrip('/')
        api_key = api_key_for_provider(model.provider, required=False)

        if base_url.endswith('/v1'):
            return await self._run_openai_compatible(
                agent=agent,
                model=model,
                original_task=original_task,
                input_text=input_text,
            )

        headers = build_headers(model.provider, api_key)
        payload = {
            'model': model.name,
            'messages': build_messages(agent, original_task, input_text),
            'stream': False,
        }

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f'{base_url}/api/chat',
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        content = data.get('message', {}).get('content')
        if not isinstance(content, str) or not content.strip():
            raise ModelRunnerError('Ollama returned an empty response.')
        return content

    def _mock_result(
        self,
        agent: AgentDefinition,
        model: AgentModel,
        input_text: str,
        fallback_reason: str | None = None,
    ) -> AgentStepResult:
        return AgentStepResult(
            output=build_simulated_output(agent, input_text),
            provider=model.provider,
            model_name=model.name,
            used_live_model=False,
            fallback_reason=fallback_reason,
        )


def normalize_runner_mode(value: str) -> RunnerMode:
    normalized = value.lower().strip()
    if normalized in {'auto', 'live', 'mock'}:
        return normalized  # type: ignore[return-value]
    return 'auto'


def build_messages(
    agent: AgentDefinition,
    original_task: str,
    input_text: str,
) -> list[dict[str, str]]:
    if input_text.strip() == original_task.strip():
        user_content = f'User task:\n{original_task}'
    else:
        user_content = (
            f'User task:\n{original_task}\n\n'
            f'Previous agent output:\n{input_text}\n\n'
            'Continue the multi-agent chain from this intermediate result.'
        )

    return [
        {'role': 'system', 'content': agent.systemPrompt},
        {'role': 'user', 'content': user_content},
    ]


def chat_completions_url(base_url: str | None, provider: str) -> str:
    base = base_url or default_base_url(provider)
    normalized = base.rstrip('/')
    if normalized.endswith('/chat/completions'):
        return normalized
    return f'{normalized}/chat/completions'


def default_base_url(provider: str) -> str:
    normalized = provider.lower().strip()
    if normalized == 'openrouter':
        return 'https://openrouter.ai/api/v1'
    if normalized == 'deepseek':
        return 'https://api.deepseek.com/v1'
    return 'https://api.openai.com/v1'


def build_headers(provider: str, api_key: str | None) -> dict[str, str]:
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    if provider.lower().strip() == 'openrouter':
        referer = os.getenv('AGENT_STUDIO_HTTP_REFERER')
        title = os.getenv('AGENT_STUDIO_APP_TITLE', 'DevAgent Hub')
        if referer:
            headers['HTTP-Referer'] = referer
        headers['X-Title'] = title

    return headers


def api_key_for_provider(provider: str, *, required: bool = True) -> str | None:
    normalized = normalize_provider_env_key(provider)
    candidates = [
        f'AGENT_STUDIO_{normalized}_API_KEY',
        f'{normalized}_API_KEY',
        'AGENT_STUDIO_API_KEY',
    ]

    for candidate in candidates:
        value = os.getenv(candidate)
        if value:
            return value

    if required:
        return None
    return None


def normalize_provider_env_key(provider: str) -> str:
    return re.sub(r'[^A-Z0-9]+', '_', provider.upper()).strip('_')


def build_simulated_output(agent: AgentDefinition, input_text: str) -> str:
    compact = ' '.join(input_text.strip().split())
    if len(compact) > 260:
        compact = compact[:257] + '...'
    return f'[{agent.name}] {compact}'


def trim_output(output: str, max_chars: int) -> str:
    if len(output) <= max_chars:
        return output
    return (
        output[: max_chars - 80].rstrip()
        + '\n\n[Agent Studio truncated output]'
    )
