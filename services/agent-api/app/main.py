from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config_store import ConfigStore
from .models import (
    AgentsConfig,
    GitCommitRequest,
    GitHubCreateRepoRequest,
    GitHubPullRequestRequest,
    GitPushRequest,
    RunAgentsRequest,
    RunAgentsResponse,
    SetGitRemoteRequest,
    StartOpenVSCodeRequest,
    TaskStatus,
    WorkspaceActionResponse,
    WorkspaceStatus,
)
from .task_runner import TERMINAL_STATUSES, TaskRegistry
from .terminal import TerminalManager
from .workspace_service import GitHubService, OpenVSCodeManager, WorkspaceService


app = FastAPI(title="DevAgent Hub API", version="0.2.0")
config_store = ConfigStore()
task_registry = TaskRegistry()
workspace_service = WorkspaceService()
openvscode_manager = OpenVSCodeManager(workspace_service.root)
github_service = GitHubService(workspace_service)
terminal_manager = TerminalManager(workspace_service.root)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

@app.get("/api/agents/config", response_model=AgentsConfig)
async def get_agents_config() -> AgentsConfig:
    try:
        return config_store.load()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/agents/config", response_model=AgentsConfig)
async def save_agents_config(config: AgentsConfig) -> AgentsConfig:
    return config_store.save(config)


@app.post("/api/agents/run", response_model=RunAgentsResponse)
async def run_agents(request: RunAgentsRequest) -> RunAgentsResponse:
    config = config_store.load()
    state = await task_registry.create(request, config)
    return RunAgentsResponse(taskId=state.taskId, status=TaskStatus.queued)


@app.get("/api/agents/status/{task_id}")
async def get_task_status(task_id: str):
    state = await task_registry.get_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return state


@app.post("/api/agents/cancel/{task_id}")
async def cancel_task(task_id: str):
    ok = await task_registry.cancel(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    state = await task_registry.get_state(task_id)
    return state


@app.get("/api/agents/logs/{task_id}")
async def stream_task_logs(task_id: str) -> StreamingResponse:
    if await task_registry.get_state(task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_stream():
        last_id = 0
        while True:
            logs = await task_registry.get_logs(task_id, after_id=last_id)
            if logs is None:
                yield sse("error", {"message": "Task not found"})
                return

            for log in logs:
                last_id = log.id
                yield sse("log", log.model_dump(mode="json"))

            state = await task_registry.get_state(task_id)
            if state and state.status in TERMINAL_STATUSES:
                yield sse("done", state.model_dump(mode="json"))
                return

            await asyncio.sleep(0.4)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Terminal
# ---------------------------------------------------------------------------

@app.websocket("/api/terminal/ws")
async def terminal_websocket(ws: WebSocket) -> None:
    await terminal_manager.handle(ws)


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

@app.get("/api/workspace/status", response_model=WorkspaceStatus)
async def get_workspace_status() -> WorkspaceStatus:
    return workspace_service.status(openvscode_manager)


@app.get("/api/workspace/files")
async def list_workspace_files(path: str = ".") -> list[dict[str, object]]:
    """Return a flat list of files/dirs under *path* relative to workspace root."""
    target = (workspace_service.root / path).resolve()
    try:
        target.relative_to(workspace_service.root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes workspace") from None

    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items: list[dict[str, object]] = []
    try:
        for entry in sorted(target.iterdir()):
            name = entry.name
            if name.startswith(".") and name not in {".env.example", ".env.sample"}:
                continue
            is_dir = entry.is_dir()
            items.append({
                "name": name,
                "path": str(entry.relative_to(workspace_service.root)).replace("\\", "/"),
                "isDirectory": is_dir,
                "size": entry.stat().st_size if not is_dir else 0,
            })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied") from None
    return items


@app.get("/api/workspace/files/content")
async def read_workspace_file(path: str) -> dict[str, str]:
    """Return file content for a given workspace-relative path."""
    target = (workspace_service.root / path).resolve()
    try:
        target.relative_to(workspace_service.root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes workspace") from None

    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    size = target.stat().st_size
    if size > 2_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 2 MB)")

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied") from None

    return {"path": path, "content": content}


@app.post("/api/workspace/openvscode/start", response_model=WorkspaceStatus)
async def start_openvscode(request: StartOpenVSCodeRequest) -> WorkspaceStatus:
    try:
        openvscode_manager.start(request)
        return workspace_service.status(openvscode_manager)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/workspace/openvscode/stop", response_model=WorkspaceStatus)
async def stop_openvscode() -> WorkspaceStatus:
    openvscode_manager.stop()
    return workspace_service.status(openvscode_manager)


@app.post("/api/workspace/openvscode/install", response_model=WorkspaceActionResponse)
async def install_openvscode() -> WorkspaceActionResponse:
    """Download and install OpenVSCode Server into .tools/."""
    try:
        result = openvscode_manager.install()
        return result
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Git
# ---------------------------------------------------------------------------

@app.post("/api/workspace/git/remote", response_model=WorkspaceActionResponse)
async def set_git_remote(request: SetGitRemoteRequest) -> WorkspaceActionResponse:
    try:
        return workspace_service.set_remote(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/workspace/git/commit", response_model=WorkspaceActionResponse)
async def commit_git_changes(request: GitCommitRequest) -> WorkspaceActionResponse:
    try:
        return workspace_service.commit(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/workspace/git/push", response_model=WorkspaceActionResponse)
async def push_git_changes(request: GitPushRequest) -> WorkspaceActionResponse:
    try:
        return workspace_service.push(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------

@app.post("/api/workspace/github/repos", response_model=WorkspaceActionResponse)
async def create_github_repo(request: GitHubCreateRepoRequest) -> WorkspaceActionResponse:
    try:
        return github_service.create_repo(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/workspace/github/pull-request", response_model=WorkspaceActionResponse)
async def create_github_pull_request(request: GitHubPullRequestRequest) -> WorkspaceActionResponse:
    try:
        return github_service.create_pull_request(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
