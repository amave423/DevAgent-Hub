# План: DevAgent Hub — полный переезд на свой стек

## Цель
Переписать весь проект с нуля: убрать зависимость от OpenHands, создать полноценный IDE-подобный веб-интерфейс с реальными LLM-вызовами, управлением OpenVSCode Server через бэкенд, отдельным xterm.js-терминалом и GitHub-автоматизацией.

---

## 1. Бэкенд: реальные LLM-вызовы (`services/agent-api`)

### 1.1. LLM-провайдеры
Создать `app/llm.py` —统一ный интерфейс для вызова моделей:
- **Ollama** — HTTP-запросы к `http://localhost:11434/api/chat`
- **OpenAI** — через `openai` Python SDK (совместим с OpenRouter и любым OpenAI-compatible API)
- **Mock** — текущая симуляция, оставить как fallback

```python
class LLMProvider(Protocol):
    async def chat(self, model: str, messages: list[dict], **kwargs) -> str: ...
```

Фабрика `get_provider(provider_id)` — по provider из agents.json выбирает реализацию.

### 1.2. Обновить `task_runner.py`
- Каждый агент делает реальный LLM-вызов через `LLMProvider`
- Промпт = systemPrompt агента + результат предыдущего агента (или задача пользователя)
- Ответ каждого агента передаётся следующему как контекст
- Логировать: начало вызова, duration, кол-во токенов (если доступно), результат/ошибку
- При `runnerMode=mock` — использовать текущую симуляцию

### 1.3. Зависимости
Добавить в `requirements.txt`:
- `openai>=1.0` — для OpenAI/OpenRouter/custom endpoints
- `httpx>=0.27` — async HTTP для Ollama (вместо urllib)
- `websockets>=12.0` — для терминального WebSocket

### 1.4. Отмена задач
Добавить `POST /api/agents/cancel/{task_id}` — устанавливает флаг отмены, воркер проверяет его между шагами.

---

## 2. Бэкенд: Terminal WebSocket (`services/agent-api`)

### 2.1. WebSocket endpoint
```
WS /api/terminal/ws
```
- Подключение запускает PTY-процесс (через `pty` на Linux, `winpty`/`conpty` на Windows)
- Ввод/вывод передаётся через WebSocket как JSON-фреймы: `{"type":"input","data":"..."}`, `{"type":"output","data":"..."}`
- Размер терминала: `{"type":"resize","cols":80,"rows":24}`

### 2.2. Новые файлы
- `app/terminal.py` — `TerminalManager` с lifecycle PTY-процессов
- Использовать `python-pty` / встроенный `pty` модуль (Linux), `pywinpty` (Windows)

### 2.3. Ограничения
- Рабочая директория = workspace root (`DEVAGENT_WORKSPACE`)
- Одна сессия на пользователя (пока)
- Kill процесса при отключении WebSocket

---

## 3. Бэкенд: Улучшения OpenVSCode Server

### 3.1. Установка из бэкенда
Добавить `POST /api/workspace/openvscode/install`:
- Скачивает release OpenVSCode Server (или code-server) в `.tools/`
- Распаковывает, делает исполняемым
- Возвращает статус

### 3.2. Health-check polling
- При старте: опрашивать `http://host:port/healthz` до готовности (макс 30с)
- Status endpoint показывает не просто "running", но и "ready"

---

## 4. Фронтенд: полный рефакторинг (`apps/web`)

### 4.1. Разделить App.tsx на модули
Текущий App.tsx — 1240 строк в одном файле. Разбить:

```
src/
├── App.tsx                 — shell, layout, routing
├── i18n/
│   ├── index.ts            — t() функция, язык, копии
│   ├── ru.ts               — русские строки
│   └── en.ts               — английские строки
├── hooks/
│   ├── useAgents.ts        — загрузка/сохранение конфига, запуск цепочки
│   ├── useWorkspace.ts     — workspace status, OpenVSCode, git
│   └── useTerminal.ts      — WebSocket-соединение с PTY
├── panels/
│   ├── ChatPanel.tsx
│   ├── AgentsPanel.tsx
│   ├── CodePanel.tsx
│   ├── TerminalPanel.tsx
│   ├── PreviewPanel.tsx
│   ├── GithubPanel.tsx
│   ├── LogsPanel.tsx
│   └── SettingsPanel.tsx
├── components/
│   ├── AgentCard.tsx
│   ├── AgentConfigModal.tsx
│   ├── ConversationMessage.tsx
│   ├── IntegrationCard.tsx
│   ├── PanelHeader.tsx
│   ├── ProgressBar.tsx
│   ├── StatusPill.tsx
│   └── Terminal.tsx         — xterm.js обёртка
├── api/
│   ├── agents.ts            — агентные API-вызовы
│   ├── workspace.ts         — workspace/git/github API-вызовы
│   └── terminal.ts          — WebSocket-подключение к PTY
├── types.ts
├── styles.css
├── main.tsx
└── vite-env.d.ts
```

### 4.2. xterm.js терминал
- Пакет: `xterm` + `xterm-addon-fit` + `xterm-addon-web-links`
- Компонент `<Terminal>` подключается к `ws://host:8000/api/terminal/ws`
- Resize позволяет менять размер
- Копирование/вставка работают из коробки

### 4.3. GitHub вкладка — доработать
- Форма для Pull Request (title, body, head, base)
- Diff-просмотр перед push (вызов `git diff` через workspace API)
- Кнопка "Init git" если workspace ещё не репозиторий
- Уведомления об успешных/ошибочных действиях (inline, не alert)

### 4.4. Chat — улучшить UX
- Показывать ход выполнения каждого агента в реальном времени (не только итоговый результат)
- Визуализация цепочки: шаги с иконками и статусами
- Вывод Markdown (добавить `react-markdown` + `remark-gfm`)
- Возможность прервать выполнение (cancel button)

### 4.5. Новые фичи
- **File Explorer** — дерево файлов workspace через API (`GET /api/workspace/files?path=...`)
- **Keyboard shortcuts** — Ctrl+Enter для запуска, Ctrl+S для сохранения
- **Drag & drop** агентов — вместо кнопок ↑/↓

---

## 5. Удаление OpenHands

- Удалить `vendor/OpenHands/`
- Удалить `scripts/smoke_agent_studio.py` и `scripts/smoke_openhands_app.py`
- Обновить `scripts/run_python_script.js` — убрать пути к vendor venv
- Обновить `docker-compose.yml` — убрать зависимость ��т OpenHands
- Обновить `install.sh` / `installer/` — убрать шаги сборки OpenHands
- Почистить `.gitignore`

---

## 6. Новые API endpoints (итого)

| Endpoint | Method | Описание |
|---|---|---|
| `POST /api/agents/cancel/{task_id}` | POST | Отменить задачу |
| `WS /api/terminal/ws` | WS | PTY-терминал |
| `GET /api/workspace/files` | GET | Список файлов в workspace |
| `GET /api/workspace/files/content` | GET | Содержимое файла |
| `POST /api/workspace/openvscode/install` | POST | Скачать и установить OpenVSCode Server |
| `POST /api/workspace/github/pull-request` | POST | Создать PR (уже есть модель, добавить route) |

---

## Порядок реализации

1. **Бэкенд LLM** — `app/llm.py`, обновить `task_runner.py`, обновить `requirements.txt`
2. **Бэкенд Terminal** — `app/terminal.py`, WebSocket endpoint
3. **Бэкенд Workspace** — file listing API, OpenVSCode install endpoint, PR endpoint, cancel endpoint
4. **Фронтенд рефакторинг** — разбить App.tsx, вынести i18n, hooks, panels
5. **Фронтенд Terminal** — xterm.js компонент и подключение
6. **Фронтенд улучшения** — markdown в чате, визуализация цепочки, GitHub PR форма, file explorer
7. **Удаление OpenHands** — чистка vendor, скриптов, docker-compose
8. **Обновление инсталлера** — убрать шаги OpenHands
9. **Smoke-тесты** — обновить и дописать

---

## Риски и компромиссы

- **PTY на Windows**: `pywinpty` — работает, но менее стабильна чем Linux pty. На Windows в первом релизе можно использовать встроенный терминал OpenVSCode как fallback.
- **LLM latency**: Реальные вызовы могут быть медленными. Важно показать progress и дать пользователю возможность отменить.
- **Размер фронтенда**: Добавится xterm.js (~200KB gzipped) и react-markdown (~30KB). Приемлемо для IDE-подобного приложения.
