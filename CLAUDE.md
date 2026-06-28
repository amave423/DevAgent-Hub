# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevAgent Hub is a custom OpenHands fork layer for managing multi-agent AI workflows. The main web UI is built separately from OpenHands (in `apps/web`) and connects to a FastAPI backend (`services/agent-api`). OpenHands remains in `vendor/` as a reference/runtime component being gradually replaced.

The multi-agent chain: **Generator → Critic → Optimizer → Tester → Finalizer**, configurable via `configs/agents.json`.

## Commands

```powershell
# Install dependencies (root + workspaces)
npm install

# Run everything: installer syntax, smoke, typecheck, API smoke, OpenHands smoke
npm run verify

# Individual checks
npm run typecheck                  # TypeScript check for apps/web
npm run check:installer            # Node --check syntax for installer JS files
npm run smoke:installer            # End-to-end installer smoke (prepare + runner)
npm run smoke:devhub-api           # FastAPI backend smoke test
npm run smoke:agent-studio         # Agent Studio (OpenHands) API smoke
npm run smoke:openhands-app        # Full OpenHands app smoke

# Development
npm run dev:web                    # Vite dev server on :5173
npm start:api                      # FastAPI on :8000 (uvicorn with reload)
npm run build:web                  # TypeScript compile + Vite production build

# Electron installer (optional desktop launcher)
npm run dev:installer              # Run Electron app in dev mode
npm run build:installer            # Build unpacked Electron app
npm run dist:installer:win         # Windows distributable (NSIS + portable)
npm run dist:installer:linux       # Linux distributable (AppImage + deb)
```

## Architecture

### Frontend — `apps/web`

React 19 + TypeScript + Vite. Single-page IDE/dashboard panel with tabs: Chat, Agents, Code, Terminal, Preview, GitHub, Logs, Settings. Vite dev server proxies `/api` and `/health` to the backend at `localhost:8000`.

Key source files:
- `src/App.tsx` — main layout with all tab panels and state management (~42KB, single-file architecture)
- `src/types.ts` — shared TypeScript type definitions matching the backend Pydantic models
- `src/api/agents.ts` — agent config, run, and SSE log streaming client
- `src/api/workspace.ts` — workspace/OpenVSCode/Git/GitHub API client
- `src/components/agents/` — AgentConfigModal, AgentPanel, ThinkingDisplay
- `src/components/workspace/` — WorkspacePanel

No routing library — tab switching is internal state. No i18n library — RU/EN strings are inline with a language toggle.

### Backend — `services/agent-api`

FastAPI (Python 3.12, Pydantic v2). Runs as a single `uvicorn` process.

- `app/main.py` — FastAPI app with all route definitions, CORS for `localhost:5173`
- `app/models.py` — Pydantic models (mirrored by `apps/web/src/types.ts`)
- `app/config_store.py` — reads/writes `configs/agents.json` (path via `AGENT_CONFIG_PATH` env)
- `app/task_runner.py` — in-memory task registry with async workers; currently simulates agent steps (no live LLM calls yet)
- `app/workspace_service.py` — git operations (status, remote, commit, push), OpenVSCode Server lifecycle (start/stop/detect), GitHub API (create repo, create PR via `urllib`)

### Config — `configs/agents.json`

Central configuration defining available models (Ollama, OpenRouter, OpenAI), agent chain (id, order, modelId, systemPrompt), and runtime settings (runnerMode, timeouts). Only models selected during installation are written here.

### Installer — `installer/`

Terminal-first CLI (`cli.js` + `install-service.js` + `install-runner.js`). Optional Electron wrapper (`main.js`, `preload.js`, `renderer/`). The shell script `install.sh` is the Ubuntu/Debian entry point that installs system deps then delegates to `cli.js`.

### Vendor — `vendor/OpenHands`

Forked OpenHands runtime. The Agent Studio routes are mounted under `/api/v1/agents/`. Being gradually replaced by `services/agent-api`. The frontend settings screen is at `vendor/OpenHands/frontend/src/routes/multi-agent-settings.tsx`.

### Scripts — `scripts/`

Smoke tests. Python scripts (`smoke_devhub_api.py`, `smoke_agent_studio.py`, `smoke_openhands_app.py`) are invoked through `run_python_script.js`, which searches for a Python interpreter in several locations (vendor venv, root venv, `py -3.12`, `python3.12`, etc.).

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `AGENT_CONFIG_PATH` | Path to agents.json (default: `configs/agents.json`) |
| `DEVAGENT_WORKSPACE` | Workspace root directory (default: repo root) |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token for automation |
| `OPENVSCODE_URL` | External OpenVSCode Server URL |
| `OPENVSCODE_COMMAND` | Override command to start OpenVSCode Server |
| `DEVAGENT_ALLOW_EXTERNAL_WORKSPACE` | Set to `1` to allow workspace paths outside root |
| `AGENT_STUDIO_RUNNER_MODE` | `auto`, `live`, or `mock` |

## Type Safety

The backend Pydantic models (`services/agent-api/app/models.py`) and the frontend TypeScript types (`apps/web/src/types.ts`) are manually kept in sync. When changing one, update the other.

## Local Development

1. `npm install`
2. Start backend: `npm run start:api` (or manually with uvicorn pointing to `services/agent-api`)
3. Start frontend: `npm run dev:web`
4. Open `http://127.0.0.1:5173`

On Windows, Python is found via `.venv\Scripts\python.exe` or `py -3.12`. The `run_python_script.js` helper handles interpreter discovery for smoke tests.
