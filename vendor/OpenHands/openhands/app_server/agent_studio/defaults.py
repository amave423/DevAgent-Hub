from __future__ import annotations


DEFAULT_AGENT_STUDIO_CONFIG = {
    'version': 1,
    'models': [
        {
            'id': 'ollama-qwen25-coder-7b',
            'name': 'qwen2.5-coder:7b',
            'provider': 'ollama',
            'kind': 'local',
            'baseUrl': 'http://localhost:11434',
            'description': 'Хороший баланс скорости и качества для тестовых задач.',
            'requirements': {'ramGb': 8, 'diskGb': 5},
        },
        {
            'id': 'ollama-deepseek-coder-67b',
            'name': 'deepseek-coder:6.7b',
            'provider': 'ollama',
            'kind': 'local',
            'baseUrl': 'http://localhost:11434',
            'description': 'Сильная локальная модель для генерации кода.',
            'requirements': {'ramGb': 10, 'diskGb': 6},
        },
        {
            'id': 'ollama-deepseek-coder-33b',
            'name': 'deepseek-coder:33b',
            'provider': 'ollama',
            'kind': 'local',
            'baseUrl': 'http://localhost:11434',
            'description': 'Максимальное качество среди локальных вариантов.',
            'requirements': {'ramGb': 24, 'diskGb': 20},
        },
        {
            'id': 'ollama-llama32-3b',
            'name': 'llama3.2:3b',
            'provider': 'ollama',
            'kind': 'local',
            'baseUrl': 'http://localhost:11434',
            'description': 'Быстрая локальная модель для коротких задач.',
            'requirements': {'ramGb': 4, 'diskGb': 3},
        },
        {
            'id': 'openrouter-auto',
            'name': 'openrouter/auto',
            'provider': 'openrouter',
            'kind': 'cloud',
            'baseUrl': 'https://openrouter.ai/api/v1',
            'description': 'Облачный маршрутизатор моделей для резервного доступа.',
            'requirements': {'ramGb': 1, 'diskGb': 1},
        },
        {
            'id': 'openai-gpt-4o-mini',
            'name': 'gpt-4o-mini',
            'provider': 'openai',
            'kind': 'cloud',
            'baseUrl': 'https://api.openai.com/v1',
            'description': 'Облачная модель для быстрых агентских шагов.',
            'requirements': {'ramGb': 1, 'diskGb': 1},
        },
    ],
    'agents': [
        {
            'id': 'generator',
            'name': 'Generator',
            'enabled': True,
            'order': 1,
            'modelId': 'ollama-qwen25-coder-7b',
            'systemPrompt': (
                'Ты генерируешь первый рабочий вариант решения. '
                'Давай конкретный план и код без лишних отступлений.'
            ),
        },
        {
            'id': 'critic',
            'name': 'Critic',
            'enabled': True,
            'order': 2,
            'modelId': 'openrouter-auto',
            'systemPrompt': (
                'Ты ищешь дефекты, риски, несоответствия ТЗ и слабые места реализации.'
            ),
        },
        {
            'id': 'optimizer',
            'name': 'Optimizer',
            'enabled': True,
            'order': 3,
            'modelId': 'ollama-deepseek-coder-67b',
            'systemPrompt': (
                'Ты улучшаешь архитектуру и код, сохраняя поведение и уменьшая сложность.'
            ),
        },
        {
            'id': 'tester',
            'name': 'Tester',
            'enabled': True,
            'order': 4,
            'modelId': 'ollama-qwen25-coder-7b',
            'systemPrompt': 'Ты проверяешь результат, предлагаешь тесты и фиксируешь регрессии.',
        },
        {
            'id': 'finalizer',
            'name': 'Finalizer',
            'enabled': True,
            'order': 5,
            'modelId': 'openai-gpt-4o-mini',
            'systemPrompt': (
                'Ты собираешь финальный ответ, патч или инструкции в аккуратный итог.'
            ),
        },
    ],
    'runtime': {
        'maxParallelTasks': 2,
        'logRetention': 2000,
        'runnerMode': 'auto',
        'requestTimeoutSeconds': 120,
        'maxOutputChars': 12000,
    },
}
