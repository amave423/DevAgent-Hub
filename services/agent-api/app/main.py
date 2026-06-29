from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .chat_store import ChatStore
from .browser_service import BrowserService, extract_urls
from .config_store import ConfigStore
from .model_manager import ModelManager
from .models import (
    AddCloudModelRequest,
    ActionDecisionResponse,
    AgentsConfig,
    BrowserDownloadRequest,
    BrowserDownloadResponse,
    BrowserOpenRequest,
    BrowserPageResponse,
    BrowserScreenshotRequest,
    BrowserScreenshotResponse,
    BrowserStatusResponse,
    ChatCreateRequest,
    ChatMessage,
    ChatMessageRequest,
    ChatRunRequest,
    ChatSession,
    ChatSummary,
    CloudModelTestRequest,
    CloudModelTestResponse,
    GitCommitRequest,
    GitHubCreateRepoRequest,
    GitHubPullRequestRequest,
    GitHubTokenRequest,
    GitHubTokenTestResponse,
    GitPushRequest,
    ModelCatalogResponse,
    ModelDownloadRequest,
    ModelDownloadState,
    ModelFileListResponse,
    ModelSearchResponse,
    PendingAction,
    RuntimeSettings,
    RunAgentsRequest,
    RunAgentsResponse,
    SaveRuntimeSettingsRequest,
    SetGitRemoteRequest,
    StartOpenVSCodeRequest,
    TaskStatus,
    WorkspaceActionResponse,
    WorkspaceStatus,
    WebSearchRequest,
    WebSearchResponse,
)
from .runtime_settings import ActionRegistry, RuntimeSettingsStore
from .task_runner import TERMINAL_STATUSES, TaskRegistry
from .terminal import TerminalManager
from .web_search import WebSearchService
from .workspace_service import GitHubService, OpenVSCodeManager, WorkspaceService


app = FastAPI(title="DevAgent Hub API", version="0.2.0")
config_store = ConfigStore()
workspace_service = WorkspaceService()
chat_store = ChatStore(workspace_service.root)
task_registry = TaskRegistry(completion_handler=chat_store.complete_task)
model_manager = ModelManager(config_store, workspace_service.root)
openvscode_manager = OpenVSCodeManager(workspace_service.root)
github_service = GitHubService(workspace_service)
terminal_manager = TerminalManager(workspace_service.root)
runtime_settings_store = RuntimeSettingsStore(workspace_service.root)
action_registry = ActionRegistry()
web_search_service = WebSearchService()
browser_service = BrowserService(workspace_service.root)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\..*|192\.168\..*|172\.(1[6-9]|2[0-9]|3[0-1])\..*):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_auth_guard(request: Request, call_next):
    if request.method == "OPTIONS" or not requires_auth(request):
        return await call_next(request)
    return JSONResponse(
        status_code=401,
        content={"detail": "DevAgent Hub access token is required."},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.on_event("startup")
async def startup() -> None:
    maybe_start_openvscode()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Chats
# ---------------------------------------------------------------------------

@app.get("/api/chats", response_model=list[ChatSummary])
async def list_chats() -> list[ChatSummary]:
    return chat_store.list()


@app.post("/api/chats", response_model=ChatSession)
async def create_chat(request: ChatCreateRequest) -> ChatSession:
    return chat_store.create(request.title)


@app.get("/api/chats/{chat_id}", response_model=ChatSession)
async def get_chat(chat_id: str) -> ChatSession:
    try:
        return chat_store.get(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: str) -> dict[str, bool]:
    try:
        chat_store.delete(chat_id)
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@app.post("/api/chats/{chat_id}/messages", response_model=ChatMessage)
async def add_chat_message(chat_id: str, request: ChatMessageRequest) -> ChatMessage:
    try:
        return chat_store.add_message(
            chat_id,
            role=request.role,
            content=request.content,
            attachment_ids=request.attachmentIds,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@app.post("/api/chats/{chat_id}/attachments")
async def upload_chat_attachment(chat_id: str, request: Request, filename: str = "attachment"):
    try:
        data = await request.body()
        if len(data) > 5_000_000:
            raise HTTPException(status_code=413, detail="Attachment is too large. Max size is 5 MB.")
        return chat_store.save_attachment(
            chat_id,
            filename or "attachment",
            request.headers.get("content-type") or "application/octet-stream",
            data,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@app.post("/api/chats/{chat_id}/run", response_model=RunAgentsResponse)
async def run_chat(chat_id: str, request: ChatRunRequest) -> RunAgentsResponse:
    try:
        chat_store.get(chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc

    config = config_store.load()
    selected_agents = [agent for agent in config.agents if agent.enabled]
    if request.agentIds:
        allowed = set(request.agentIds)
        selected_agents = [agent for agent in selected_agents if agent.id in allowed]

    attachment_context = chat_store.attachment_context(chat_id, request.attachmentIds)
    search_context = ""
    browser_context = ""
    should_search = request.webSearch
    should_browse = request.browserAccess or should_auto_browse(request.content)
    if should_search:
        try:
            search_response = await web_search_service.search(
                request.content,
                base_url=runtime_settings_store.load().webSearchBaseUrl,
            )
            search_context = format_search_context(search_response)
            chat_store.add_message(
                chat_id,
                role="tool",
                content=search_context or "Web search returned no results.",
                metadata={"tool": "web_search", "response": search_response.model_dump(mode="json")},
            )
            if should_browse:
                browser_urls = [result.url for result in search_response.results[:3]]
                browser_context = await browser_service.browse_context_for_urls(browser_urls)
                if browser_context:
                    chat_store.add_message(
                        chat_id,
                        role="tool",
                        content=browser_context,
                        metadata={"tool": "browser", "source": "web_search_results"},
                    )
        except Exception as exc:
            search_context = f"[Web search error]\n{exc}"
            chat_store.add_message(
                chat_id,
                role="tool",
                content=search_context,
                metadata={"tool": "web_search", "error": str(exc)},
            )

    direct_urls = extract_urls(request.content)
    if should_browse and direct_urls:
        try:
            direct_browser_context = await browser_service.browse_context_for_urls(direct_urls)
            if direct_browser_context:
                browser_context = "\n\n".join(part for part in [browser_context, direct_browser_context] if part)
                chat_store.add_message(
                    chat_id,
                    role="tool",
                    content=direct_browser_context,
                    metadata={"tool": "browser", "source": "direct_urls"},
                )
            if should_auto_download(request.content):
                download_lines = []
                for url in direct_urls[:5]:
                    download = await browser_service.download(BrowserDownloadRequest(url=url))
                    download_lines.append(f"{download.url} -> {download.path} ({download.size} bytes)")
                if download_lines:
                    download_context = "[Browser downloads]\n" + "\n".join(download_lines)
                    browser_context = "\n\n".join(part for part in [browser_context, download_context] if part)
                    chat_store.add_message(
                        chat_id,
                        role="tool",
                        content=download_context,
                        metadata={"tool": "browser_download"},
                    )
        except Exception as exc:
            browser_context = "\n\n".join(part for part in [browser_context, f"[Browser error]\n{exc}"] if part)
            chat_store.add_message(
                chat_id,
                role="tool",
                content=f"[Browser error]\n{exc}",
                metadata={"tool": "browser", "error": str(exc)},
            )
    elif should_browse:
        try:
            browser_context = await browser_service.browse_context_for_query(request.content)
            if browser_context:
                chat_store.add_message(
                    chat_id,
                    role="tool",
                    content=browser_context,
                    metadata={"tool": "browser", "source": "browser_search"},
                )
        except Exception as exc:
            browser_context = f"[Browser error]\n{exc}"
            chat_store.add_message(
                chat_id,
                role="tool",
                content=browser_context,
                metadata={"tool": "browser", "error": str(exc)},
            )

    task_parts = [request.content]
    if attachment_context:
        task_parts.append("Attached files:\n" + attachment_context)
    if search_context:
        task_parts.append("Web search results:\n" + search_context)
    if browser_context:
        task_parts.append("Browser page content:\n" + browser_context)
    task_input = "\n\n".join(task_parts)

    run_request = RunAgentsRequest(
        task=task_input,
        agents=selected_agents,
        modelOverrides={agent.id: agent.modelId for agent in selected_agents},
        mode=request.mode,
        actionPolicy=request.actionPolicy,
        chatId=chat_id,
        attachmentIds=request.attachmentIds,
        webSearch=should_search,
        browserAccess=should_browse,
    )
    state = await task_registry.create(run_request, config)
    chat_store.add_message(
        chat_id,
        role="user",
        content=request.content,
        attachment_ids=request.attachmentIds,
        task_id=state.taskId,
        status=state.status,
    )
    return RunAgentsResponse(taskId=state.taskId, status=TaskStatus.queued)


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
    if request.mode is not None or request.actionPolicy is not None:
        config = config.model_copy(
            update={
                "runtime": config.runtime.model_copy(
                    update={
                        "agentMode": request.mode or config.runtime.agentMode,
                        "actionPolicy": request.actionPolicy or config.runtime.actionPolicy,
                    }
                )
            }
        )
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
# Models
# ---------------------------------------------------------------------------

@app.get("/api/models/catalog", response_model=ModelCatalogResponse)
async def get_model_catalog() -> ModelCatalogResponse:
    return model_manager.catalog()


@app.get("/api/models/search", response_model=ModelSearchResponse)
async def search_models(source: str, q: str = "", limit: int = 25) -> ModelSearchResponse:
    try:
        return model_manager.search(source, q, limit=max(1, min(limit, 50)))
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/models/ollama/search", response_model=ModelSearchResponse)
async def search_ollama_models(q: str = "", page: int = 1, limit: int = 25) -> ModelSearchResponse:
    try:
        # The current adapter returns the best available page from Ollama search/fallback.
        # Page is accepted for API compatibility and future server-side pagination.
        _ = page
        return model_manager.search("ollama", q, limit=max(1, min(limit, 50)))
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/models/huggingface/files", response_model=ModelFileListResponse)
async def list_huggingface_files(repo_id: str) -> ModelFileListResponse:
    try:
        return model_manager.huggingface_files(repo_id)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/models/local/download", response_model=ModelDownloadState)
async def download_local_model(request: ModelDownloadRequest) -> ModelDownloadState:
    try:
        return await model_manager.start_download(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/models/local/downloads", response_model=list[ModelDownloadState])
async def list_model_downloads() -> list[ModelDownloadState]:
    return model_manager.list_downloads()


@app.get("/api/models/local/downloads/{download_id}", response_model=ModelDownloadState)
async def get_model_download(download_id: str) -> ModelDownloadState:
    state = model_manager.get_download(download_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Model download not found")
    return state


@app.post("/api/models/local/downloads/{download_id}/retry", response_model=ModelDownloadState)
async def retry_model_download(download_id: str) -> ModelDownloadState:
    try:
        return await model_manager.retry_download(download_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Model download not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/api/models/local/{source}/{model_ref:path}", response_model=AgentsConfig)
async def delete_local_model(source: str, model_ref: str) -> AgentsConfig:
    try:
        return await model_manager.delete_local_model(source, model_ref)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/models/cloud", response_model=AgentsConfig)
async def add_cloud_model(request: AddCloudModelRequest) -> AgentsConfig:
    try:
        return model_manager.add_cloud_model(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/models/cloud/test", response_model=CloudModelTestResponse)
async def test_cloud_model(request: CloudModelTestRequest) -> CloudModelTestResponse:
    try:
        return await model_manager.test_cloud_model(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@app.post("/api/tools/web-search", response_model=WebSearchResponse)
async def web_search(request: WebSearchRequest) -> WebSearchResponse:
    try:
        settings = runtime_settings_store.load()
        return await web_search_service.search(
            request.query,
            limit=request.limit,
            base_url=settings.webSearchBaseUrl,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/tools/web-search/test", response_model=WebSearchResponse)
async def test_web_search(request: WebSearchRequest) -> WebSearchResponse:
    try:
        settings = runtime_settings_store.load()
        return await web_search_service.search(
            request.query,
            limit=request.limit,
            base_url=settings.webSearchBaseUrl,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/browser/status", response_model=BrowserStatusResponse)
async def browser_status() -> BrowserStatusResponse:
    return await browser_service.status()


@app.post("/api/browser/open", response_model=BrowserPageResponse)
async def browser_open(request: BrowserOpenRequest) -> BrowserPageResponse:
    try:
        return await browser_service.open(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/browser/screenshot", response_model=BrowserScreenshotResponse)
async def browser_screenshot(request: BrowserScreenshotRequest) -> BrowserScreenshotResponse:
    try:
        return await browser_service.screenshot(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/browser/download", response_model=BrowserDownloadResponse)
async def browser_download(request: BrowserDownloadRequest) -> BrowserDownloadResponse:
    try:
        return await browser_service.download(request)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Runtime settings and action policy
# ---------------------------------------------------------------------------

@app.get("/api/settings/runtime", response_model=RuntimeSettings)
async def get_runtime_settings() -> RuntimeSettings:
    return runtime_settings_store.load()


@app.post("/api/settings/runtime", response_model=RuntimeSettings)
async def save_runtime_settings(request: SaveRuntimeSettingsRequest) -> RuntimeSettings:
    settings = runtime_settings_store.save(request)
    try:
        config = config_store.load()
        config_store.save(
            config.model_copy(
                update={
                    "runtime": config.runtime.model_copy(
                        update={
                            "agentMode": settings.agentMode,
                            "actionPolicy": settings.actionPolicy,
                        }
                    )
                }
            )
        )
    except FileNotFoundError:
        pass
    return settings


@app.get("/api/actions", response_model=list[PendingAction])
async def list_actions() -> list[PendingAction]:
    return action_registry.list()


@app.post("/api/actions/{action_id}/approve", response_model=ActionDecisionResponse)
async def approve_action(action_id: str) -> ActionDecisionResponse:
    try:
        return ActionDecisionResponse(ok=True, action=action_registry.approve(action_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Action not found") from exc


@app.post("/api/actions/{action_id}/reject", response_model=ActionDecisionResponse)
async def reject_action(action_id: str) -> ActionDecisionResponse:
    try:
        return ActionDecisionResponse(ok=True, action=action_registry.reject(action_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Action not found") from exc


# ---------------------------------------------------------------------------
# Terminal
# ---------------------------------------------------------------------------

@app.websocket("/api/terminal/ws")
async def terminal_websocket(ws: WebSocket) -> None:
    if not websocket_authorized(ws):
        await ws.close(code=1008)
        return
    await terminal_manager.handle(ws)


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

@app.get("/api/workspace/status", response_model=WorkspaceStatus)
async def get_workspace_status() -> WorkspaceStatus:
    maybe_start_openvscode()
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
# OpenVSCode same-origin proxy
# ---------------------------------------------------------------------------

@app.api_route("/ide/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_openvscode_http(full_path: str, request: Request) -> Response:
    target_base = ensure_openvscode_running()
    if not target_base:
        raise HTTPException(status_code=404, detail="OpenVSCode Server is not running")

    target_url = f"{target_base}/{full_path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    headers = proxy_headers(dict(request.headers), target_base)
    body = await request.body()
    async with httpx.AsyncClient(follow_redirects=False, timeout=None, trust_env=False) as client:
        upstream = await client.request(request.method, target_url, headers=headers, content=body)

    content = upstream.content
    content_type = upstream.headers.get("content-type", "")
    if should_rewrite_openvscode_body(content_type):
        content = rewrite_openvscode_body(content, content_type)

    excluded_headers = {"connection", "content-encoding", "transfer-encoding", "keep-alive"}
    if should_rewrite_openvscode_body(content_type):
        excluded_headers.add("content-length")

    response_headers = {
        key: rewrite_proxy_header(key, value, target_base)
        for key, value in upstream.headers.items()
        if key.lower() not in excluded_headers
    }
    return Response(content=content, status_code=upstream.status_code, headers=response_headers)


@app.websocket("/ide/{full_path:path}")
async def proxy_openvscode_websocket(ws: WebSocket, full_path: str) -> None:
    target_base = ensure_openvscode_running()
    if not target_base:
        await ws.close(code=1011)
        return

    query = str(ws.url.query)
    target_url = target_base.replace("http://", "ws://").replace("https://", "wss://")
    target_url = f"{target_url}/{full_path}"
    if query:
        target_url = f"{target_url}?{query}"

    await ws.accept()
    try:
        try:
            upstream_context = websockets.connect(target_url, additional_headers={"Origin": target_base})
        except TypeError:
            upstream_context = websockets.connect(target_url, extra_headers={"Origin": target_base})

        async with upstream_context as upstream:
            async def client_to_upstream() -> None:
                while True:
                    message = await ws.receive()
                    if "text" in message:
                        await upstream.send(message["text"])
                    elif "bytes" in message:
                        await upstream.send(message["bytes"])

            async def upstream_to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await ws.send_bytes(message)
                    else:
                        await ws.send_text(message)

            await asyncio.gather(client_to_upstream(), upstream_to_client())
    except Exception:
        await ws.close()


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

@app.post("/api/github/token", response_model=GitHubTokenTestResponse)
async def save_github_token(request: GitHubTokenRequest) -> GitHubTokenTestResponse:
    try:
        return github_service.save_token(request.token)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/github/test", response_model=GitHubTokenTestResponse)
async def test_github_token() -> GitHubTokenTestResponse:
    try:
        return github_service.test_token()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/api/github/token", response_model=GitHubTokenTestResponse)
async def delete_github_token() -> GitHubTokenTestResponse:
    try:
        return github_service.delete_token()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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


def should_auto_search(content: str, settings: RuntimeSettings) -> bool:
    if not settings.webSearchEnabled:
        return False
    text = content.lower()
    markers = (
        "найди",
        "поиск",
        "интернет",
        "сегодня",
        "актуаль",
        "latest",
        "current",
        "today",
        "search",
        "web",
    )
    return any(marker in text for marker in markers)


def should_auto_browse(content: str) -> bool:
    text = content.lower()
    markers = (
        "открой сайт",
        "прочитай сайт",
        "прочитай страницу",
        "скачай",
        "download",
        "open the site",
        "read this page",
        "read the page",
    )
    return bool(extract_urls(content)) and any(marker in text for marker in markers)


def should_auto_download(content: str) -> bool:
    text = content.lower()
    return any(marker in text for marker in ("скачай", "загрузи файл", "download", "save file"))


def format_search_context(response: WebSearchResponse) -> str:
    lines = [f"Search query: {response.query}", f"Provider: {response.provider}"]
    for index, item in enumerate(response.results, start=1):
        snippet = f" - {item.snippet}" if item.snippet else ""
        lines.append(f"{index}. {item.title}\n   {item.url}{snippet}")
    return "\n".join(lines)


def requires_auth(request: Request) -> bool:
    token = os.getenv("DEVAGENT_AUTH_TOKEN")
    if not token:
        return False
    if not request.url.path.startswith("/api"):
        return False
    if is_local_client(request.client.host if request.client else ""):
        return False
    return not token_matches(request.headers.get("x-devagent-token"), request.headers.get("authorization"), request.query_params.get("token"))


def websocket_authorized(ws: WebSocket) -> bool:
    token = os.getenv("DEVAGENT_AUTH_TOKEN")
    if not token:
        return True
    if is_local_client(ws.client.host if ws.client else ""):
        return True
    return token_matches(ws.headers.get("x-devagent-token"), ws.headers.get("authorization"), ws.query_params.get("token"))


def token_matches(header_token: str | None, authorization: str | None, query_token: str | None) -> bool:
    expected = os.getenv("DEVAGENT_AUTH_TOKEN")
    if not expected:
        return True
    candidates = [header_token, query_token]
    if authorization and authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())
    return any(candidate == expected for candidate in candidates if candidate)


def is_local_client(host: str) -> bool:
    return host in {"127.0.0.1", "::1", "localhost"} or host.startswith("127.")


def maybe_start_openvscode() -> None:
    if os.getenv("DEVAGENT_AUTOSTART_IDE", "1").lower() in {"0", "false", "no"}:
        return
    if openvscode_manager.target_url():
        return
    try:
        openvscode_manager.start(
            StartOpenVSCodeRequest(
                host="127.0.0.1",
                port=int(os.getenv("OPENVSCODE_PORT", "3001") or "3001"),
                withoutConnectionToken=True,
            )
        )
    except Exception:
        return


def ensure_openvscode_running() -> str | None:
    maybe_start_openvscode()
    return openvscode_manager.target_url()


def proxy_headers(headers: dict[str, str], target_base: str) -> dict[str, str]:
    target = httpx.URL(target_base)
    ignored = {"host", "connection", "content-length", "accept-encoding"}
    result = {key: value for key, value in headers.items() if key.lower() not in ignored}
    result["host"] = target.netloc.decode() if isinstance(target.netloc, bytes) else str(target.netloc)
    result["origin"] = target_base
    return result


def rewrite_proxy_header(key: str, value: str, target_base: str) -> str:
    if key.lower() == "location" and value.startswith(target_base):
        return value.replace(target_base, "/ide", 1)
    return value


def should_rewrite_openvscode_body(content_type: str) -> bool:
    return any(
        marker in content_type.lower()
        for marker in ("text/html", "text/css", "javascript", "application/json")
    )


def rewrite_openvscode_body(content: bytes, content_type: str) -> bytes:
    text = content.decode("utf-8", errors="replace")
    replacements = {
        'href="/': 'href="/ide/',
        'src="/': 'src="/ide/',
        'action="/': 'action="/ide/',
        'url(/': 'url(/ide/',
        '"webview/': '"ide/webview/',
        '"/static/': '"/ide/static/',
        "'/static/": "'/ide/static/",
        '"/vscode/': '"/ide/vscode/',
        "'/vscode/": "'/ide/vscode/",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.encode("utf-8")


def maybe_mount_frontend() -> None:
    default_dist = Path(__file__).resolve().parents[3] / "apps" / "web" / "dist"
    dist_path = Path(os.getenv("DEVAGENT_WEB_DIST", str(default_dist))).resolve()
    index_path = dist_path / "index.html"
    assets_path = dist_path / "assets"

    if not index_path.exists():
        return

    serve_frontend = os.getenv("SERVE_FRONTEND", "").lower() in {"1", "true", "yes"}
    if not serve_frontend and not os.getenv("DEVAGENT_WEB_DIST"):
        return

    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str) -> FileResponse:
        if full_path.startswith(("api/", "health")):
            raise HTTPException(status_code=404, detail="Not found")

        requested = (dist_path / full_path).resolve()
        try:
            requested.relative_to(dist_path)
        except ValueError:
            requested = index_path

        if requested.is_file():
            return FileResponse(requested)

        return FileResponse(index_path)


maybe_mount_frontend()
