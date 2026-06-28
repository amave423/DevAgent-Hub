# DevAgent Hub

Собственный веб-интерфейс для управления AI-агентами и рабочим окружением разработки.

IDE-панель с мультиагентной цепочкой (Generator, Critic, Optimizer, Tester, Finalizer), встроенным редактором кода через OpenVSCode Server, терминалом xterm.js, preview, GitHub-автоматизацией, потоковыми логами и настройками моделей.

## Ключевые возможности

- **Chat** — постановка задач мультиагентной цепочке с визуализацией прогресса каждого агента
- **Agents** — настройка цепочки: порядок, системные промпты, модель для каждого агента
- **Code** — OpenVSCode Server (установка/запуск/остановка через бэкенд, iframe-встраивание)
- **Terminal** — полноценный xterm.js-терминал через WebSocket PTY
- **Preview** — встроенный просмотр локальных веб-приложений
- **GitHub** — создание репозиториев, коммиты, пуши, pull request через API
- **Logs** — потоковые логи выполнения агентов в реальном времени
- **Settings** — выбор языка RU/EN, назначения моделей по задачам, runner mode, URL интеграций

## Требования

- **Node.js 22.12+** — для фронтенда
- **Python 3.12+** — для бэкенда
- **Git** — для workspace-операций
- **Docker** (опционально) — для контейнерного запуска

## Быстрый старт (Windows PowerShell)

```powershell
# 1. Установить Node-зависимости
npm install

# 2. Установить Python-зависимости бэкенда
pip install -r services/agent-api/requirements.txt

# 3. Запустить бэкенд (в отдельном терминале)
npm run start:api

# 4. Запустить фронтенд (в отдельном терминале)
npm run dev:web

# 5. Открыть в браузере
Start-Process http://127.0.0.1:5173
```

## Быстрый старт (Linux/macOS)

```bash
# 1. Установить Node-зависимости
npm install

# 2. Установить Python-зависимости бэкенда
pip install -r services/agent-api/requirements.txt

# 3. Запустить бэкенд (в отдельном терминале)
npm run start:api

# 4. Запустить фронтенд (в отдельном терминале)
npm run dev:web

# 5. Открыть в браузере
xdg-open http://127.0.0.1:5173   # Linux
open http://127.0.0.1:5173       # macOS
```

## Docker-запуск

```powershell
docker-compose up --build
```

Фронтенд будет доступен на `http://localhost:5173`, API на `http://localhost:8000`.

## Проверки

```powershell
npm run typecheck        # TypeScript проверка
npm run build:web        # Production сборка
npm run verify           # Все проверки (installer + typecheck + API smoke)
npm run smoke:api        # Бэкенд smoke-тест
```

## Архитектура

```
apps/web/                    Фронтенд (React + TypeScript + Vite)
  src/
    App.tsx                  Главный layout, sidebar, маршрутизация по вкладкам
    i18n/                    Локализация RU/EN
    hooks/                   React-хуки (useAgents, useWorkspace)
    panels/                  8 панелей (Chat, Agents, Code, Terminal, Preview, GitHub, Logs, Settings)
    components/              UI-компоненты (Terminal, StatusPill, ProgressBar, ...)
    api/                     API-клиенты (agents, workspace, terminal)
    types.ts                 Общие типы данных
    styles.css               Глобальные стили

services/agent-api/          Бэкенд (FastAPI + Python 3.12)
  app/
    main.py                  Все HTTP и WebSocket endpoints
    models.py                Pydantic-модели запросов/ответов
    config_store.py          Чтение/запись configs/agents.json
    llm.py                   Единый интерфейс LLM (Ollama, OpenAI, OpenRouter, Mock)
    task_runner.py           Мультиагентная цепочка с реальными LLM-вызовами
    terminal.py              PTY-терминал через WebSocket
    workspace_service.py     Git, OpenVSCode, GitHub API
  requirements.txt           Python-зависимости

configs/agents.json          Конфигурация моделей и агентов
installer/                   Terminal-first CLI + опциональный Electron-лаунчер
scripts/                     Smoke-тесты и утилиты
```

## API Endpoints

| Endpoint | Метод | Описание |
|---|---|---|
| `/health` | GET | Проверка здоровья |
| `/api/agents/config` | GET | Получить конфигурацию агентов |
| `/api/agents/config` | POST | Сохранить конфигурацию |
| `/api/agents/run` | POST | Запустить цепочку агентов |
| `/api/agents/status/{id}` | GET | Статус задачи |
| `/api/agents/cancel/{id}` | POST | Отменить задачу |
| `/api/agents/logs/{id}` | GET | SSE-поток логов |
| `/api/terminal/ws` | WebSocket | PTY-терминал |
| `/api/workspace/status` | GET | Статус workspace |
| `/api/workspace/files` | GET | Список файлов |
| `/api/workspace/files/content` | GET | Содержимое файла |
| `/api/workspace/openvscode/start` | POST | Запустить OpenVSCode |
| `/api/workspace/openvscode/stop` | POST | Остановить OpenVSCode |
| `/api/workspace/openvscode/install` | POST | Установить OpenVSCode |
| `/api/workspace/git/remote` | POST | Настроить remote |
| `/api/workspace/git/commit` | POST | Создать коммит |
| `/api/workspace/git/push` | POST | Запушить ветку |
| `/api/workspace/github/repos` | POST | Создать репозиторий |
| `/api/workspace/github/pull-request` | POST | Создать PR |

## Переменные окружения

| Переменная | Описание |
|---|---|
| `AGENT_CONFIG_PATH` | Путь к agents.json (default: `configs/agents.json`) |
| `DEVAGENT_WORKSPACE` | Корневая папка workspace (default: корень репозитория) |
| `GITHUB_TOKEN` / `GH_TOKEN` | Токен GitHub для автоматизации |
| `OPENVSCODE_URL` | URL внешнего OpenVSCode Server |
| `OPENVSCODE_COMMAND` | Команда для запуска OpenVSCode Server |
| `AGENT_STUDIO_API_KEY` | API-ключ для OpenAI/OpenRouter |
| `AGENT_STUDIO_OPENAI_API_KEY` | Отдельный ключ для OpenAI |
| `AGENT_STUDIO_OPENROUTER_API_KEY` | Отдельный ключ для OpenRouter |
| `OLLAMA_BASE_URL` | URL Ollama (default: `http://localhost:11434`) |
| `DEVAGENT_ALLOW_EXTERNAL_WORKSPACE` | `1` чтобы разрешить workspace вне корня |

## Runtime Modes

- `auto` — пробовать реальные вызовы, fallback на mock при ошибках
- `live` — только реальные вызовы моделей
- `mock` — детерминированная симуляция

Устанавливается через UI (Settings → Runtime) или env:

```powershell
$env:AGENT_STUDIO_RUNNER_MODE = "auto"
```

## Горячие клавиши

- `Ctrl+Enter` — запустить цепочку агентов (в поле ввода задачи)
- `Ctrl+S` — сохранить настройки

## Установщик

Terminal-first CLI для Ubuntu/Debian серверов:

```bash
./install.sh
```

Опциональный Electron-лаунчер:

```powershell
npm run dev:installer
npm run dist:installer:win
npm run dist:installer:linux
```
