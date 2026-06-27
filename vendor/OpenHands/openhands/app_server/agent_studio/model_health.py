from __future__ import annotations

from openhands.app_server.agent_studio.model_runner import api_key_for_provider
from openhands.app_server.agent_studio.models import (
    AgentModel,
    ModelHealth,
    ModelKind,
)


async def check_models_health(models: list[AgentModel]) -> list[ModelHealth]:
    ollama_cache: dict[str, tuple[set[str] | None, str | None]] = {}
    return [await check_model_health(model, ollama_cache) for model in models]


async def check_model_health(
    model: AgentModel,
    ollama_cache: dict[str, tuple[set[str] | None, str | None]] | None = None,
) -> ModelHealth:
    if model.kind == ModelKind.none:
        return ModelHealth(
            modelId=model.id,
            name=model.name,
            provider=model.provider,
            kind=model.kind,
            ok=True,
            status='available',
            message='No model required.',
        )

    if model.provider.lower().strip() == 'ollama':
        return await check_ollama_model(model, ollama_cache or {})

    if model.kind == ModelKind.cloud and not api_key_for_provider(model.provider):
        return ModelHealth(
            modelId=model.id,
            name=model.name,
            provider=model.provider,
            kind=model.kind,
            ok=False,
            status='missing_credentials',
            message=f'Missing API key for provider "{model.provider}".',
        )

    return ModelHealth(
        modelId=model.id,
        name=model.name,
        provider=model.provider,
        kind=model.kind,
        ok=True,
        status='available',
        message='Credentials configured.',
    )


async def check_ollama_model(
    model: AgentModel,
    ollama_cache: dict[str, tuple[set[str] | None, str | None]],
) -> ModelHealth:
    try:
        import httpx
    except ImportError:
        return ModelHealth(
            modelId=model.id,
            name=model.name,
            provider=model.provider,
            kind=model.kind,
            ok=False,
            status='unreachable',
            message='httpx is not installed; cannot check Ollama availability.',
        )

    base_url = (model.baseUrl or 'http://localhost:11434').rstrip('/')
    if base_url not in ollama_cache:
        try:
            timeout = httpx.Timeout(1.0, connect=0.5, read=1.0, write=1.0, pool=0.5)
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.get(f'{base_url}/api/tags')
                response.raise_for_status()
                data = response.json()
            ollama_cache[base_url] = (
                {
                    item.get('name')
                    for item in data.get('models', [])
                    if isinstance(item, dict)
                },
                None,
            )
        except Exception as exc:
            ollama_cache[base_url] = (None, str(exc))

    available_names, error = ollama_cache[base_url]
    if error is not None:
        return ModelHealth(
            modelId=model.id,
            name=model.name,
            provider=model.provider,
            kind=model.kind,
            ok=False,
            status='unreachable',
            message=f'Ollama is unreachable at {base_url}: {error}',
        )

    if model.name in (available_names or set()):
        return ModelHealth(
            modelId=model.id,
            name=model.name,
            provider=model.provider,
            kind=model.kind,
            ok=True,
            status='available',
            message='Ollama model is installed.',
        )

    return ModelHealth(
        modelId=model.id,
        name=model.name,
        provider=model.provider,
        kind=model.kind,
        ok=False,
        status='unknown',
        message=f'Ollama is reachable, but "{model.name}" is not installed.',
    )
