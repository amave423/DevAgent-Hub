from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ModelKind(str, Enum):
    local = "local"
    cloud = "cloud"
    none = "none"


class LocalModelSource(str, Enum):
    ollama = "ollama"
    huggingface = "huggingface"


class TaskStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class AgentRunMode(str, Enum):
    plan = "plan"
    coding = "coding"


class ActionPolicy(str, Enum):
    confirm = "confirm"
    auto_confirm = "auto-confirm"
    full_access = "full-access"


class ModelRequirements(BaseModel):
    ramGb: int = Field(ge=0)
    diskGb: int = Field(ge=0)


class AgentModel(BaseModel):
    id: str = Field(min_length=2)
    name: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    kind: ModelKind
    modelName: str | None = None
    baseUrl: str | None = None
    apiKeyEnv: str | None = None
    description: str = ""
    requirements: ModelRequirements = Field(default_factory=lambda: ModelRequirements(ramGb=0, diskGb=0))


class LLMUsage(BaseModel):
    promptTokens: int | None = None
    completionTokens: int | None = None
    totalTokens: int | None = None


class LLMCallResult(BaseModel):
    text: str = ""
    provider: str
    requestedModel: str
    resolvedModel: str | None = None
    baseUrl: str | None = None
    usage: LLMUsage | None = None
    finishReason: str | None = None
    latencyMs: int = Field(default=0, ge=0)
    rawUsageAvailable: bool = False


class LocalModelCatalogItem(BaseModel):
    id: str = Field(min_length=2)
    source: LocalModelSource
    name: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    description: str = ""
    requirements: ModelRequirements = Field(default_factory=lambda: ModelRequirements(ramGb=0, diskGb=0))
    modelName: str | None = None
    repoId: str | None = None
    filename: str | None = None
    runnable: bool = True
    installed: bool = False
    sizeBytes: int | None = None
    details: str | None = None


class CloudProviderPreset(BaseModel):
    id: str = Field(min_length=2)
    name: str = Field(min_length=1)
    baseUrl: str | None = None
    apiKeyEnv: str
    description: str = ""


class ModelCatalogResponse(BaseModel):
    localSources: list[LocalModelSource]
    localModels: list[LocalModelCatalogItem]
    cloudProviders: list[CloudProviderPreset]


class ModelDownloadRequest(BaseModel):
    modelId: str = Field(min_length=2)
    source: LocalModelSource | None = None
    modelName: str | None = None
    repoId: str | None = None
    filename: str | None = None
    displayName: str | None = None


class ModelSearchResponse(BaseModel):
    source: LocalModelSource
    models: list[LocalModelCatalogItem]


class ModelFileListResponse(BaseModel):
    repoId: str
    files: list[str]


class ModelDownloadState(BaseModel):
    downloadId: str
    modelId: str
    source: LocalModelSource
    status: TaskStatus
    progress: int = Field(ge=0, le=100)
    message: str = ""
    model: AgentModel | None = None
    modelName: str | None = None
    repoId: str | None = None
    filename: str | None = None
    displayName: str | None = None
    createdAt: datetime = Field(default_factory=utc_now)
    updatedAt: datetime = Field(default_factory=utc_now)


class AddCloudModelRequest(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1)
    modelName: str | None = None
    provider: str = Field(default="custom", min_length=2)
    baseUrl: str | None = None
    apiKeyEnv: str | None = None
    apiKey: str | None = None
    description: str = ""


class CloudModelTestRequest(BaseModel):
    name: str = Field(min_length=1)
    modelName: str | None = None
    provider: str = Field(default="custom", min_length=2)
    baseUrl: str | None = None
    apiKeyEnv: str | None = None
    apiKey: str | None = None


class CloudModelTestResponse(BaseModel):
    ok: bool
    message: str
    output: str = ""
    result: LLMCallResult | None = None


class AgentDefinition(BaseModel):
    id: str = Field(min_length=2)
    name: str = Field(min_length=1)
    enabled: bool = True
    order: int = Field(ge=1)
    modelId: str
    systemPrompt: str = ""


class RuntimeConfig(BaseModel):
    maxParallelTasks: int = Field(default=2, ge=1, le=16)
    logRetention: int = Field(default=2000, ge=100, le=100000)
    runnerMode: Literal["auto", "live", "mock"] = "auto"
    agentMode: AgentRunMode = AgentRunMode.plan
    actionPolicy: ActionPolicy = ActionPolicy.confirm
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
    mode: AgentRunMode | None = None
    actionPolicy: ActionPolicy | None = None
    chatId: str | None = None
    attachmentIds: list[str] = Field(default_factory=list)
    webSearch: bool = False


class RunAgentsResponse(BaseModel):
    taskId: str
    status: TaskStatus


class AgentLogEvent(BaseModel):
    id: int
    taskId: str
    timestamp: datetime
    agentId: str | None = None
    agentName: str | None = None
    level: Literal["info", "debug", "warning", "error", "success"] = "info"
    phase: str
    message: str
    progress: int = Field(ge=0, le=100)
    llm: LLMCallResult | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


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
    mode: AgentRunMode = AgentRunMode.plan
    actionPolicy: ActionPolicy = ActionPolicy.confirm
    chatId: str | None = None
    llmCalls: list[LLMCallResult] = Field(default_factory=list)


class RuntimeSettings(BaseModel):
    theme: Literal["dark", "light"] = "dark"
    agentMode: AgentRunMode = AgentRunMode.plan
    actionPolicy: ActionPolicy = ActionPolicy.confirm
    externalAccess: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=3000, ge=1, le=65535)
    authRequired: bool = False
    authTokenConfigured: bool = False
    urls: list[str] = Field(default_factory=list)
    webSearchEnabled: bool = False
    webSearchBaseUrl: str = ""


class SaveRuntimeSettingsRequest(BaseModel):
    theme: Literal["dark", "light"] | None = None
    agentMode: AgentRunMode | None = None
    actionPolicy: ActionPolicy | None = None
    webSearchEnabled: bool | None = None
    webSearchBaseUrl: str | None = None


class ActionStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class PendingAction(BaseModel):
    id: str
    title: str
    description: str = ""
    kind: Literal["file", "git", "terminal", "github", "model"]
    status: ActionStatus = ActionStatus.pending
    createdAt: datetime = Field(default_factory=utc_now)


class ActionDecisionResponse(BaseModel):
    ok: bool
    action: PendingAction


class GitStatus(BaseModel):
    available: bool
    isRepository: bool
    branch: str | None = None
    remoteUrl: str | None = None
    repository: str | None = None
    changes: list[str] = Field(default_factory=list)
    lastCommit: str | None = None
    message: str = ""


class OpenVSCodeStatus(BaseModel):
    configured: bool
    running: bool
    url: str | None = None
    pid: int | None = None
    command: str | None = None
    workspacePath: str
    message: str = ""


class GitHubStatus(BaseModel):
    tokenConfigured: bool
    owner: str | None = None
    repository: str | None = None
    remoteUrl: str | None = None
    message: str = ""


class WorkspaceStatus(BaseModel):
    rootPath: str
    git: GitStatus
    openVsCode: OpenVSCodeStatus
    github: GitHubStatus


class StartOpenVSCodeRequest(BaseModel):
    command: str | None = None
    host: str = "127.0.0.1"
    port: int = Field(default=3001, ge=1024, le=65535)
    workspacePath: str | None = None
    withoutConnectionToken: bool = True


class GitHubCreateRepoRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    visibility: Literal["private", "public"] = "private"
    owner: str | None = None


class GitCommitRequest(BaseModel):
    message: str = Field(min_length=1)
    files: list[str] = Field(default_factory=list)
    allowEmpty: bool = False


class GitPushRequest(BaseModel):
    remote: str = "origin"
    branch: str | None = None
    setUpstream: bool = True


class GitHubPullRequestRequest(BaseModel):
    owner: str = Field(min_length=1)
    repository: str = Field(min_length=1)
    title: str = Field(min_length=1)
    head: str = Field(min_length=1)
    base: str = "main"
    body: str = ""


class SetGitRemoteRequest(BaseModel):
    remote: str = "origin"
    url: str = Field(min_length=1)


class WorkspaceActionResponse(BaseModel):
    ok: bool
    message: str
    output: str = ""
    url: str | None = None


class ChatAttachment(BaseModel):
    id: str
    name: str
    path: str
    contentType: str = "application/octet-stream"
    size: int = Field(ge=0)
    createdAt: datetime = Field(default_factory=utc_now)


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant", "agent", "tool", "system"]
    content: str
    createdAt: datetime = Field(default_factory=utc_now)
    taskId: str | None = None
    status: TaskStatus | None = None
    attachments: list[ChatAttachment] = Field(default_factory=list)
    llmCalls: list[LLMCallResult] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatSession(BaseModel):
    id: str
    title: str
    createdAt: datetime = Field(default_factory=utc_now)
    updatedAt: datetime = Field(default_factory=utc_now)
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatSummary(BaseModel):
    id: str
    title: str
    createdAt: datetime
    updatedAt: datetime
    lastMessage: str = ""


class ChatCreateRequest(BaseModel):
    title: str | None = None


class ChatMessageRequest(BaseModel):
    role: Literal["user", "assistant", "agent", "tool", "system"] = "user"
    content: str = Field(min_length=1)
    attachmentIds: list[str] = Field(default_factory=list)


class ChatRunRequest(BaseModel):
    content: str = Field(min_length=1)
    attachmentIds: list[str] = Field(default_factory=list)
    mode: AgentRunMode | None = None
    actionPolicy: ActionPolicy | None = None
    agentIds: list[str] = Field(default_factory=list)
    webSearch: bool = False


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=5, ge=1, le=10)


class WebSearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""


class WebSearchResponse(BaseModel):
    query: str
    provider: str
    results: list[WebSearchResult]


class GitHubTokenRequest(BaseModel):
    token: str = Field(min_length=1)


class GitHubTokenTestResponse(BaseModel):
    ok: bool
    message: str
    login: str | None = None
    scopes: list[str] = Field(default_factory=list)
