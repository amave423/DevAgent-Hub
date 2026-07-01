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
    intro: "Чат - главный экран для постановки задач агентам, просмотра ответов, вложений и хода выполнения.",
    sections: [
      {
        title: "Что вводить",
        items: [
          "В поле ввода напиши вопрос, задачу или просьбу изменить проект.",
          "Кнопка вложений добавляет файлы к следующему сообщению. Backend передает текстовые файлы модели с лимитами.",
          "Кнопка браузера дает агенту доступ к browser tool: он может открывать URL, читать страницы, делать скриншоты и скачивать файлы, если это разрешено политикой действий.",
        ],
      },
      {
        title: "Режимы",
        items: [
          "Планирование просит агента сначала разобрать задачу и предложить шаги.",
          "Кодинг предназначен для изменений в workspace, git и терминале.",
          "Политика действий определяет, нужно ли подтверждать операции с файлами, git, терминалом и браузером.",
        ],
      },
      {
        title: "Ошибки",
        items: [
          "Если модель недоступна, чат показывает реальную ошибку API без тихого перехода в mock.",
          "Если browser tool не установлен, перезапусти установщик, чтобы поставить Playwright/Chromium.",
          "Если cloud API не возвращает usage, интерфейс пишет, что токены не вернулись провайдером.",
        ],
      },
    ],
  },
  agents: {
    title: "Информация об агентах",
    intro: "На этой странице создаются произвольные агенты, выбираются модели, инструкции и порядок работы.",
    sections: [
      {
        title: "Поля агента",
        items: [
          "Название видно в ходе выполнения, логах и аудите.",
          "Модель определяет локальный или облачный backend, который будет отвечать за агента.",
          "Инструкция задает роль агента. Кнопка без инструкции оставляет базовое поведение модели.",
        ],
      },
      {
        title: "Порядок",
        items: [
          "Включенные агенты выполняются сверху вниз.",
          "Если включен один агент, отвечает только он. Если включено несколько, задача проходит цепочкой.",
          "Отключенный агент не участвует в новых задачах.",
        ],
      },
    ],
  },
  code: {
    title: "Информация о редакторе кода",
    intro: "Вкладка встраивает OpenVSCode/code-server через same-origin адрес /ide/.",
    sections: [
      {
        title: "Для чего",
        items: [
          "Открывать и редактировать файлы проекта в браузере.",
          "Проверять изменения, которые сделал агент в режиме кодинга.",
          "Работать с workspace без перехода на отдельный порт.",
        ],
      },
      {
        title: "Если редактор не открылся",
        items: [
          "Нажми установку редактора или перезапусти сервис после установки.",
          "На Ubuntu используется prebuilt code-server, чтобы не собирать native-модули через npm.",
          "Если /ide/ не открывается по LAN, проверь внешний доступ и токен сервиса.",
        ],
      },
    ],
  },
  terminal: {
    title: "Информация о терминале",
    intro: "Терминал подключается к backend PTY и работает в рабочей папке проекта.",
    sections: [
      {
        title: "Что вводить",
        items: [
          "Обычные shell-команды: npm, git, python, dir/ls и другие.",
          "Команды выполняются на машине, где запущен DevAgent Hub.",
        ],
      },
      {
        title: "Безопасность",
        items: [
          "В режиме подтверждений действия агента через терминал должны ожидать approve/reject.",
          "Опасные операции, удаление системных файлов и установка сомнительных файлов должны требовать подтверждения.",
        ],
      },
    ],
  },
  preview: {
    title: "Информация о просмотре",
    intro: "Просмотр показывает локальное приложение, сайт или страницу, за которой нужно наблюдать.",
    sections: [
      {
        title: "Поля",
        items: [
          "URL просмотра - адрес dev server или страницы, которую нужно открыть в iframe.",
          "Открыть отдельно запускает этот же URL в новой вкладке браузера.",
        ],
      },
      {
        title: "Ограничения",
        items: [
          "Некоторые сайты запрещают iframe через security headers.",
          "Для локальных приложений убедись, что dev server слушает доступный host и port.",
          "Эта вкладка нужна для визуального наблюдения; browser tool для агента включается из чата.",
        ],
      },
    ],
  },
  github: {
    title: "Информация о GitHub",
    intro: "GitHub-вкладка связывает workspace с GitHub: токен, репозитории, коммиты, push и pull request.",
    sections: [
      {
        title: "Токен",
        items: [
          "Вставь fine-grained PAT или classic token с доступом к нужному repo.",
          "Токен хранится вне git в services/secrets.env и не возвращается обратно в UI.",
          "Проверка токена вызывает GitHub /user и показывает аккаунт.",
        ],
      },
      {
        title: "Поля",
        items: [
          "Владелец / организация - аккаунт или org, где создается репозиторий.",
          "Имя репозитория - имя нового repo или текущего проекта.",
          "Видимость выбирает private или public для нового repo.",
          "Сообщение коммита используется для git commit.",
        ],
      },
      {
        title: "Действия",
        items: [
          "Создать репозиторий вызывает GitHub API.",
          "Коммит добавляет измененные файлы из git status.",
          "Push отправляет текущую ветку.",
          "Pull Request создает PR из указанной head-ветки в base-ветку.",
        ],
      },
    ],
  },
  logs: {
    title: "Информация о логах",
    intro: "Логи показывают события текущего или последнего запуска агентской цепочки.",
    sections: [
      {
        title: "Что смотреть",
        items: [
          "Фаза показывает шаг: prompt, run, result, tool, error.",
          "Сообщение содержит статус модели, tool call или ошибку.",
          "LLM-аудит показывает provider, фактическую модель, URL запроса и usage, если API его вернул.",
        ],
      },
    ],
  },
  settings: {
    title: "Информация о настройках",
    intro: "Настройки управляют моделями, API, runtime-режимами, темой и дополнительными интеграциями.",
    sections: [
      {
        title: "Локальные модели",
        items: [
          "Ollama-модели запускаются через локальный runtime Ollama.",
          "Hugging Face сейчас скачивает файлы в локальное хранилище; запуск HF-файлов будет отдельным runtime-этапом.",
          "Поиск модели помогает найти модель в каталоге или ввести имя вручную.",
        ],
      },
      {
        title: "Облачные API",
        items: [
          "Название в интерфейсе - удобное имя для пользователя.",
          "ID модели для API - настоящий model id, который отправляется провайдеру.",
          "Base URL - базовый адрес API, например https://api.openai.com/v1.",
          "Формат API выбирает OpenAI Chat Completions, Anthropic Messages или ручной OpenAI path.",
          "Endpoint path нужен, если reseller использует нестандартный путь.",
        ],
      },
      {
        title: "Интернет и браузер",
        items: [
          "SearxNG URL опционален и нужен только для поискового API.",
          "Основной доступ агента к интернету идет через browser tool: Chromium может искать, открывать страницы, читать текст, делать скриншоты и скачивать файлы.",
          "Если нужен полный браузерный доступ, установщик должен поставить Playwright/Chromium.",
        ],
      },
    ],
  },
};

const enInfo: Record<WorkbenchTab, PageInfoContent> = {
  chat: {
    title: "Chat information",
    intro: "Chat is the main screen for assigning tasks to agents, reading answers, attaching files and tracking execution.",
    sections: [
      {
        title: "Inputs",
        items: [
          "Write a question, task or project change request in the composer.",
          "The attachment button adds files to the next message. The backend passes text files to the model with limits.",
          "The browser button gives the agent access to the browser tool: it can open URLs, read pages, take screenshots and download files when allowed by the action policy.",
        ],
      },
      {
        title: "Modes",
        items: [
          "Planning asks the agent to decompose the task before acting.",
          "Coding is for workspace, git and terminal changes.",
          "The action policy controls whether file, git, terminal and browser actions require approval.",
        ],
      },
      {
        title: "Errors",
        items: [
          "If a model is unavailable, the chat shows the real API error without silent mock fallback.",
          "If the browser tool is missing, rerun the installer to install Playwright/Chromium.",
          "If a cloud API does not return usage, the UI states that tokens were not returned by the provider.",
        ],
      },
    ],
  },
  agents: {
    title: "Agents information",
    intro: "Create custom agents, choose their models, instructions and execution order.",
    sections: [
      {
        title: "Agent fields",
        items: [
          "Name is shown in progress, logs and audit.",
          "Model chooses the local or cloud backend used by the agent.",
          "Instruction defines the role. Use no custom instruction for default model behavior.",
        ],
      },
      {
        title: "Order",
        items: [
          "Enabled agents run from top to bottom.",
          "One enabled agent answers alone. Multiple enabled agents run as a chain.",
          "Disabled agents are skipped for new tasks.",
        ],
      },
    ],
  },
  code: {
    title: "Code editor information",
    intro: "This tab embeds OpenVSCode/code-server through the same-origin /ide/ route.",
    sections: [
      {
        title: "Purpose",
        items: [
          "Open and edit project files in the browser.",
          "Review changes made by agents in coding mode.",
          "Work with the workspace without switching to a separate port.",
        ],
      },
      {
        title: "Troubleshooting",
        items: [
          "Install the editor or restart the service after installation.",
          "Ubuntu uses prebuilt code-server to avoid npm native builds.",
          "If /ide/ fails over LAN, check external access and the service token.",
        ],
      },
    ],
  },
  terminal: {
    title: "Terminal information",
    intro: "The terminal connects to the backend PTY in the project workspace.",
    sections: [
      {
        title: "Inputs",
        items: [
          "Run normal shell commands such as npm, git, python, dir/ls and others.",
          "Commands execute on the machine running DevAgent Hub.",
        ],
      },
      {
        title: "Safety",
        items: [
          "In confirmation mode, agent terminal actions must wait for approve/reject.",
          "Dangerous operations, system file deletion and suspicious installs should require confirmation.",
        ],
      },
    ],
  },
  preview: {
    title: "Preview information",
    intro: "Preview displays a local app, website or page you want to watch.",
    sections: [
      {
        title: "Fields",
        items: [
          "Preview URL is a dev server or page address opened in an iframe.",
          "Open externally opens the same URL in a new browser tab.",
        ],
      },
      {
        title: "Limits",
        items: [
          "Some sites block iframe embedding with security headers.",
          "For local apps, make sure the dev server is running on an accessible host and port.",
          "This tab is for visual observation; the agent browser tool is enabled from chat.",
        ],
      },
    ],
  },
  github: {
    title: "GitHub information",
    intro: "Connect the workspace to GitHub: token, repositories, commits, pushes and pull requests.",
    sections: [
      {
        title: "Token",
        items: [
          "Paste a fine-grained PAT or classic token with access to the target repo.",
          "The token is stored outside git in services/secrets.env and is never returned to the UI.",
          "Test token calls GitHub /user and shows the account.",
        ],
      },
      {
        title: "Fields",
        items: [
          "Owner / organization is the account or org where a repo is created.",
          "Repository name is the new repo or current project name.",
          "Visibility controls private/public creation.",
          "Commit message is used for git commit.",
        ],
      },
      {
        title: "Actions",
        items: [
          "Create repository calls the GitHub API.",
          "Commit stages changed files from git status.",
          "Push sends the current branch.",
          "Pull Request creates a PR from head to base.",
        ],
      },
    ],
  },
  logs: {
    title: "Logs information",
    intro: "Logs show events from the current or last agent chain run.",
    sections: [
      {
        title: "What to inspect",
        items: [
          "Phase shows the step: prompt, run, result, tool or error.",
          "Message contains model status, tool calls or errors.",
          "LLM audit shows provider, resolved model, request URL and usage when returned by the API.",
        ],
      },
    ],
  },
  settings: {
    title: "Settings information",
    intro: "Settings control models, APIs, runtime modes, theme and optional integrations.",
    sections: [
      {
        title: "Local models",
        items: [
          "Ollama models run through the local Ollama runtime.",
          "Hugging Face downloads files into local storage; running HF files is a separate future runtime stage.",
          "Model search helps find catalog models or enter a name manually.",
        ],
      },
      {
        title: "Cloud APIs",
        items: [
          "Display name is the user-friendly name.",
          "API model ID is the real model id sent to the provider.",
          "Base URL is the API base, for example https://api.openai.com/v1.",
          "API format selects OpenAI Chat Completions, Anthropic Messages or custom OpenAI path.",
          "Endpoint path is needed when a reseller uses a non-standard path.",
        ],
      },
      {
        title: "Internet and browser",
        items: [
          "SearxNG URL is optional and only needed for search API integration.",
          "Primary agent internet access uses the browser tool: Chromium can search, open pages, read text, take screenshots and download files.",
          "For full browser access, the installer must install Playwright/Chromium.",
        ],
      },
    ],
  },
};

export function pageInfo(language: AppLanguage, tab: WorkbenchTab): PageInfoContent {
  return (language === "ru" ? ruInfo : enInfo)[tab];
}
