# DevAgent Hub

Custom OpenHands fork layer for managing multi-agent workflows. The project includes:

- OpenHands fork under `vendor/OpenHands` with Agent Studio API and settings UI.
- Multi-agent chain: Generator, Critic, Optimizer, Tester, Finalizer.
- Live/mock runner modes for Ollama, OpenAI-compatible providers, OpenRouter and custom endpoints.
- Terminal installer for Linux servers, plus an optional Electron launcher for desktop/dev use.
- Smoke tests for the isolated Agent Studio router, full OpenHands app, and installer workflow.

## Repository

GitHub: https://github.com/amave423/DevAgent-Hub

## Requirements

- Node.js 22.12+ for OpenHands frontend builds
- Python 3.12 recommended
- Git
- Docker for full OpenHands sandbox runtime
- Windows: Python Launcher `py` is supported and preferred by installer scripts

## Fast Checks

```powershell
npm run verify
```

This runs installer syntax checks, installer smoke, root web typecheck, isolated Agent Studio API smoke, and full OpenHands app smoke.

Individual checks:

```powershell
npm run check:installer
npm run smoke:installer
npm run typecheck
npm run smoke:agent-studio
npm run smoke:openhands-app
```

## Primary Server Install

Ubuntu/Debian server path:

```bash
git clone https://github.com/amave423/DevAgent-Hub.git
cd DevAgent-Hub
./install.sh
```

One-command bootstrap from an empty server:

```bash
curl -fsSL https://raw.githubusercontent.com/amave423/DevAgent-Hub/main/install.sh | bash
```

The terminal installer installs/checks Git, Python 3.12, Node.js 22.x, Docker and Ollama, clones the repository when needed, asks which models to enable, writes `configs/agents.json`, installs OpenHands dependencies, builds the OpenHands frontend, pulls selected Ollama models, runs smoke checks, and starts the background service.

Useful non-interactive example:

```bash
./install.sh --yes --models ollama-qwen25-coder-7b --model ollama-qwen25-coder-7b
```

Cloud example:

```bash
./install.sh --models openrouter-auto --model openrouter-auto --runner-mode live --cloud-provider openrouter --api-key "$OPENROUTER_API_KEY"
```

Only selected models are written to `configs/agents.json`, so the web UI shows that selected set rather than the full built-in catalog.

## Optional Desktop Installer

Development mode:

```powershell
npm run dev:installer
```

Build unpacked Electron app:

```powershell
npm run build:installer
```

Build distributables:

```powershell
npm run dist:installer:win
npm run dist:installer:linux
```

Artifacts are written to `installer/dist/` and are intentionally ignored by git.

The Electron launcher can:

- check Git, Docker, Node.js, npm and Python;
- generate `configs/agents.json`, `.env.local`, install plan and service files;
- run dependency installation/build/smoke commands with live logs;
- stop an active installation run;
- launch/stop OpenHands at `http://127.0.0.1:3000`;
- store cloud API keys through Electron `safeStorage` when OS encryption is available.

Electron is not required for Ubuntu Server installation. API keys are not written to `.env.local`. For terminal/headless service mode, the CLI writes `services/secrets.env` when `--api-key` is provided, or you can copy `services/secrets.env.example` manually.

## Background Services

Installer preparation generates service assets in `<install path>/services`.

Windows scheduled task:

```powershell
Set-Location "<install path>\services"
.\install-windows-task.ps1
.\uninstall-windows-task.ps1
```

Linux user systemd service:

```bash
cd "<install path>/services"
./install-linux-systemd.sh
./uninstall-linux-systemd.sh
```

The background service starts the OpenHands app on `127.0.0.1:3000` and reads `.env.local` plus optional `services/secrets.env`.

## OpenHands Agent Studio

The integrated backend lives in:

```text
vendor/OpenHands/openhands/app_server/agent_studio/
```

Routes are mounted under:

```text
/api/v1/agents/config
/api/v1/agents/run
/api/v1/agents/status/{task_id}
/api/v1/agents/cancel/{task_id}
/api/v1/agents/logs/{task_id}
```

The frontend settings screen is:

```text
vendor/OpenHands/frontend/src/routes/multi-agent-settings.tsx
```

It supports enabling/disabling agents, editing prompts, selecting among the models enabled during installation, moving agents by buttons or drag-and-drop, test runs, live logs, progress, and cancellation.

## Runtime Modes

Agent Studio supports:

- `auto`: try live model calls and fall back to mock on missing credentials/local model errors.
- `live`: require a live provider call.
- `mock`: deterministic simulated execution.

Set via UI or environment:

```powershell
$env:AGENT_STUDIO_RUNNER_MODE = "auto"
```

Provider keys can be passed through environment variables when not using the installer:

```powershell
$env:AGENT_STUDIO_OPENAI_API_KEY = "..."
$env:AGENT_STUDIO_OPENROUTER_API_KEY = "..."
$env:AGENT_STUDIO_API_KEY = "..."
```

Ollama defaults to:

```text
http://localhost:11434
```

## Manual OpenHands Launch

After dependencies are installed:

```powershell
$env:AGENT_STUDIO_CONFIG_PATH = "$PWD\configs\agents.json"
$env:OH_PERSISTENCE_DIR = "$PWD\.openhands"
$env:SERVE_FRONTEND = "true"
Push-Location vendor\OpenHands
.\.venv\Scripts\python.exe -m uvicorn openhands.app_server.app:app --app-dir . --host 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`.

## Notes for Restricted Networks

- Configure proxy in the installer before downloads.
- npm mirror can be configured with `npm config set registry <url>`.
- pip/uv can use mirror env vars or command-line index settings.
- For cloud providers blocked by network policy, use OpenRouter or a custom OpenAI-compatible base URL.
