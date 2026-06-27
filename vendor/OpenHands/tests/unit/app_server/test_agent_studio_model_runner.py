import pytest

from openhands.app_server.agent_studio.model_runner import (
    AgentModelRunner,
    api_key_for_provider,
    chat_completions_url,
)
from openhands.app_server.agent_studio.models import (
    AgentDefinition,
    AgentModel,
    ModelKind,
    ModelRequirements,
)


def test_chat_completions_url_appends_endpoint() -> None:
    assert (
        chat_completions_url('https://example.test/v1', 'custom')
        == 'https://example.test/v1/chat/completions'
    )


def test_chat_completions_url_preserves_full_endpoint() -> None:
    assert (
        chat_completions_url(
            'https://example.test/v1/chat/completions',
            'custom',
        )
        == 'https://example.test/v1/chat/completions'
    )


def test_api_key_for_provider_prefers_agent_studio_key(monkeypatch) -> None:
    monkeypatch.setenv('OPENROUTER_API_KEY', 'generic-openrouter-key')
    monkeypatch.setenv('AGENT_STUDIO_OPENROUTER_API_KEY', 'agent-studio-key')

    assert api_key_for_provider('openrouter') == 'agent-studio-key'


@pytest.mark.asyncio
async def test_mock_mode_returns_simulated_result() -> None:
    runner = AgentModelRunner(mode='mock')
    agent = AgentDefinition(
        id='generator',
        name='Generator',
        enabled=True,
        order=1,
        modelId='mock-model',
        systemPrompt='Generate a concise answer.',
    )
    model = AgentModel(
        id='mock-model',
        name='mock-model',
        provider='mock',
        kind=ModelKind.none,
        requirements=ModelRequirements(ramGb=0, diskGb=0),
    )

    result = await runner.run_step(
        agent=agent,
        model=model,
        original_task='Write a plan.',
        input_text='Write a plan.',
    )

    assert result.used_live_model is False
    assert result.output == '[Generator] Write a plan.'
