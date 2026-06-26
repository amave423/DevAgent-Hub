export type ModelKind = "local" | "cloud" | "none";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type LogLevel = "info" | "debug" | "warning" | "error" | "success";

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
  description: string;
  requirements: ModelRequirements;
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

