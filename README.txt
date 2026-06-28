DevAgent Hub

Собственный веб-интерфейс для управления AI-агентами и рабочим окружением разработки.

Проект больше не строит основной UI поверх OpenHands. Вместо этого создается отдельная IDE-панель с агентами, OpenVSCode Server, терминалом, preview, GitHub-автоматизацией, логами и настройками моделей.

Ключевые возможности:

- Chat для постановки задач мультиагентной цепочке.
- Agents для настройки Generator, Critic, Optimizer, Tester и Finalizer.
- Code на базе OpenVSCode Server.
- Terminal и Preview для разработки и проверки приложений.
- GitHub: создание репозитория, commit, push и pull request.
- Settings: выбор языка RU/EN, модели по назначению, скачивание локальных моделей, cloud API, runner mode, URL интеграций.
- Terminal-first установщик для Linux/Windows; Electron только optional launcher.

Локальная проверка:

1. Установить зависимости: `npm install`
2. Запустить backend: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --app-dir services\agent-api`
3. Запустить web: `npm --workspace apps/web run dev -- --host 127.0.0.1`
4. Открыть `http://127.0.0.1:5173/`

Проверки:

- `npm run typecheck`
- `npm run build:web`
- `npm run verify`

Текущий статус:

- UI-панель уже реализована в `apps/web`.
- Backend агентов работает через `services/agent-api`.
- OpenVSCode Server устанавливается и запускается через вкладку Code или может подключаться внешним URL.
- GitHub, terminal transport и model manager работают через backend endpoints.
