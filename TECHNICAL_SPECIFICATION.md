# Technical Specification: OmniForge Studio

## 1. Purpose

OmniForge Studio, current repository codename DevAgent Hub, is a local-first and self-hosted web workspace for AI agents, code editing, terminal automation, browser automation, GitHub workflows, and model management.

The system must support:

- local models;
- cloud models;
- official APIs;
- non-official reseller APIs;
- OpenAI-compatible APIs;
- Anthropic-compatible APIs;
- arbitrary agents;
- multiple workspaces;
- browser, terminal, files, GitHub, and coding automation under explicit safety policies.

The current service is the MVP baseline. The primary engineering objective is to stabilize the web interface and model execution, then expand runtimes, workspaces, browser automation, GitHub automation, and security.

## 2. High-Level Architecture

```text
User Browser
  |
  | HTTP/WebSocket
  v
Web UI, React/Vite
  |
  | /api, /ws, /ide
  v
FastAPI Backend
  |
  +-- Agent Orchestrator
  +-- Model Router
  +-- Local Runtime Manager
  +-- Cloud API Adapter Layer
  +-- Workspace Manager
  +-- Terminal PTY Gateway
  +-- Browser Automation Service
  +-- GitHub Service
  +-- Secrets Service
  +-- Audit Log Service
  +-- Installer/Health Service
  |
  +-- OpenVSCode/code-server
  +-- Ollama / llama.cpp / vLLM / LM Studio / text-generation-webui
  +-- Playwright/Chromium
  +-- Git CLI / GitHub API
```

## 3. Repository Layout

Target layout:

```text
apps/web/                     React web interface
services/agent-api/           FastAPI backend
services/                     service scripts, startup scripts, secrets examples
installer/                    CLI/GUI installer implementation
scripts/                      smoke checks, maintenance scripts
.devagent/                    runtime state, not committed
.tools/                       portable installed tools, not committed
PRODUCT_REQUIREMENTS.md       product requirements
TECHNICAL_SPECIFICATION.md    technical specification
README_INSTALL.txt            user install summary
```

Runtime state:

```text
.devagent/
  agents.json                 agent and model config
  chats/                      chat sessions per workspace
  attachments/                uploaded files
  browser/
    downloads/
    screenshots/
  model-downloads.json        local model download tasks
  audit.log                   action audit log
  workspaces.json             workspace registry

services/secrets.env          secrets, excluded from git
```

## 4. Web UI Requirements

The UI must be a product-grade workspace, not a landing page.

Required tabs:

- Chat;
- Agents;
- Code;
- Terminal;
- Browser;
- GitHub;
- Logs;
- Settings.

Shared UI requirements:

- RU/EN localization;
- future additional languages;
- dark and light themes;
- full keyboard and mouse usability;
- stable responsive layout;
- no clipped or shifted buttons;
- Info button on every page;
- beginner/professional display modes;
- autosave for settings where safe;
- explicit loading states for all long actions;
- friendly error above raw technical error.

### 4.1 Chat UI

Chat must be full-height and full-width inside the workspace.

Required controls:

- file attachment button;
- Browser access toggle;
- planning mode;
- coding mode;
- goal mode;
- reasoning level selector where supported;
- action policy selector;
- run/stop button;
- retry;
- regenerate;
- continue;
- copy;
- export.

Required behavior:

- history sidebar;
- folders/projects for chats;
- delete chat;
- rename chat;
- per-message roles: user, assistant, agent, tool, browser, terminal, GitHub;
- per-message model metadata;
- per-message token usage when provider returns it;
- "provider did not return token usage" when usage is absent;
- tool timeline;
- diffs and changed files;
- export to Markdown/PDF.

File attachments:

- support all file types that selected model/provider can process;
- warn when selected model does not support file attachments;
- pass text files into prompt context with limits;
- keep binary files as metadata unless a provider supports them.

### 4.2 Agents UI

Agents are arbitrary and user-created.

Agent fields:

- id;
- display name;
- enabled flag;
- execution order;
- selected model id;
- optional instruction;
- no-instruction mode;
- tool permissions;
- template id;
- tags or purpose.

Agents can run:

- alone;
- as a chain;
- with estimated token/cost usage for paid/API models.

The old fixed Generator/Critic/Optimizer/Tester/Finalizer chain is not the product model. It can exist only as a default template.

### 4.3 Code UI

Code editor must use OpenVSCode/code-server.

Requirements:

- installed by installer;
- started automatically with backend or on first access;
- embedded through same-origin `/ide/`;
- no need to open a separate `3001` page;
- workspace path matches selected workspace;
- agent can deep-link to file and line;
- code-server install must avoid npm native build failures on Ubuntu.

Preferred Ubuntu install method:

- prebuilt standalone release package; or
- official install script/deb package with pinned version.

Avoid:

- `npm install code-server` as primary Linux install path.

### 4.4 Terminal UI

Terminal must use a real PTY.

Requirements:

- multiple terminal sessions;
- Windows PowerShell;
- Windows CMD;
- Linux bash;
- Linux zsh when available;
- resize support;
- input support;
- command logs;
- policy enforcement for agent-triggered commands.

Windows PTY:

- pywinpty.

Linux PTY:

- Python `pty`;
- ptyprocess where needed.

### 4.5 Browser UI And Tool

Browser is the single internet tool.

Requirements:

- installed by installer through Playwright/Chromium;
- no separate "Search the internet" chat button;
- Browser toggle in chat grants browser tool access;
- browser can search, open pages, read text, click, navigate, screenshot, and download;
- downloaded files appear in UI;
- screenshot files appear in UI;
- proxy/VPN settings;
- persistent cookies/session when enabled;
- confirmation before sensitive actions;
- support headless mode by default;
- optional visible browser mode can be added later for debugging.

SearxNG:

- optional diagnostic/search provider;
- not required for chat internet access.

### 4.6 GitHub UI

Initial auth:

- fine-grained PAT;
- classic PAT fallback.

Future auth:

- OAuth;
- account login integration;
- 2FA when account system exists.

Required operations:

- save token into secrets storage;
- test token through GitHub `/user`;
- create repository;
- initialize git;
- generate `.gitignore`;
- generate README;
- generate license;
- commit;
- push;
- create pull request;
- show diff before commit/push/PR;
- confirm remote-changing actions.

Future:

- GitLab;
- Bitbucket.

### 4.7 Logs UI

Requirements:

- simple mode for normal users;
- professional mode for full logs;
- agent logs;
- model logs;
- browser logs;
- terminal command logs;
- GitHub action logs;
- installer logs;
- downloadable logs;
- raw stack trace under friendly error.

### 4.8 Settings UI

Settings are global unless explicitly workspace-specific.

Required sections:

- local model runtimes;
- cloud model APIs;
- model catalog;
- agent defaults;
- browser/proxy;
- GitHub;
- theme;
- language;
- action policies;
- external/LAN access;
- HTTPS/VPS;
- diagnostics.

## 5. Backend Architecture

Backend is FastAPI.

Core modules:

- `app.main`: API routes and startup;
- `agent orchestration`: task lifecycle and agent chain execution;
- `model manager`: catalogs, downloads, deletion, tests;
- `llm provider layer`: Ollama, OpenAI-compatible, Anthropic-compatible, custom adapters;
- `workspace service`: workspace registry and file operations;
- `terminal service`: WebSocket PTY;
- `browser service`: Playwright/Chromium operations;
- `github service`: GitHub API and git CLI wrapper;
- `secrets service`: encrypted secrets;
- `runtime settings`: host, auth, mode, theme, policies;
- `audit log`: immutable action records;
- `health service`: dependency checks.

## 6. Data Models

### 6.1 Agent Model

```json
{
  "id": "agent-id",
  "name": "Planner",
  "enabled": true,
  "order": 1,
  "modelId": "model-id",
  "systemPrompt": "",
  "noInstruction": false,
  "tools": ["browser", "files", "terminal", "github"],
  "templateId": "optional-template"
}
```

### 6.2 Model

```json
{
  "id": "cloud-deepseek",
  "name": "DeepSeek coder",
  "provider": "custom",
  "kind": "cloud",
  "modelName": "deepseek-chat",
  "baseUrl": "https://api.example.com/v1",
  "apiKeyEnv": "AGENT_STUDIO_API_KEY",
  "apiFormat": "openai-chat-completions",
  "endpointPath": "/chat/completions",
  "description": "Custom OpenAI-compatible model",
  "requirements": {
    "ramGb": 1,
    "diskGb": 0,
    "vramGb": 0
  }
}
```

`name` is UI display name.  
`modelName` is the exact id sent to provider.

### 6.3 LLM Result

```json
{
  "text": "Answer",
  "provider": "openrouter",
  "requestedModel": "anthropic/claude-sonnet-4",
  "resolvedModel": "anthropic/claude-sonnet-4",
  "baseUrl": "https://openrouter.ai/api/v1",
  "requestUrl": "https://openrouter.ai/api/v1/chat/completions",
  "usage": {
    "promptTokens": 1200,
    "completionTokens": 400,
    "totalTokens": 1600
  },
  "finishReason": "stop",
  "latencyMs": 2100,
  "rawUsageAvailable": true
}
```

If usage is missing:

```json
{
  "rawUsageAvailable": false,
  "usage": null
}
```

UI text:

```text
Provider did not return token usage. Check usage on the provider dashboard.
```

### 6.4 Workspace

```json
{
  "id": "workspace-id",
  "name": "My Project",
  "path": "/home/user/project",
  "createdAt": "ISO",
  "lastOpenedAt": "ISO",
  "gitRemote": "https://github.com/user/project.git"
}
```

## 7. Model Provider Layer

The model layer must be adapter-based.

Required adapters:

- Ollama;
- OpenAI Chat Completions;
- Anthropic Messages;
- custom OpenAI-compatible path;
- OpenRouter;
- generic reseller API;
- future Gemini;
- future Mistral;
- future Groq;
- future Together;
- future Hugging Face Inference Providers.

Local runtimes:

- Ollama first;
- llama.cpp;
- vLLM;
- LM Studio;
- text-generation-webui;
- Hugging Face downloaded model runner.

### 7.1 OpenAI-Compatible Requests

Default request:

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

Body:

```json
{
  "model": "real-model-id",
  "messages": [],
  "temperature": 0.7,
  "max_tokens": 4096
}
```

If `baseUrl` already contains `/chat/completions`, do not append the endpoint again.

If `baseUrl` contains `/v1` and `endpointPath` is `/v1/chat/completions`, do not produce `/v1/v1/chat/completions`.

### 7.2 Anthropic-Compatible Requests

Default request:

```http
POST {baseUrl}/messages
x-api-key: {apiKey}
anthropic-version: 2023-06-01
Content-Type: application/json
```

Body:

```json
{
  "model": "real-model-id",
  "system": "system prompt",
  "messages": [],
  "temperature": 0.7,
  "max_tokens": 4096
}
```

### 7.3 Provider Test

Every provider form must include a test button.

Test result must show:

- status;
- provider;
- requested model;
- resolved model;
- base URL;
- final request URL;
- API format;
- latency;
- usage;
- warning if resolved model differs;
- raw/friendly error.

HTML errors must be converted to readable messages:

```text
Provider returned HTML error from {requestUrl}. Check API format, base URL, and endpoint path.
```

## 8. Agent Execution

Modes:

- `plan`;
- `coding`;
- `full-access`;
- `goal`.

Policies:

- `confirm`: ask before every file/git/terminal/browser action;
- `auto-confirm`: auto-approve safe actions, still ask for critical actions;
- `full-access`: allow broad actions, still block or confirm system-critical actions.

Critical actions:

- deleting system files;
- deleting files outside selected workspace;
- modifying OS startup/security settings;
- installing software;
- running unknown binaries;
- entering credentials into websites;
- sending sensitive data;
- git push;
- creating public repository;
- creating pull request;
- external network exposure changes.

Agent execution flow:

```text
Chat message
  -> create task
  -> select enabled agents by order
  -> build context: chat, attachments, browser pages, workspace summary
  -> run each agent
  -> collect LLM metadata
  -> request action approvals when required
  -> apply changes
  -> save messages/logs/audit
  -> show result and diff
```

## 9. Browser Automation

Backend tool:

- Playwright/Chromium.

Functions:

- search query;
- open URL;
- read page text;
- extract links;
- click/navigate;
- screenshot;
- download file;
- persist session;
- use proxy.

Browser access from chat:

- if user provides URL, open URL;
- if user asks to download, download URL/file;
- if user asks a web question without URL, search with browser and open top results;
- attach browser context to model input.

Sensitive browser actions require confirmation:

- login;
- form submission;
- upload;
- download executable;
- payment;
- password entry;
- personal data entry;
- accepting permissions.

## 10. Terminal Automation

PTY gateway:

- WebSocket input/output;
- session id;
- resize;
- command capture;
- shell selection.

Agent-triggered commands must go through policy engine.

Danger detection should inspect:

- command binary;
- arguments;
- working directory;
- target paths;
- destructive flags;
- network install commands;
- privilege escalation.

Commands are not limited to workspace when full system access is enabled, but actions outside workspace must be logged and usually confirmed.

## 11. File And Workspace Automation

Required:

- unlimited workspaces;
- create workspace;
- open workspace;
- clone workspace from GitHub;
- switch workspace;
- per-workspace chat history;
- global model settings;
- file read/write/delete/move;
- diff generation;
- snapshots before risky coding tasks;
- undo/restore from snapshot;
- open file in IDE by path and line.

Snapshot approval:

- before large edits, ask whether to create snapshot;
- user can accept or decline.

## 12. GitHub Automation

GitHub actions:

- save PAT;
- delete PAT;
- test PAT;
- create repo;
- init repo;
- generate README;
- generate `.gitignore`;
- generate license;
- commit;
- push;
- create pull request;
- show status;
- show diff.

All write/remote actions must be policy-checked.

Secrets:

- token stored outside git;
- token never returned to UI;
- UI only shows status and username.

## 13. Secrets And Security

Secrets path:

```text
services/secrets.env
```

Requirements:

- file excluded from git;
- restricted permissions where OS supports it;
- encryption at rest;
- key derivation from local machine/user secret or explicit master password;
- never log secret values;
- redact secrets in errors;
- audit all secret changes.

External access:

- local mode: `127.0.0.1`;
- LAN mode: `0.0.0.0` with token/login;
- VPS mode: HTTPS required.

Future account system:

- login page;
- 2FA;
- session management;
- then token-only LAN auth can be replaced by accounts.

## 14. Installer Specification

Installers:

- `install.sh`;
- `install.ps1`;
- Node CLI;
- GUI installer;
- executable installer;
- Docker installer;
- future `.deb`.

Installer must ask:

- install path;
- local-only, LAN, or external/VPS access;
- whether to install local model runtime;
- whether to install Ollama;
- whether to install Docker;
- whether to install browser runtime;
- whether to install OpenVSCode/code-server;
- whether to start service after install;
- whether to run on boot;
- whether to configure proxy.

Installer must install or verify:

- Python;
- Node.js;
- Docker;
- Ollama;
- Playwright/Chromium;
- code-server/OpenVSCode;
- git;
- backend Python dependencies;
- web dependencies;
- service startup.

Windows:

- PowerShell;
- winget where available;
- portable Node fallback;
- scheduled task or startup shortcut fallback;
- Windows service later.

Ubuntu:

- Ubuntu 22.04;
- Ubuntu 24.04;
- headless server support;
- systemd user service or system service;
- prebuilt code-server install;
- Playwright dependencies;
- NVIDIA/GPU detection where possible.

Uninstall:

- stop service;
- remove startup entry;
- optional remove `.tools`;
- optional remove `.devagent`;
- optional keep workspaces;
- no guarantee to preserve chats/models during reinstall unless user exports/backups.

## 15. Public API

### Health

- `GET /health`
- `GET /api/system/check`
- `POST /api/system/fix`

### Runtime Settings

- `GET /api/settings/runtime`
- `POST /api/settings/runtime`

### Agents

- `GET /api/agents/config`
- `POST /api/agents/config`
- `POST /api/agents/run`
- `GET /api/agents/status/{task_id}`
- `POST /api/agents/cancel/{task_id}`
- `GET /api/agents/logs/{task_id}`

### Chats

- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/{chat_id}`
- `PATCH /api/chats/{chat_id}`
- `DELETE /api/chats/{chat_id}`
- `POST /api/chats/{chat_id}/messages`
- `POST /api/chats/{chat_id}/attachments`
- `POST /api/chats/{chat_id}/run`
- `POST /api/chats/{chat_id}/export`

### Models

- `GET /api/models/catalog`
- `GET /api/models/ollama/search?q=&page=`
- `GET /api/models/huggingface/search?q=&page=`
- `POST /api/models/local/download`
- `GET /api/models/local/downloads`
- `GET /api/models/local/downloads/{id}`
- `POST /api/models/local/downloads/{id}/retry`
- `DELETE /api/models/local/{source}/{model}`
- `POST /api/models/cloud`
- `POST /api/models/cloud/test`
- `DELETE /api/models/{model_id}`

### Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/{workspace_id}`
- `POST /api/workspaces/{workspace_id}/open`
- `POST /api/workspaces/clone`
- `GET /api/workspaces/{workspace_id}/changes`
- `GET /api/workspaces/{workspace_id}/diff`
- `POST /api/workspaces/{workspace_id}/snapshot`
- `POST /api/workspaces/{workspace_id}/restore`

### Browser

- `GET /api/browser/status`
- `POST /api/browser/search`
- `POST /api/browser/open`
- `POST /api/browser/click`
- `POST /api/browser/screenshot`
- `POST /api/browser/download`
- `GET /api/browser/downloads`
- `GET /api/browser/screenshots`

### Terminal

- `GET /api/terminal/sessions`
- `POST /api/terminal/sessions`
- `DELETE /api/terminal/sessions/{session_id}`
- `WS /api/terminal/ws/{session_id}`

### GitHub

- `POST /api/github/token`
- `POST /api/github/test`
- `DELETE /api/github/token`
- `POST /api/github/repos`
- `POST /api/github/commit`
- `POST /api/github/push`
- `POST /api/github/pull-request`
- `GET /api/github/status`

### Actions And Approval

- `GET /api/actions/pending`
- `POST /api/actions/{action_id}/approve`
- `POST /api/actions/{action_id}/reject`

### Logs

- `GET /api/logs`
- `GET /api/logs/download`
- `GET /api/audit`
- `GET /api/audit/download`

## 16. Environment Variables

Required/known:

```text
DEVAGENT_HOST
DEVAGENT_PORT
DEVAGENT_EXTERNAL_ACCESS
DEVAGENT_AUTH_TOKEN
DEVAGENT_HTTPS
DEVAGENT_PUBLIC_URL
OLLAMA_BASE_URL=http://127.0.0.1:11434
NO_PROXY=localhost,127.0.0.1
AGENT_STUDIO_API_KEY
AGENT_STUDIO_OPENAI_API_KEY
AGENT_STUDIO_OPENROUTER_API_KEY
AGENT_STUDIO_ANTHROPIC_API_KEY
GITHUB_TOKEN
GH_TOKEN
HTTPS_PROXY
HTTP_PROXY
NO_PROXY
```

## 17. Testing Plan

Automated:

- TypeScript typecheck;
- Python syntax check;
- installer smoke;
- backend API smoke;
- model URL builder tests;
- cloud provider adapter tests;
- chat storage tests;
- browser service tests with mocked network where possible;
- terminal PTY tests;
- GitHub service tests with mocked API.

Commands:

```bash
npm run verify
npm --workspace apps/web run typecheck
python -m py_compile services/agent-api/app/*.py
```

Manual Windows 10:

- install from clean folder;
- verify Python/Node/Ollama/code-server/browser install;
- run local UI;
- run chat with Ollama;
- run chat with cloud official API;
- run chat with reseller API;
- open `/ide/`;
- type in terminal;
- run browser open/search/download;
- run GitHub token test.

Manual Ubuntu 22.04/24.04:

- install on headless server;
- LAN access from another PC;
- external/VPS mode;
- service restart after reboot;
- code-server install without npm native build failure;
- Playwright/Chromium install;
- Ollama pull/delete model;
- browser search/open/read;
- terminal PTY.

Security:

- LAN mode requires auth;
- VPS mode requires HTTPS;
- secrets are redacted;
- dangerous commands are blocked or confirmed;
- file delete outside workspace is confirmed or blocked;
- git push/PR requires confirmation;
- browser login/form submission requires confirmation.

UI:

- dark theme;
- light theme;
- RU/EN;
- all Info buttons;
- chat long messages;
- attachments;
- mobile/narrow viewport where supported;
- no clipped buttons.

## 18. Implementation Priorities

Priority 0: do not break current MVP.

Priority 1:

- repair chat UI;
- repair light theme;
- fix official and reseller API calls;
- show real model/provider/token metadata;
- unify internet through Browser;
- make installer reliable on Ubuntu and Windows.

Priority 2:

- arbitrary agents and templates;
- model runtime expansion;
- workspace registry;
- OpenVSCode deep links;
- terminal multi-session.

Priority 3:

- browser click/session/proxy;
- GitHub full workflow;
- snapshots and undo;
- audit log;
- encrypted secrets.

Priority 4:

- login;
- 2FA;
- HTTPS automation;
- hosted/team features;
- marketplace.

## 19. Non-Goals For Immediate Phase

These are not first-priority, but must be designed for:

- account system;
- 2FA;
- paid marketplace;
- team collaboration;
- GitLab/Bitbucket;
- visible interactive browser mode;
- native desktop app.

## 20. Acceptance Criteria

The product is acceptable for the next MVP milestone when:

- UI pages are visually consistent in dark and light themes;
- chat is full-screen and works like a modern AI chat;
- Ollama model calls work;
- official OpenAI/Anthropic/OpenRouter calls work;
- custom reseller APIs can be configured with format and endpoint path;
- provider errors are understandable;
- token usage is shown or explicitly marked as unavailable;
- Browser access can search, open pages, read text, and download files;
- OpenVSCode is installed automatically and embedded at `/ide/`;
- terminal input works;
- GitHub token test works;
- Windows 10 and Ubuntu 22.04/24.04 installers complete without manual dependency debugging;
- every unimplemented feature is clearly marked, not silently stubbed.
