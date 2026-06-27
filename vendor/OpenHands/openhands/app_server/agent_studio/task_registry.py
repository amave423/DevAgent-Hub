from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

from openhands.app_server.agent_studio.models import (
    AgentDefinition,
    AgentLogEvent,
    AgentModel,
    AgentsConfig,
    RunAgentsRequest,
    TaskState,
    TaskStatus,
    utc_now,
)
from openhands.app_server.agent_studio.model_runner import AgentModelRunner


TERMINAL_STATUSES = {
    TaskStatus.completed,
    TaskStatus.failed,
    TaskStatus.cancelled,
}


@dataclass
class ManagedTask:
    state: TaskState
    logs: list[AgentLogEvent] = field(default_factory=list)
    worker: asyncio.Task[None] | None = None
    next_log_id: int = 1


class TaskRegistry:
    def __init__(self) -> None:
        self._tasks: dict[str, ManagedTask] = {}
        self._lock = asyncio.Lock()

    async def create(self, request: RunAgentsRequest, config: AgentsConfig) -> TaskState:
        task_id = str(uuid.uuid4())
        now = utc_now()
        state = TaskState(
            taskId=task_id,
            status=TaskStatus.queued,
            task=request.task,
            progress=0,
            createdAt=now,
            updatedAt=now,
        )
        managed = ManagedTask(state=state)
        async with self._lock:
            self._tasks[task_id] = managed
        managed.worker = asyncio.create_task(self._run(managed, request, config))
        return state

    async def get_state(self, task_id: str) -> TaskState | None:
        async with self._lock:
            task = self._tasks.get(task_id)
            return task.state if task else None

    async def get_logs(self, task_id: str, after_id: int = 0) -> list[AgentLogEvent] | None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            return [log for log in task.logs if log.id > after_id]

    async def append_log(
        self,
        managed: ManagedTask,
        *,
        phase: str,
        message: str,
        progress: int,
        agent: AgentDefinition | None = None,
        level: str = 'info',
    ) -> None:
        async with self._lock:
            log = AgentLogEvent(
                id=managed.next_log_id,
                taskId=managed.state.taskId,
                timestamp=utc_now(),
                agentId=agent.id if agent else None,
                agentName=agent.name if agent else None,
                phase=phase,
                message=message,
                progress=progress,
                level=level,  # type: ignore[arg-type]
            )
            managed.next_log_id += 1
            managed.logs.append(log)
            managed.state.progress = progress
            managed.state.updatedAt = log.timestamp
            managed.state.activeAgentId = (
                agent.id if agent else managed.state.activeAgentId
            )

    async def _run(
        self,
        managed: ManagedTask,
        request: RunAgentsRequest,
        config: AgentsConfig,
    ) -> None:
        try:
            agents = select_agents(request, config)
            if not agents:
                raise ValueError('No enabled agents are available for the chain.')

            model_by_id = {model.id: model for model in config.models}
            runner = AgentModelRunner(
                mode=config.runtime.runnerMode,
                timeout_seconds=config.runtime.requestTimeoutSeconds,
                max_output_chars=config.runtime.maxOutputChars,
            )
            managed.state.status = TaskStatus.running
            await self.append_log(
                managed,
                phase='queue',
                message=(
                    f'Task accepted by the multi-agent chain ({runner.mode} mode).'
                ),
                progress=2,
            )

            step_weight = 90 / len(agents)
            accumulated = 5
            previous_output = request.task

            for agent in agents:
                model = resolve_model(agent, request, model_by_id)
                await self.append_log(
                    managed,
                    agent=agent,
                    phase='prompt',
                    message=(
                        f'{agent.name}: preparing prompt for '
                        f'{model.provider}/{model.name}.'
                    ),
                    progress=round(accumulated),
                    level='debug',
                )

                await self.append_log(
                    managed,
                    agent=agent,
                    phase='run',
                    message=(
                        f'{agent.name}: running chain step with {model.name}.'
                    ),
                    progress=round(accumulated + step_weight * 0.45),
                )

                step_result = await runner.run_step(
                    agent=agent,
                    model=model,
                    original_task=request.task,
                    input_text=previous_output,
                )
                previous_output = step_result.output

                if step_result.fallback_reason:
                    await self.append_log(
                        managed,
                        agent=agent,
                        phase='fallback',
                        message=(
                            f'{agent.name}: using simulated fallback because '
                            f'{step_result.fallback_reason}'
                        ),
                        progress=round(accumulated + step_weight * 0.65),
                        level='warning',
                    )

                await self.append_log(
                    managed,
                    agent=agent,
                    phase='result',
                    message=result_message(agent, step_result.used_live_model),
                    progress=round(accumulated + step_weight * 0.85),
                    level='success',
                )
                accumulated += step_weight

            async with self._lock:
                managed.state.status = TaskStatus.completed
                managed.state.progress = 100
                managed.state.result = previous_output
                managed.state.activeAgentId = None
                managed.state.updatedAt = utc_now()

            await self.append_log(
                managed,
                phase='complete',
                message='Multi-agent chain completed.',
                progress=100,
                level='success',
            )
        except Exception as exc:
            async with self._lock:
                managed.state.status = TaskStatus.failed
                managed.state.error = str(exc)
                managed.state.activeAgentId = None
                managed.state.updatedAt = utc_now()
            await self.append_log(
                managed,
                phase='error',
                message=str(exc),
                progress=managed.state.progress,
                level='error',
            )


def select_agents(
    request: RunAgentsRequest,
    config: AgentsConfig,
) -> list[AgentDefinition]:
    source = request.agents if request.agents is not None else config.agents
    return sorted((agent for agent in source if agent.enabled), key=lambda agent: agent.order)


def resolve_model(
    agent: AgentDefinition,
    request: RunAgentsRequest,
    model_by_id: dict[str, AgentModel],
) -> AgentModel:
    model_id = request.modelOverrides.get(agent.id, agent.modelId)
    model = model_by_id.get(model_id)
    if model is None:
        raise ValueError(
            f'Model "{model_id}" configured for {agent.name} was not found.'
        )
    return model


def result_message(agent: AgentDefinition, used_live_model: bool) -> str:
    source = 'live model' if used_live_model else 'simulated runner'
    return f'{agent.name}: step completed by {source}.'
