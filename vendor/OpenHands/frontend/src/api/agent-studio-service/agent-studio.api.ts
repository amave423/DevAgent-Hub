import { openHands } from "#/api/open-hands-axios";
import {
  AgentLogEvent,
  AgentsConfig,
  RunAgentsResponse,
  TaskState,
} from "./agent-studio.types";

class AgentStudioService {
  static async getConfig(): Promise<AgentsConfig> {
    const { data } = await openHands.get<AgentsConfig>("/api/v1/agents/config");
    return data;
  }

  static async saveConfig(config: AgentsConfig): Promise<AgentsConfig> {
    const { data } = await openHands.post<AgentsConfig>(
      "/api/v1/agents/config",
      config,
    );
    return data;
  }

  static async run(
    task: string,
    config: AgentsConfig,
  ): Promise<RunAgentsResponse> {
    const { data } = await openHands.post<RunAgentsResponse>(
      "/api/v1/agents/run",
      {
        task,
        agents: config.agents,
        modelOverrides: Object.fromEntries(
          config.agents.map((agent) => [agent.id, agent.modelId]),
        ),
      },
    );
    return data;
  }

  static async getStatus(taskId: string): Promise<TaskState> {
    const { data } = await openHands.get<TaskState>(
      `/api/v1/agents/status/${taskId}`,
    );
    return data;
  }

  static subscribeToLogs(
    taskId: string,
    handlers: {
      onLog: (event: AgentLogEvent) => void;
      onDone: (state: TaskState) => void;
      onError: (error: Error) => void;
    },
  ): EventSource {
    const baseUrl = String(
      openHands.defaults.baseURL ?? window.location.origin,
    );
    const source = new EventSource(`${baseUrl}/api/v1/agents/logs/${taskId}`);

    source.addEventListener("log", (event) => {
      handlers.onLog(JSON.parse((event as MessageEvent).data) as AgentLogEvent);
    });

    source.addEventListener("done", (event) => {
      handlers.onDone(JSON.parse((event as MessageEvent).data) as TaskState);
      source.close();
    });

    source.onerror = () => {
      handlers.onError(new Error("Agent log stream was interrupted."));
      source.close();
    };

    return source;
  }
}

export default AgentStudioService;
