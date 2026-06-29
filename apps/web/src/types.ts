export type ModelKind = "local" | "cloud" | "none";
export type LocalModelSource = "ollama" | "huggingface";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type LogLevel = "info" | "debug" | "warning" | "error" | "success";
export type AppLanguage = "ru" | "en";
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
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  description: string;
  requirements: ModelRequirements;
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
}

export interface AddCloudModelRequest {
  id?: string | null;
  name: string;
  provider: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  apiKey?: string | null;
  description?: string;
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
}

export interface ModelPurpose {
  id: ModelPurposeId;
  label: string;
  description: string;
  modelId: string;
}

export interface DevHubSettings {
  language: AppLanguage;
  openVsCodeUrl: string;
  previewUrl: string;
  githubOwner: string;
  githubDefaultVisibility: "private" | "public";
  modelPurposes: ModelPurpose[];
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
