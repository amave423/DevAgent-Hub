# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

DevAgent Hub is a standalone multi-agent development workspace. It no longer depends on OpenHands at runtime. The web UI lives in `apps/web`, the backend lives in `services/agent-api`, and the installer prepares both for Windows 10 and Ubuntu 22.04/24.04.

The default multi-agent chain is **Generator -> Critic -> Optimizer -> Tester -> Finalizer**. The full model catalog is kept in `configs/agents.json`; installer-selected runtime models are written to `.devagent/agents.json`.

## Commands

```powershell
# Install dependencies
npm install

# Full verification
npm run verify

# Individual checks
npm run typecheck
npm run check:installer
npm run smoke:installer
npm run smoke:api
npm run build:web

# Development
npm run start:api
npm run dev:web

# Terminal installer
npm run install:cli
node installer/cli.js --prepare-only

# Optional Electron installer wrapper
npm run dev:installer
npm run build:installer
npm run dist:installer:win
npm run dist:installer:linux
```

## Architecture

### Frontend - `apps/web`

React 19 + TypeScript + Vite. The main workspace has tabs for Chat, Agents, Code, Terminal, Preview, GitHub, Logs, and Settings. Vite proxies `/api` and `/health` to `localhost:8000` in development.

### Backend - `services/agent-api`

FastAPI + Python 3.12. The backend exposes the agent API, SSE logs, workspace file API, terminal WebSocket, Git/GitHub operations, and OpenVSCode/code-server lifecycle endpoints. When `SERVE_FRONTEND=true`, it also serves the built React app from `apps/web/dist` on the same port.

### Config

`configs/agents.json` is the default model catalog. Runtime installer choices go into `.devagent/agents.json` and are selected through `AGENT_CONFIG_PATH` or the backend fallback.

### Installer - `installer/`

The terminal-first installer creates the Python venv, installs API dependencies, runs `npm install`, builds the web UI, optionally installs code-server, optionally pulls Ollama models, runs the API smoke test, and generates Windows Scheduled Task or Linux systemd user service files.

### Scripts - `scripts/`

Smoke tests and helpers. `run_python_script.js` discovers a usable Python interpreter from `.venv`, `python3.12`, `python3`, or `python`.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `AGENT_CONFIG_PATH` | Runtime agents config path, usually `.devagent/agents.json` |
| `DEVAGENT_WORKSPACE` | Workspace root directory |
| `DEVAGENT_WEB_DIST` | Built web UI path for service mode |
| `SERVE_FRONTEND` | `true` to serve `apps/web/dist` from FastAPI |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token for automation |
| `OPENVSCODE_URL` | External OpenVSCode/code-server URL |
| `OPENVSCODE_COMMAND` | Override command to start OpenVSCode/code-server |
| `DEVAGENT_ALLOW_EXTERNAL_WORKSPACE` | `1` to allow workspace paths outside root |
| `AGENT_STUDIO_RUNNER_MODE` | `auto`, `live`, or `mock` |

## Local Development

1. `npm install`
2. `py -3.12 -m venv .venv` on Windows, or `python3.12 -m venv .venv` on Linux
3. `.venv\Scripts\python.exe -m pip install -r services\agent-api\requirements.txt` on Windows, or `./.venv/bin/python -m pip install -r services/agent-api/requirements.txt` on Linux
4. Start backend: `npm run start:api`
5. Start frontend: `npm run dev:web`
6. Open `http://127.0.0.1:5173`
