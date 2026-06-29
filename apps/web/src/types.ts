export type ModelKind = "local" | "cloud" | "none";
export type LocalModelSource = "ollama" | "huggingface";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type LogLevel = "info" | "debug" | "warning" | "error" | "success";
export type AppLanguage = "ru" | "en";
export type AppTheme = "dark" | "light";
export type AgentRunMode = "plan" | "coding";
export type ActionPolicy = "confirm" | "auto-confirm" | "full-access";
export type WorkbenchTab =
  | "chat"
  | "agents"
  | "code"
  | "terminal"
  | "preview"
  | "github"
  | "logs"
  | "settings";
export type ModelPurposeId =
  | "planning"
  | "coding"
  | "review"
  | "testing"
  | "final";

export interface ModelRequirements {
  ramGb: number;
  diskGb: number;
}

export interface AgentModel {
  id: string;
  name: string;
  provider: string;
  kind: ModelKind;
  modelName?: string | null;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  description: string;
  requirements: ModelRequirements;
}

export interface LLMUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface LLMCallResult {
  text: string;
  provider: string;
  requestedModel: string;
  resolvedModel?: string | null;
  baseUrl?: string | null;
  usage?: LLMUsage | null;
  finishReason?: string | null;
  latencyMs: number;
  rawUsageAvailable: boolean;
}

export interface LocalModelCatalogItem {
  id: string;
  source: LocalModelSource;
  name: string;
  provider: string;
  description: string;
  requirements: ModelRequirements;
  modelName?: string | null;
  repoId?: string | null;
  filename?: string | null;
  runnable: boolean;
  installed?: boolean;
  sizeBytes?: number | null;
  details?: string | null;
}

export interface CloudProviderPreset {
  id: string;
  name: string;
  baseUrl?: string | null;
  apiKeyEnv: string;
  description: string;
}

export interface ModelCatalogResponse {
  localSources: LocalModelSource[];
  localModels: LocalModelCatalogItem[];
  cloudProviders: CloudProviderPreset[];
}

export interface ModelDownloadRequest {
  modelId: string;
  source?: LocalModelSource | null;
  modelName?: string | null;
  repoId?: string | null;
  filename?: string | null;
  displayName?: string | null;
}

export interface ModelSearchResponse {
  source: LocalModelSource;
  models: LocalModelCatalogItem[];
}

export interface ModelFileListResponse {
  repoId: string;
  files: string[];
}

export interface ModelDownloadState {
  downloadId: string;
  modelId: string;
  source: LocalModelSource;
  status: TaskStatus;
  progress: number;
  message: string;
  model?: AgentModel | null;
  modelName?: string | null;
  repoId?: string | null;
  filename?: string | null;
  displayName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddCloudModelRequest {
  id?: string | null;
  name: string;
  modelName?: string | null;
  provider: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  apiKey?: string | null;
  description?: string;
}

export interface CloudModelTestRequest {
  name: string;
  modelName?: string | null;
  provider: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  apiKey?: string | null;
}

export interface CloudModelTestResponse {
  ok: boolean;
  message: string;
  output: string;
  result?: LLMCallResult | null;
}

export interface AgentDefinition {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  modelId: string;
  systemPrompt: string;
}

export interface RuntimeConfig {
  maxParallelTasks: number;
  logRetention: number;
  runnerMode: "auto" | "live" | "mock";
  agentMode: AgentRunMode;
  actionPolicy: ActionPolicy;
  requestTimeoutSeconds: number;
  maxOutputChars: number;
}

export interface AgentsConfig {
  version: number;
  models: AgentModel[];
  agents: AgentDefinition[];
  runtime: RuntimeConfig;
}

export interface RunAgentsResponse {
  taskId: string;
  status: TaskStatus;
}

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  task: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result?: string | null;
  error?: string | null;
  activeAgentId?: string | null;
  mode: AgentRunMode;
  actionPolicy: ActionPolicy;
  chatId?: string | null;
  llmCalls: LLMCallResult[];
}

export interface AgentLogEvent {
  id: number;
  taskId: string;
  timestamp: string;
  agentId?: string | null;
  agentName?: string | null;
  level: LogLevel;
  phase: string;
  message: string;
  progress: number;
  llm?: LLMCallResult | null;
  metadata: Record<string, unknown>;
}

export interface ModelPurpose {
  id: ModelPurposeId;
  label: string;
  description: string;
  modelId: string;
}

export interface DevHubSettings {
  language: AppLanguage;
  theme: AppTheme;
  openVsCodeUrl: string;
  previewUrl: string;
  githubOwner: string;
  githubDefaultVisibility: "private" | "public";
  modelPurposes: ModelPurpose[];
  webSearchEnabled: boolean;
  webSearchBaseUrl: string;
}

export interface RuntimeSettings {
  theme: AppTheme;
  agentMode: AgentRunMode;
  actionPolicy: ActionPolicy;
  externalAccess: boolean;
  host: string;
  port: number;
  authRequired: boolean;
  authTokenConfigured: boolean;
  urls: string[];
  webSearchEnabled: boolean;
  webSearchBaseUrl: string;
}

export interface IntegrationStatus {
  id: string;
  label: string;
  status: "connected" | "not_configured" | "planned";
  detail: string;
}

export interface GitStatus {
  available: boolean;
  isRepository: boolean;
  branch?: string | null;
  remoteUrl?: string | null;
  repository?: string | null;
  changes: string[];
  lastCommit?: string | null;
  message: string;
}

export interface OpenVSCodeStatus {
  configured: boolean;
  running: boolean;
  url?: string | null;
  pid?: number | null;
  command?: string | null;
  workspacePath: string;
  message: string;
}

export interface GitHubStatus {
  tokenConfigured: boolean;
  owner?: string | null;
  repository?: string | null;
  remoteUrl?: string | null;
  message: string;
}

export interface WorkspaceStatus {
  rootPath: string;
  git: GitStatus;
  openVsCode: OpenVSCodeStatus;
  github: GitHubStatus;
}

export interface StartOpenVSCodeRequest {
  command?: string | null;
  host?: string;
  port?: number;
  workspacePath?: string | null;
  withoutConnectionToken?: boolean;
}

export interface WorkspaceActionResponse {
  ok: boolean;
  message: string;
  output: string;
  url?: string | null;
}

export interface ChatAttachment {
  id: string;
  name: string;
  path: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "agent" | "tool" | "system";
  content: string;
  createdAt: string;
  taskId?: string | null;
  status?: TaskStatus | null;
  attachments: ChatAttachment[];
  llmCalls: LLMCallResult[];
  metadata: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
}

export interface ChatRunRequest {
  content: string;
  attachmentIds: string[];
  mode?: AgentRunMode | null;
  actionPolicy?: ActionPolicy | null;
  agentIds: string[];
  webSearch: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: WebSearchResult[];
}

export interface GitHubTokenTestResponse {
  ok: boolean;
  message: string;
  login?: string | null;
  scopes: string[];
}

export interface GitHubCreateRepoRequest {
  name: string;
  description?: string;
  visibility: "private" | "public";
  owner?: string | null;
}

export interface GitCommitRequest {
  message: string;
  files: string[];
  allowEmpty?: boolean;
}

export interface GitPushRequest {
  remote?: string;
  branch?: string | null;
  setUpstream?: boolean;
}

export interface GitHubPullRequestRequest {
  owner: string;
  repository: string;
  title: string;
  head: string;
  base?: string;
  body?: string;
}
