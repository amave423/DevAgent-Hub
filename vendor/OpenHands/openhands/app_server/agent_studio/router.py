from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from openhands.app_server.agent_studio.config_store import ConfigStore
from openhands.app_server.agent_studio.models import (
    AgentsConfig,
    RunAgentsRequest,
    RunAgentsResponse,
    TaskStatus,
)
from openhands.app_server.agent_studio.task_registry import (
    TERMINAL_STATUSES,
    TaskRegistry,
)


router = APIRouter(prefix='/agents', tags=['Agent Studio'])
config_store = ConfigStore()
task_registry = TaskRegistry()


@router.get('/config', response_model=AgentsConfig)
async def get_agents_config() -> AgentsConfig:
    return config_store.load()


@router.post('/config', response_model=AgentsConfig)
async def save_agents_config(config: AgentsConfig) -> AgentsConfig:
    return config_store.save(config)


@router.post('/run', response_model=RunAgentsResponse)
async def run_agents(request: RunAgentsRequest) -> RunAgentsResponse:
    config = config_store.load()
    state = await task_registry.create(request, config)
    return RunAgentsResponse(taskId=state.taskId, status=TaskStatus.queued)


@router.get('/status/{task_id}')
async def get_task_status(task_id: str):
    state = await task_registry.get_state(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return state


@router.post('/cancel/{task_id}')
async def cancel_task(task_id: str):
    state = await task_registry.cancel(task_id)
    if state is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return state


@router.get('/logs/{task_id}')
async def stream_task_logs(task_id: str) -> StreamingResponse:
    if await task_registry.get_state(task_id) is None:
        raise HTTPException(status_code=404, detail='Task not found')

    async def event_stream():
        last_id = 0
        while True:
            logs = await task_registry.get_logs(task_id, after_id=last_id)
            if logs is None:
                yield sse('error', {'message': 'Task not found'})
                return

            for log in logs:
                last_id = log.id
                yield sse('log', log.model_dump(mode='json'))

            state = await task_registry.get_state(task_id)
            if state and state.status in TERMINAL_STATUSES:
                yield sse('done', state.model_dump(mode='json'))
                return

            await asyncio.sleep(0.4)

    return StreamingResponse(event_stream(), media_type='text/event-stream')


def sse(event: str, payload: dict) -> str:
    return f'event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n'
