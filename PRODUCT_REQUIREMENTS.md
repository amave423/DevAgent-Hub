# Product Requirements: Orqen Studio

## 1. Product Identity

**Product name:** Orqen Studio  
**Previous codename:** DevAgent Hub

Orqen Studio is a local-first AI development workspace that lets users work with any AI model, any workspace, and any automation level from one web interface.

Before public launch, run a trademark, domain, GitHub organization, package name, and social handle check for Orqen Studio.

## 2. Product Vision

Orqen Studio should combine the strongest parts of ChatGPT, Claude, DeepSeek, Cursor, OpenHands, GitHub automation, VS Code, terminal tools, and browser automation into a single self-hosted product.

The product should let a user:

- chat with AI like in modern LLM products;
- configure arbitrary AI agents;
- use local, cloud, official, reseller, and custom models;
- run coding tasks inside a real browser-based VS Code environment;
- allow agents to use terminal, browser, files, GitHub, and system tools under configurable safety policies;
- run fully local when a local model is installed;
- deploy on personal computers, LAN servers, Ubuntu servers, and VPS machines.

## 3. Target Users

Orqen Studio is intended for a wide market:

- non-technical users who want AI to help with files, web research, and simple automation;
- solo developers who want a local Cursor/OpenHands-style assistant;
- advanced users who want unrestricted model/provider choice;
- teams that need shared AI development infrastructure;
- companies that need self-hosted, auditable AI agent workflows.

The UX must support both beginner and professional modes.

Beginner mode should show simple explanations, safe defaults, health cards, and friendly errors.

Professional mode should expose detailed logs, model metadata, token usage, API URLs, diffs, command logs, browser traces, and debug details.

## 4. Positioning

The product is not only a chat app and not only an IDE. It is an agentic operating environment for AI-assisted work.

Core positioning:

- **Any model:** local, cloud, official API, reseller API, OpenAI-compatible API, Anthropic-compatible API, and future runtimes.
- **Any workspace:** unlimited local workspaces and GitHub repositories.
- **Any automation level:** plan-only, coding, browser actions, terminal actions, GitHub actions, and full system access with guardrails.
- **Local-first:** the product must work offline with downloaded local models.
- **Self-hosted first:** Windows, Ubuntu Server, desktop Linux, macOS, LAN, and VPS are all target deployments.

## 5. Business Model

During development the product is free.

Possible paid features after the product is stable:

- higher prompt/input limits for agent instructions and long tasks;
- model marketplace;
- paid model packs and curated agent templates;
- team collaboration;
- hosted sync;
- remote browser sessions;
- enterprise audit and compliance features;
- advanced security policy engine;
- managed cloud deployment.

The free version should remain useful for local personal work.

## 6. Required Pages

The application must include these primary pages:

1. **Chat**
2. **Agents**
3. **Code Editor**
4. **Terminal**
5. **Browser**
6. **GitHub**
7. **Logs**
8. **Settings**

Each page must include an **Info** button with localized explanations:

- what the page is for;
- what each field means;
- what data the user should enter;
- what buttons do;
- common errors;
- safety notes.

## 7. Core User Journeys

### 7.1 First Install On Ubuntu Server

1. User clones the repository or downloads an installer.
2. User runs `install.sh` or another supported installer.
3. Installer checks and installs Python, Node.js, Docker, Ollama, Playwright/Chromium, code-server/OpenVSCode, and other dependencies.
4. Installer asks whether LAN or external access is needed.
5. Installer configures service startup.
6. Installer prints local URL, LAN URL, and token/login information.
7. User opens the web UI from another device if LAN access was enabled.

### 7.2 First Install On Windows

1. User downloads archive or installer.
2. User runs one PowerShell command or an executable installer.
3. Installer sets up Python, Node.js, Ollama, Browser automation, code-server/OpenVSCode, service startup, and local config.
4. User opens the local web UI.

### 7.3 Configure Models

1. User opens Settings or Agents.
2. User adds local runtimes and cloud API providers.
3. User can test each provider.
4. UI shows provider, model id, actual response model, base URL, latency, and token usage.
5. If token usage is missing, UI says: "Provider did not return token usage. Check usage on the provider dashboard."

### 7.4 Create Agents

1. User creates arbitrary agents.
2. Each agent has a name, model, optional instruction, tools, order, and enabled flag.
3. User can use "No custom instruction" for default assistant behavior.
4. User can save and reuse agent templates.
5. If multiple paid/API agents are selected, UI estimates token/cost before running.

### 7.5 Work In Chat

1. User writes a prompt in a ChatGPT-style composer.
2. User can attach files through click or drag-and-drop.
3. User chooses plan, coding, goal, reasoning level, browser access, and action policy.
4. Chat shows messages by role: User, Assistant, Agent, Tool, Browser, Terminal, GitHub.
5. Chat shows task timeline, model metadata, usage, diffs, and final result.
6. User can stop, retry, regenerate, continue, copy, export, rename, and delete chats.

### 7.6 Coding Workflow

1. User enables coding mode.
2. Agent edits files in the selected workspace.
3. UI shows changed files and diffs.
4. Critical actions request approval.
5. User can open the affected file in OpenVSCode at the relevant line.
6. User can undo or restore from a snapshot.

### 7.7 Browser Workflow

1. User enables Browser access.
2. Agent can search the web, open websites, read pages, click, take screenshots, and download files.
3. Browser cookies/session can be persisted when the user allows it.
4. Sensitive actions require confirmation.
5. Downloaded files appear in the UI.

### 7.8 GitHub Workflow

1. User authorizes GitHub through PAT first, OAuth later.
2. Agent can create repositories, initialize git, commit, push, and create pull requests.
3. Git operations that change remote state require confirmation.
4. UI shows diff and status before commit/push/PR.

## 8. Feature Requirements

### 8.1 Chat

Must have:

- full-height ChatGPT-like layout;
- history sidebar;
- folders/projects for chats;
- delete and rename chat;
- export to Markdown/PDF;
- file attachments for all model-supported file types;
- attachment compatibility warning per selected model;
- stop, retry, regenerate, continue, copy;
- visible diff and changed files;
- model/provider/token metadata per response;
- reasoning display when model/provider supports it and policy allows it;
- tool timeline when full internal reasoning is unavailable.

Not required for now:

- search across chat history.

### 8.2 Agents

Must have:

- arbitrary agents;
- custom name;
- selected model;
- optional instruction;
- "No instruction" mode;
- enabled/disabled toggle;
- execution order;
- tool permissions;
- templates;
- one-agent mode and multi-agent chain mode;
- token/cost estimate for multi-agent runs when API pricing data is available.

### 8.3 Models

Must support:

- any local model that can be run through supported runtimes;
- any cloud model through official API, OpenAI-compatible API, Anthropic-compatible API, or custom endpoint adapter;
- reseller/non-official APIs where the request format is known or user-configured;
- actual model id separate from display name;
- provider test request;
- token usage reporting;
- clear message when provider does not return usage;
- local model download, installation, deletion, and progress tracking;
- RAM, VRAM, disk, speed, and quality hints;
- guardrails before downloading models larger than available resources.

Target local runtimes:

- Ollama;
- llama.cpp;
- vLLM;
- LM Studio;
- text-generation-webui;
- Hugging Face downloads and runnable model adapters.

### 8.4 Code Editor

Must have:

- OpenVSCode/code-server embedded through same-origin `/ide/`;
- automatic install through installer;
- automatic startup with backend;
- workspace path matching the selected project;
- deep-link from chat/diff to file and line.

### 8.5 Terminal

Must have:

- real PTY;
- multiple terminal sessions;
- Windows PowerShell/CMD support;
- Linux bash/zsh support;
- command logs;
- action policy enforcement;
- dangerous command detection;
- optional full system access.

### 8.6 Browser

Must have:

- managed browser runtime installed by installer;
- web search without a separate "search" button;
- page opening and reading;
- clicking and navigation;
- screenshots;
- file download;
- proxy/VPN configuration;
- support for restricted regions when proxy is configured;
- persistent cookies/session when enabled;
- confirmation before sensitive actions.

No separate manual browser page is required for normal users, but the Browser page remains useful for diagnostics and direct URL testing.

### 8.7 GitHub

Must have:

- PAT authorization first;
- OAuth later;
- account test;
- repo creation;
- git init;
- commit;
- push;
- pull request;
- diff before dangerous actions;
- `.gitignore`, README, license generation;
- future GitLab/Bitbucket support.

### 8.8 Workspaces

Must have:

- unlimited workspaces;
- create new workspace;
- open existing workspace;
- clone from GitHub;
- switch workspace;
- separate chat history per workspace;
- global model/settings configuration.

### 8.9 Logs And Diagnostics

Must have:

- Logs page;
- simple mode and professional mode;
- downloadable log files;
- system check button;
- automatic problem detection;
- automatic fixes where safe;
- friendly error above raw stack trace;
- debug mode.

### 8.10 Security

Must have:

- plan mode;
- coding mode;
- full access mode;
- goal mode;
- reasoning level selector when supported by model;
- policies: confirm every action, auto-confirm safe actions, full access;
- critical-action confirmation even in auto-confirm mode;
- encrypted secrets in `services/secrets.env` or a secure derived storage layer;
- audit log;
- IP access restrictions;
- warnings for LAN/external access;
- HTTPS for VPS deployment.

## 9. Deployment Requirements

Supported platforms:

- Windows 10;
- Windows 11;
- Ubuntu 22.04;
- Ubuntu 24.04;
- popular desktop Linux distributions;
- macOS;
- VPS/server deployments.

Installer formats:

- terminal installer;
- PowerShell installer;
- shell installer;
- GUI installer;
- executable installer;
- Docker-based install;
- deb package later.

The user should be able to choose the installation method.

The installer should install required dependencies automatically where possible:

- Python;
- Node.js;
- Docker;
- Ollama;
- Playwright/Chromium;
- code-server/OpenVSCode;
- system service/startup integration.

The installer must support:

- local-only mode;
- LAN mode;
- external/VPS mode;
- HTTPS in VPS mode;
- startup after reboot;
- uninstall command;
- no requirement to preserve models/chats during reinstall unless export/backup is explicitly used.

## 10. MVP Definition

The current service is considered the MVP baseline, but it must be stabilized.

MVP must work well for:

- web interface;
- model configuration;
- official and non-official APIs;
- local Ollama models;
- arbitrary agents;
- chat history;
- OpenVSCode;
- terminal;
- browser access;
- GitHub basic workflow;
- Windows and Ubuntu install.

No feature should remain as a silent stub. If something is not implemented, UI must clearly say so.

## 11. Current Critical Problems

Highest priority issues:

1. Web UI is inconsistent and visually broken in some places.
2. Non-official API providers receive incorrect or unexpected requests and return 502/HTML errors.
3. Model routing and actual provider usage must be transparent.
4. Browser/internet tools must be unified under Browser access.
5. Installer must reliably install code-server/OpenVSCode, browser runtime, Ollama, Node.js, Python, and service startup on Windows and Ubuntu.
6. Light theme must be production quality.
7. Chat must be full-screen, modern, and suitable for long conversations.

## 12. Roadmap

### Phase 1: Stabilize MVP

- [x] Fix chat layout and composer.
- [x] Fix light theme.
- [x] Fix official and reseller API request formats.
- [x] Show actual provider/model/base URL/token usage.
- Make Browser the single internet tool.
- Make OpenVSCode/code-server install reliable on Ubuntu and Windows.
- Make terminal PTY reliable.
- Improve error messages.

### Phase 2: Agents And Models

- Arbitrary agent builder.
- Agent templates.
- Per-agent model selection.
- Tool permissions per agent.
- Local runtime adapters beyond Ollama.
- Hugging Face download and run workflow.
- Model resource validation.

### Phase 3: Workspaces And Coding

- Unlimited workspaces.
- Workspace switching.
- Project creation and cloning.
- File diff, approval, undo, snapshots.
- Deep link into OpenVSCode.
- Multi-terminal sessions.

### Phase 4: Browser And GitHub Automation

- Browser click/navigation workflows.
- Persistent browser sessions.
- Proxy/VPN support.
- GitHub repo creation, commit, push, PR.
- GitLab/Bitbucket planning.

### Phase 5: Security And Deployment

- HTTPS VPS deployment.
- Login system.
- 2FA.
- encrypted secrets.
- audit log.
- IP restrictions.
- role system if enterprise mode requires it.

### Phase 6: Commercial Features

- Prompt/input limits for free tier.
- Model marketplace.
- Agent template marketplace.
- Team workspace.
- Usage/cost analytics.
- Enterprise support.

## 13. Success Criteria

The product is successful when:

- a user can install it on Ubuntu Server and Windows without manual dependency debugging;
- a user can use local or cloud models interchangeably;
- reseller APIs work when configured with the right format/path;
- chat feels comparable to modern AI products;
- agents can safely edit code, run terminal commands, use browser, and operate GitHub;
- every risky action is visible, auditable, and controllable;
- beginner users understand what to do;
- advanced users can inspect everything.
