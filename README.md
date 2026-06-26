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

