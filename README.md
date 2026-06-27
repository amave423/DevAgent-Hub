# AI Agent Studio

Стартовая реализация кастомного интерфейса управления AI-агентами для форка OpenHands.

## Что уже заложено

- `services/agent-api` — FastAPI-сервис с контрактами `/api/agents/*`.
- `apps/web` — React/TypeScript интерфейс управления цепочкой агентов, моделями, задачами и логами.
- `installer` — каркас Electron GUI-установщика для Windows/Linux.
- `configs/agents.json` — единый конфиг агентов и моделей.
- `docker-compose.yml` — локальный запуск API и веб-интерфейса.

## Локальный запуск

1. Установить зависимости фронтенда:

```bash
npm install
```

2. Подготовить Python окружение для API:

```bash
cd services/agent-api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ../..
```

3. Запустить API:

```bash
npm run start:api
```

4. В другом терминале запустить веб-интерфейс:

```bash
npm run dev:web
```

По умолчанию веб-интерфейс будет доступен на `http://localhost:5173`, API — на `http://localhost:8000`.

## Интеграция с форком OpenHands

Текущий репозиторий содержит самостоятельный слой AI Agent Studio. Когда в workspace будет добавлен форк OpenHands, этот слой можно встраивать так:

- перенести React-компоненты из `apps/web/src/components/agents` в `frontend/src/components/`;
- подключить `AgentPanel`, `ThinkingDisplay` и клиент `src/api/agents.ts` к существующему Chat/Settings;
- добавить FastAPI router из `services/agent-api/app` в backend OpenHands или оставить его отдельным сервисом и проксировать `/api/agents`;
- заменить имитационный раннер в `task_runner.py` вызовом реального `agent_system.py`.

## Agent Studio live runtime

OpenHands integration in `vendor/OpenHands/openhands/app_server/agent_studio` supports three runner modes:

- `auto` - try a live model and fall back to the simulated runner when credentials or a local model are unavailable.
- `live` - require a live model call and fail the task on provider errors.
- `mock` - use the simulated runner only.

The mode can be changed in `/settings/multi-agents` or by setting `AGENT_STUDIO_RUNNER_MODE`.

API keys are read from environment variables and are not stored in `agents.json`:

```powershell
$env:OPENAI_API_KEY = "..."
$env:OPENROUTER_API_KEY = "..."
$env:DEEPSEEK_API_KEY = "..."
```

Provider-specific Agent Studio keys also work:

```powershell
$env:AGENT_STUDIO_OPENAI_API_KEY = "..."
$env:AGENT_STUDIO_OPENROUTER_API_KEY = "..."
```

Ollama uses `http://localhost:11434` by default and does not need an API key.
