import type { AgentLogEvent, AgentsConfig, RunAgentsResponse, TaskState } from "../types";
import { apiBaseUrl, authQuery, devHubFetch } from "./base";

// Re-export TaskState for convenience
export type { TaskState };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getAgentsConfig(): Promise<AgentsConfig> {
  return request<AgentsConfig>("/api/agents/config");
}

export function saveAgentsConfig(config: AgentsConfig): Promise<AgentsConfig> {
  return request<AgentsConfig>("/api/agents/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export function runAgents(task: string, config: AgentsConfig): Promise<RunAgentsResponse> {
  return request<RunAgentsResponse>("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({
      task,
      agents: config.agents,
      modelOverrides: Object.fromEntries(config.agents.map((agent) => [agent.id, agent.modelId])),
      mode: config.runtime.agentMode,
      actionPolicy: config.runtime.actionPolicy,
    }),
  });
}

export function getTaskStatus(taskId: string): Promise<TaskState> {
  return request<TaskState>(`/api/agents/status/${taskId}`);
}

export async function cancelTask(taskId: string): Promise<TaskState> {
  return request<TaskState>(`/api/agents/cancel/${taskId}`, {
    method: "POST",
  });
}

export function subscribeToLogs(
  taskId: string,
  handlers: {
    onLog: (event: AgentLogEvent) => void;
    onDone: (state: TaskState) => void;
    onError: (error: Error) => void;
  },
): EventSource {
  const query = authQuery();
  const separator = query ? `?${query}` : "";
  const source = new EventSource(`${apiBaseUrl()}/api/agents/logs/${taskId}${separator}`);

  source.addEventListener("log", (event) => {
    handlers.onLog(JSON.parse((event as MessageEvent).data) as AgentLogEvent);
  });

  source.addEventListener("done", (event) => {
    handlers.onDone(JSON.parse((event as MessageEvent).data) as TaskState);
    source.close();
  });

  source.onerror = () => {
    handlers.onError(new Error("Log stream was interrupted."));
    source.close();
  };

  return source;
}
