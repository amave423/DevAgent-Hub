import type { AppLanguage, WorkbenchTab } from "../types";

export interface PageInfoSection {
  title: string;
  items: string[];
}

export interface PageInfoContent {
  title: string;
  intro: string;
  sections: PageInfoSection[];
}

const ruInfo: Record<WorkbenchTab, PageInfoContent> = {
  chat: {
    title: "Информация о чате",
    intro: "Чат - основной экран для постановки задач агентам, просмотра ответов, вложений и хода выполнения.",
    sections: [
      { title: "Что вводить", items: ["В поле ввода напиши задачу, вопрос или просьбу изменить проект.", "Кнопка вложений добавляет файлы к следующему сообщению.", "Кнопка \"Браузер\" разрешает backend открыть URL, найти страницы через Chromium, прочитать их текст и добавить этот контекст модели."] },
      { title: "Режимы", items: ["Планирование просит агента сначала разобрать задачу и предложить шаги.", "Кодинг предназначен для выполнения изменений в workspace с учетом политики подтверждений."] },
      { title: "Ошибки", items: ["Если браузер недоступен, перезапусти установщик, чтобы поставить Playwright/Chromium.", "Если модель недоступна, чат покажет реальную ошибку API без тихого fallback."] },
    ],
  },
  agents: {
    title: "Информация об агентах",
    intro: "Здесь создаются произвольные агенты, выбираются модели и задаются инструкции.",
    sections: [
      { title: "Поля агента", items: ["Название видно в ходе выполнения и логах.", "Модель определяет, какой локальный или облачный backend будет отвечать.", "Инструкция задает роль агента; кнопку \"Без инструкции\" можно использовать для базового поведения."] },
      { title: "Порядок", items: ["Агенты выполняются сверху вниз.", "Выключенный агент не участвует в новых задачах."] },
    ],
  },
  browser: {
    title: "Информация о браузере",
    intro: "Вкладка управляет headless Chromium, который DevAgent Hub использует для открытия сайтов, чтения страниц, скриншотов и скачивания файлов.",
    sections: [
      { title: "Что вводить", items: ["URL сайта или файла: https://example.com, https://site.com/file.pdf.", "Кнопка открытия читает видимый текст страницы и собирает ссылки.", "Скриншот сохраняет PNG в .devagent/browser/screenshots.", "Скачивание сохраняет файл в .devagent/browser/downloads."] },
      { title: "Как это использует модель", items: ["В чате включи кнопку браузера, чтобы backend открыл URL из задачи.", "Если URL не указан, backend выполнит поиск через Chromium, откроет первые найденные страницы и добавит их текст в контекст модели.", "На этом этапе браузер работает через backend tool, а не через визуальное окно пользователя."] },
      { title: "Ошибки", items: ["Если Playwright или Chromium не установлены, перезапусти установщик.", "Некоторые сайты блокируют автоматизированный браузер или требуют логин/капчу."] },
    ],
  },
  code: {
    title: "Информация о редакторе кода",
    intro: "Вкладка встраивает OpenVSCode/code-server через same-origin адрес /ide/.",
    sections: [
      { title: "Для чего", items: ["Открывать и редактировать файлы проекта в браузере.", "Проверять изменения, которые сделал агент в режиме кодинга."] },
      { title: "Если не открылся", items: ["Нажми установку редактора или перезапусти сервис после установки.", "На Ubuntu используется prebuilt code-server, чтобы не собирать native-модули через npm."] },
    ],
  },
  terminal: {
    title: "Информация о терминале",
    intro: "Терминал подключается к backend PTY и работает в рабочей папке проекта.",
    sections: [
      { title: "Что вводить", items: ["Обычные команды shell: npm, git, python, ls/dir и другие.", "Команды выполняются на машине, где запущен DevAgent Hub."] },
      { title: "Безопасность", items: ["В режиме подтверждений действия агента через терминал должны ожидать approve/reject.", "Не запускай команды, смысл которых не понимаешь."] },
    ],
  },
  preview: {
    title: "Информация о просмотре",
    intro: "Вкладка показывает локальное приложение или любой URL, который нужно проверить.",
    sections: [
      { title: "Поля", items: ["URL просмотра - адрес dev server или страницы, которую нужно открыть в iframe.", "Кнопка внешнего открытия открывает этот же URL в новой вкладке браузера."] },
      { title: "Ограничения", items: ["Некоторые сайты запрещают iframe через security headers.", "Для локальных приложений убедись, что dev server запущен и слушает доступный host/port."] },
    ],
  },
  github: {
    title: "Информация о GitHub",
    intro: "GitHub-вкладка связывает workspace с GitHub: токен, репозитории, коммиты, push и pull request.",
    sections: [
      { title: "Токен", items: ["Вставь fine-grained PAT или классический token с правами на нужный repo.", "Токен хранится вне git и не возвращается обратно в UI.", "Кнопка проверки вызывает GitHub /user и показывает аккаунт."] },
      { title: "Поля", items: ["Владелец / организация - аккаунт или org, где создать репозиторий.", "Имя репозитория - имя нового repo или текущего проекта.", "Видимость - private или public для нового repo.", "Сообщение коммита - текст для git commit."] },
      { title: "Действия", items: ["Создать репозиторий вызывает GitHub API.", "Коммит добавляет измененные файлы из git status.", "Push отправляет текущую ветку.", "Pull Request создает PR из указанной head-ветки в base-ветку."] },
    ],
  },
  logs: {
    title: "Информация о логах",
    intro: "Логи показывают события текущего или последнего запуска агентской цепочки.",
    sections: [
      { title: "Что смотреть", items: ["Фаза показывает шаг: prompt, run, result, error.", "Сообщение содержит статус модели, tool call или ошибку.", "LLM-аудит показывает provider, фактическую модель, URL и usage, если API его вернул."] },
    ],
  },
  settings: {
    title: "Информация о настройках",
    intro: "Настройки управляют моделями, API, runtime-режимами, темой и дополнительными интеграциями.",
    sections: [
      { title: "Локальные модели", items: ["Ollama-модели запускаются через локальный runtime Ollama.", "Hugging Face сейчас скачивает файлы в локальное хранилище; запуск HF-файлов будет отдельным runtime-этапом.", "Поиск модели помогает найти модель в каталоге или ввести имя вручную."] },
      { title: "Облачные API", items: ["Название в интерфейсе - удобное имя для пользователя.", "ID модели для API - настоящий model id, который отправляется провайдеру.", "Base URL - базовый адрес API, например https://api.openai.com/v1.", "Формат API выбирает OpenAI Chat Completions, Anthropic Messages или ручной OpenAI path.", "Endpoint path нужен, если reseller использует нестандартный путь."] },
      { title: "SearxNG, опционально", items: ["SearxNG URL - опциональный адрес собственного SearxNG instance без /search.", "Проверка поиска отправляет JSON-запрос /search?format=json.", "Для чата основной интернет-доступ теперь идет через кнопку \"Браузер\": Chromium сам ищет, открывает страницы и передает текст модели."] },
    ],
  },
};

const enInfo: Record<WorkbenchTab, PageInfoContent> = {
  chat: {
    title: "Chat information",
    intro: "Chat is the main screen for tasks, answers, attachments and execution progress.",
    sections: [
      { title: "Inputs", items: ["Write a task, question or project change request in the composer.", "The attachment button adds files to the next message.", "The Browser button lets the backend open URLs, search through Chromium, read page text and pass that context to the model."] },
      { title: "Modes", items: ["Planning asks the agent to decompose the task first.", "Coding is for workspace changes with the selected action policy."] },
      { title: "Errors", items: ["If the browser is unavailable, rerun the installer to install Playwright/Chromium.", "If a model is unavailable, the chat shows the real API error without silent fallback."] },
    ],
  },
  agents: {
    title: "Agents information",
    intro: "Create custom agents, choose models and define instructions.",
    sections: [
      { title: "Agent fields", items: ["Name is shown in progress and logs.", "Model chooses the local or cloud backend.", "Instruction defines the role; use No custom instruction for default behavior."] },
      { title: "Order", items: ["Agents run from top to bottom.", "Disabled agents are skipped for new tasks."] },
    ],
  },
  browser: {
    title: "Browser information",
    intro: "This tab controls headless Chromium used by DevAgent Hub to open sites, read pages, take screenshots and download files.",
    sections: [
      { title: "Inputs", items: ["Enter a site or file URL: https://example.com, https://site.com/file.pdf.", "Open reads visible page text and collects links.", "Screenshot saves a PNG under .devagent/browser/screenshots.", "Download saves a file under .devagent/browser/downloads."] },
      { title: "How the model uses it", items: ["Enable the browser button in chat so the backend opens URLs from the task.", "If no URL is provided, the backend searches through Chromium, opens the first results and adds page text to model context.", "This stage uses a backend browser tool, not a visible user browser window."] },
      { title: "Errors", items: ["If Playwright or Chromium is missing, rerun the installer.", "Some sites block automated browsers or require login/captcha."] },
    ],
  },
  code: {
    title: "Code editor information",
    intro: "This tab embeds OpenVSCode/code-server through the same-origin /ide/ route.",
    sections: [
      { title: "Purpose", items: ["Open and edit workspace files in the browser.", "Review changes made by agents in coding mode."] },
      { title: "Troubleshooting", items: ["Install the editor or restart the service after installation.", "Ubuntu uses prebuilt code-server to avoid npm native builds."] },
    ],
  },
  terminal: {
    title: "Terminal information",
    intro: "The terminal connects to the backend PTY in the project workspace.",
    sections: [
      { title: "Inputs", items: ["Run normal shell commands such as npm, git, python, ls/dir.", "Commands execute on the machine running DevAgent Hub."] },
      { title: "Safety", items: ["In confirmation mode, agent terminal actions must wait for approve/reject.", "Do not run commands you do not understand."] },
    ],
  },
  preview: {
    title: "Preview information",
    intro: "Preview displays a local app or any URL you want to inspect.",
    sections: [
      { title: "Fields", items: ["Preview URL is a dev server or page address opened in an iframe.", "Open externally opens the same URL in a new browser tab."] },
      { title: "Limits", items: ["Some sites block iframe embedding with security headers.", "For local apps, make sure the dev server is running on an accessible host/port."] },
    ],
  },
  github: {
    title: "GitHub information",
    intro: "Connect the workspace to GitHub: token, repositories, commits, pushes and pull requests.",
    sections: [
      { title: "Token", items: ["Paste a fine-grained PAT or classic token with access to the target repo.", "The token is stored outside git and is never returned to the UI.", "Test token calls GitHub /user and shows the account."] },
      { title: "Fields", items: ["Owner / organization is the account or org where a repo is created.", "Repository name is the new repo or current project name.", "Visibility controls private/public creation.", "Commit message is used for git commit."] },
      { title: "Actions", items: ["Create repository calls the GitHub API.", "Commit stages changed files from git status.", "Push sends the current branch.", "Pull Request creates a PR from head to base."] },
    ],
  },
  logs: {
    title: "Logs information",
    intro: "Logs show events from the current or last agent chain run.",
    sections: [
      { title: "What to inspect", items: ["Phase shows the step: prompt, run, result, error.", "Message contains model status, tool calls or errors.", "LLM audit shows provider, resolved model, URL and usage when returned by the API."] },
    ],
  },
  settings: {
    title: "Settings information",
    intro: "Settings control models, APIs, runtime modes, theme and optional integrations.",
    sections: [
      { title: "Local models", items: ["Ollama models run through the local Ollama runtime.", "Hugging Face downloads files into local storage; running HF files is a later runtime stage.", "Model search helps find catalog models or enter a name manually."] },
      { title: "Cloud APIs", items: ["Display name is the user-friendly name.", "API model ID is the real model id sent to the provider.", "Base URL is the API base, for example https://api.openai.com/v1.", "API format selects OpenAI Chat Completions, Anthropic Messages or custom OpenAI path.", "Endpoint path is needed when a reseller uses a non-standard path."] },
      { title: "SearxNG, optional", items: ["SearxNG URL is an optional self-hosted SearxNG instance address without /search.", "Search test sends a JSON request to /search?format=json.", "Chat internet access now uses the Browser button: Chromium searches, opens pages and passes page text to the model."] },
    ],
  },
};

export function pageInfo(language: AppLanguage, tab: WorkbenchTab): PageInfoContent {
  return (language === "ru" ? ruInfo : enInfo)[tab];
}
