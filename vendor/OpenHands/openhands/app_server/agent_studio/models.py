from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ModelKind(str, Enum):
    local = 'local'
    cloud = 'cloud'
    none = 'none'


class TaskStatus(str, Enum):
    queued = 'queued'
    running = 'running'
    completed = 'completed'
    failed = 'failed'
    cancelled = 'cancelled'


class ModelRequirements(BaseModel):
    ramGb: int = Field(ge=0)
    diskGb: int = Field(ge=0)


class AgentModel(BaseModel):
    id: str = Field(min_length=2)
    name: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    kind: ModelKind
    baseUrl: str | None = None
    description: str = ''
    requirements: ModelRequirements = Field(
        default_factory=lambda: ModelRequirements(ramGb=0, diskGb=0)
    )


class AgentDefinition(BaseModel):
    id: str = Field(min_length=2)
    name: str = Field(min_length=1)
    enabled: bool = True
    order: int = Field(ge=1)
    modelId: str
    systemPrompt: str = Field(min_length=1)


class RuntimeConfig(BaseModel):
    maxParallelTasks: int = Field(default=2, ge=1, le=16)
    logRetention: int = Field(default=2000, ge=100, le=100000)
    runnerMode: Literal['auto', 'live', 'mock'] = 'auto'
    requestTimeoutSeconds: int = Field(default=120, ge=5, le=600)
    maxOutputChars: int = Field(default=12000, ge=1000, le=100000)


class AgentsConfig(BaseModel):
    version: int = 1
    models: list[AgentModel]
    agents: list[AgentDefinition]
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)


class RunAgentsRequest(BaseModel):
    task: str = Field(min_length=1)
    agents: list[AgentDefinition] | None = None
    modelOverrides: dict[str, str] = Field(default_factory=dict)


class RunAgentsResponse(BaseModel):
    taskId: str
    status: TaskStatus


class AgentLogEvent(BaseModel):
    id: int
    taskId: str
    timestamp: datetime
    agentId: str | None = None
    agentName: str | None = None
    level: Literal['info', 'debug', 'warning', 'error', 'success'] = 'info'
    phase: str
    message: str
    progress: int = Field(ge=0, le=100)


class TaskState(BaseModel):
    taskId: str
    status: TaskStatus
    task: str
    progress: int = Field(ge=0, le=100)
    createdAt: datetime
    updatedAt: datetime
    result: str | None = None
    error: str | None = None
    activeAgentId: str | None = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
