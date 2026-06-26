from __future__ import annotations

import asyncio
import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config_store import ConfigStore
from .models import AgentsConfig, RunAgentsRequest, RunAgentsResponse, TaskStatus
from .task_runner import TERMINAL_STATUSES, TaskRegistry


app = FastAPI(title="AI Agent Studio API", version="0.1.0")
config_store = ConfigStore()
task_registry = TaskRegistry()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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


def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

