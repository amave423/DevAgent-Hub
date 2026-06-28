from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

from .llm import get_provider
from .models import AgentDefinition, AgentLogEvent, AgentsConfig, RunAgentsRequest, TaskState, TaskStatus, utc_now


TERMINAL_STATUSES = {TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled}


@dataclass
class ManagedTask:
    state: TaskState
    logs: list[AgentLogEvent] = field(default_factory=list)
    worker: asyncio.Task[None] | None = None
    next_log_id: int = 1
    cancelled: bool = False


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

    async def cancel(self, task_id: str) -> bool:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return False
            task.cancelled = True
            if task.worker and not task.worker.done():
                task.worker.cancel()
            return True

    async def append_log(
        self,
        managed: ManagedTask,
        *,
        phase: str,
        message: str,
        progress: int,
        agent: AgentDefinition | None = None,
        level: str = "info",
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
            managed.state.activeAgentId = agent.id if agent else managed.state.activeAgentId

    async def _run(self, managed: ManagedTask, request: RunAgentsRequest, config: AgentsConfig) -> None:
        try:
            agents = select_agents(request, config)
            if not agents:
                raise ValueError("Нет включенных агентов для запуска цепочки.")

            managed.state.status = TaskStatus.running
            await self.append_log(
                managed,
                phase="queue",
                message="Задача принята и передана в мультиагентную цепочку.",
                progress=2,
            )

            step_weight = 90 / len(agents)
            accumulated = 5
            previous_output = request.task

            for agent in agents:
                if managed.cancelled:
                    raise asyncio.CancelledError()

                model_id = request.modelOverrides.get(agent.id, agent.modelId)
                model_info = next((m for m in config.models if m.id == model_id), None)
                provider_id = model_info.provider if model_info else "mock"

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="prompt",
                    message=f"{agent.name}: подготовка запроса для модели {model_id}.",
                    progress=round(accumulated),
                    level="debug",
                )

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="run",
                    message=f"{agent.name}: выполнение шага над текущим вариантом результата.",
                    progress=round(accumulated + step_weight * 0.45),
                )

                # Build messages for the LLM call
                messages = [
                    {"role": "system", "content": agent.systemPrompt},
                    {"role": "user", "content": previous_output},
                ]

                provider = get_provider(provider_id, model_info.model_dump() if model_info else None)
                model_name = model_info.name if model_info else model_id

                try:
                    result = await provider.chat(
                        model=model_name,
                        messages=messages,
                        temperature=0.7,
                        max_tokens=config.runtime.maxOutputChars,
                    )
                    previous_output = result or build_simulated_output(agent, previous_output)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    previous_output = build_simulated_output(agent, previous_output)
                    await self.append_log(
                        managed,
                        agent=agent,
                        phase="fallback",
                        message=f"{agent.name}: ошибка вызова модели ({exc}), использован fallback.",
                        progress=round(accumulated + step_weight * 0.7),
                        level="warning",
                    )

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="result",
                    message=f"{agent.name}: шаг завершен, результат передан дальше.",
                    progress=round(accumulated + step_weight * 0.85),
                    level="success",
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
                phase="complete",
                message="Цепочка агентов завершила выполнение.",
                progress=100,
                level="success",
            )
        except asyncio.CancelledError:
            async with self._lock:
                managed.state.status = TaskStatus.cancelled
                managed.state.updatedAt = utc_now()
            await self.append_log(
                managed,
                phase="cancelled",
                message="Задача отменена пользователем.",
                progress=managed.state.progress,
                level="warning",
            )
        except Exception as exc:
            async with self._lock:
                managed.state.status = TaskStatus.failed
                managed.state.error = str(exc)
                managed.state.updatedAt = utc_now()
            await self.append_log(
                managed,
                phase="error",
                message=str(exc),
                progress=managed.state.progress,
                level="error",
            )


def select_agents(request: RunAgentsRequest, config: AgentsConfig) -> list[AgentDefinition]:
    source = request.agents if request.agents is not None else config.agents
    return sorted((agent for agent in source if agent.enabled), key=lambda agent: agent.order)


def build_simulated_output(agent: AgentDefinition, input_text: str) -> str:
    compact = " ".join(input_text.strip().split())
    if len(compact) > 260:
        compact = compact[:257] + "..."
    return f"[{agent.name}] {compact}"
