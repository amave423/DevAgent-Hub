import type { AgentsConfig } from "./types";

export function normalizeAgentOrder(config: AgentsConfig): AgentsConfig {
  return {
    ...config,
    agents: config.agents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((agent, index) => ({ ...agent, order: index + 1 })),
  };
}
