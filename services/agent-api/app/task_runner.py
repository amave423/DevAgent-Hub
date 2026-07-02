from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from .llm import get_provider
from .models import AgentDefinition, AgentLogEvent, AgentsConfig, LLMCallResult, RunAgentsRequest, TaskState, TaskStatus, utc_now


TERMINAL_STATUSES = {TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled}


@dataclass
class ManagedTask:
    state: TaskState
    logs: list[AgentLogEvent] = field(default_factory=list)
    worker: asyncio.Task[None] | None = None
    next_log_id: int = 1
    cancelled: bool = False


class TaskRegistry:
    def __init__(
        self,
        completion_handler: Callable[[TaskState, list[AgentLogEvent]], Awaitable[None]] | None = None,
    ) -> None:
        self._tasks: dict[str, ManagedTask] = {}
        self._lock = asyncio.Lock()
        self._completion_handler = completion_handler

    def set_completion_handler(
        self,
        completion_handler: Callable[[TaskState, list[AgentLogEvent]], Awaitable[None]] | None,
    ) -> None:
        self._completion_handler = completion_handler

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
            mode=request.mode or config.runtime.agentMode,
            actionPolicy=request.actionPolicy or config.runtime.actionPolicy,
            chatId=request.chatId,
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
        llm: LLMCallResult | None = None,
        metadata: dict[str, object] | None = None,
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
                progress=max(0, min(100, progress)),
                level=level,  # type: ignore[arg-type]
                llm=llm,
                metadata=metadata or {},
            )
            managed.next_log_id += 1
            managed.logs.append(log)
            managed.state.progress = log.progress
            managed.state.updatedAt = log.timestamp
            managed.state.activeAgentId = agent.id if agent else managed.state.activeAgentId
            if llm:
                managed.state.llmCalls.append(llm)

    async def _run(self, managed: ManagedTask, request: RunAgentsRequest, config: AgentsConfig) -> None:
        try:
            agents = select_agents(request, config)
            if not agents:
                raise ValueError("No enabled agents are available for this run.")

            run_mode = request.mode or config.runtime.agentMode
            action_policy = request.actionPolicy or config.runtime.actionPolicy
            reasoning_level = request.reasoningLevel or config.runtime.reasoningLevel
            managed.state.status = TaskStatus.running
            managed.state.mode = run_mode
            managed.state.actionPolicy = action_policy
            await self.append_log(
                managed,
                phase="queue",
                message=(
                    f"Task accepted. Mode: {run_mode.value}; "
                    f"action policy: {action_policy.value}; "
                    f"reasoning: {reasoning_level.value}."
                ),
                progress=0,
            )

            previous_output = request.task

            for index, agent in enumerate(agents):
                if managed.cancelled:
                    raise asyncio.CancelledError()

                model_id = request.modelOverrides.get(agent.id, agent.modelId)
                model_info = next((m for m in config.models if m.id == model_id), None)
                if config.runtime.runnerMode == "mock":
                    provider_id = "mock"
                else:
                    if model_info is None:
                        raise RuntimeError(f"{agent.name}: model '{model_id}' was not found in config.")
                    provider_id = model_info.provider
                progress_before = round((index / len(agents)) * 100)
                progress_after = round(((index + 1) / len(agents)) * 100)

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="prompt",
                    message=f"{agent.name}: preparing prompt for {model_id}.",
                    progress=progress_before,
                    level="debug",
                )

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="run",
                    message=f"{agent.name}: running model step.",
                    progress=progress_before,
                )

                system_prompt = agent.systemPrompt.strip() or default_system_prompt(agent.name, run_mode.value)
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": previous_output},
                ]

                provider = get_provider(provider_id, model_info.model_dump() if model_info else None)
                model_name = (model_info.modelName or model_info.name) if model_info else model_id

                try:
                    result = await provider.chat(
                        model=model_name,
                        messages=messages,
                        temperature=0.7,
                        max_tokens=llm_max_tokens(config.runtime.maxOutputChars),
                    )
                    if not result.text.strip():
                        raise RuntimeError(f"{agent.name}: model returned an empty response.")
                    previous_output = result.text
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    if config.runtime.runnerMode == "mock" or provider_id == "mock":
                        previous_output = build_simulated_output(agent, previous_output)
                        await self.append_log(
                            managed,
                            agent=agent,
                            phase="fallback",
                            message=f"{agent.name}: mock output was used.",
                            progress=progress_after,
                            level="warning",
                        )
                    else:
                        raise RuntimeError(f"{agent.name}: model call failed: {exc}") from exc

                await self.append_log(
                    managed,
                    agent=agent,
                    phase="result",
                    message=build_result_message(agent.name, result if "result" in locals() else None),
                    progress=progress_after,
                    level="success",
                    llm=result if "result" in locals() else None,
                )
                if "result" in locals():
                    del result

            async with self._lock:
                managed.state.status = TaskStatus.completed
                managed.state.progress = 100
                managed.state.result = previous_output
                managed.state.activeAgentId = None
                managed.state.updatedAt = utc_now()

            await self.append_log(
                managed,
                phase="complete",
                message="Agent chain completed.",
                progress=100,
                level="success",
            )
            await self._notify_completion(managed)
        except asyncio.CancelledError:
            async with self._lock:
                managed.state.status = TaskStatus.cancelled
                managed.state.updatedAt = utc_now()
            await self.append_log(
                managed,
                phase="cancelled",
                message="Task was cancelled by the user.",
                progress=managed.state.progress,
                level="warning",
            )
            await self._notify_completion(managed)
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
            await self._notify_completion(managed)

    async def _notify_completion(self, managed: ManagedTask) -> None:
        if not self._completion_handler:
            return
        state = managed.state.model_copy(deep=True)
        logs = [log.model_copy(deep=True) for log in managed.logs]
        try:
            await self._completion_handler(state, logs)
        except Exception:
            return


def select_agents(request: RunAgentsRequest, config: AgentsConfig) -> list[AgentDefinition]:
    source = request.agents if request.agents is not None else config.agents
    return sorted((agent for agent in source if agent.enabled), key=lambda agent: agent.order)


def build_simulated_output(agent: AgentDefinition, input_text: str) -> str:
    compact = " ".join(input_text.strip().split())
    if len(compact) > 260:
        compact = compact[:257] + "..."
    return f"[mock:{agent.name}] {compact}"


def default_system_prompt(agent_name: str, mode: str) -> str:
    return (
        f"You are {agent_name}, an AI software-development assistant. "
        f"Work in {mode} mode. Be concrete, honest about failures, and avoid pretending actions succeeded."
    )


def build_result_message(agent_name: str, result: LLMCallResult | None) -> str:
    if result is None:
        return f"{agent_name}: step completed."
    usage = result.usage.totalTokens if result.usage and result.usage.totalTokens is not None else None
    usage_text = f", tokens={usage}" if usage is not None else ", tokens not returned"
    resolved = result.resolvedModel or result.requestedModel
    return f"{agent_name}: completed via {result.provider}/{resolved}{usage_text}, {result.latencyMs}ms."


def llm_max_tokens(max_output_chars: int) -> int:
    return max(256, min(max_output_chars, 4096))
