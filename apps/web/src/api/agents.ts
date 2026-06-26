import type { AgentLogEvent, AgentsConfig, RunAgentsResponse, TaskState } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

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
    }),
  });
}

export function getTaskStatus(taskId: string): Promise<TaskState> {
  return request<TaskState>(`/api/agents/status/${taskId}`);
}

export function subscribeToLogs(
  taskId: string,
  handlers: {
    onLog: (event: AgentLogEvent) => void;
    onDone: (state: TaskState) => void;
    onError: (error: Error) => void;
  },
): EventSource {
  const source = new EventSource(`${API_BASE_URL}/api/agents/logs/${taskId}`);

  source.addEventListener("log", (event) => {
    handlers.onLog(JSON.parse((event as MessageEvent).data) as AgentLogEvent);
  });

  source.addEventListener("done", (event) => {
    handlers.onDone(JSON.parse((event as MessageEvent).data) as TaskState);
    source.close();
  });

  source.onerror = () => {
    handlers.onError(new Error("Поток логов был прерван."));
    source.close();
  };

  return source;
}

