import { expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export interface ApiModelCase {
  name: string;
  modelName?: string;
  provider?: string;
  baseUrl: string;
  apiKey: string;
  apiFormat?: "auto" | "openai-chat-completions" | "openai-responses" | "anthropic-messages" | "custom-openai-path";
}

export interface AgentsConfig {
  version: number;
  models: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  runtime: Record<string, unknown>;
}

const apiBaseUrl = process.env.E2E_API_BASE_URL || "http://127.0.0.1:8000";
const secretPath = path.resolve(process.cwd(), "e2e", "api-models.local.json");

export async function apiGet<T>(request: APIRequestContext, route: string): Promise<T> {
  const response = await request.get(`${apiBaseUrl}${route}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function apiPost<T>(request: APIRequestContext, route: string, data: unknown): Promise<T> {
  const response = await request.post(`${apiBaseUrl}${route}`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function apiDelete(request: APIRequestContext, route: string): Promise<void> {
  const response = await request.delete(`${apiBaseUrl}${route}`);
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function getAgentsConfig(request: APIRequestContext): Promise<AgentsConfig> {
  return apiGet<AgentsConfig>(request, "/api/agents/config");
}

export async function saveAgentsConfig(request: APIRequestContext, config: AgentsConfig): Promise<AgentsConfig> {
  return apiPost<AgentsConfig>(request, "/api/agents/config", config);
}

export async function useMockRuntime(request: APIRequestContext): Promise<AgentsConfig> {
  const original = await getAgentsConfig(request);
  const models = original.models.length > 0 ? original.models : [mockModel()];
  const agents = original.agents.length > 0 ? original.agents : [mockAgent(models[0])];
  await saveAgentsConfig(request, {
    ...original,
    models,
    agents: agents.map((agent, index) => ({
      ...agent,
      enabled: index === 0 ? true : Boolean(agent.enabled),
      order: index + 1,
      modelId: String(agent.modelId || models[0].id),
    })),
    runtime: {
      ...original.runtime,
      runnerMode: "mock",
      agentMode: "normal",
      actionPolicy: "confirm",
      reasoningLevel: "low",
    },
  });
  return original;
}

export async function cleanupNewChats(request: APIRequestContext, beforeIds: Set<string>): Promise<void> {
  const chats = await apiGet<Array<{ id: string }>>(request, "/api/chats");
  for (const chat of chats) {
    if (!beforeIds.has(chat.id)) {
      await request.delete(`${apiBaseUrl}/api/chats/${chat.id}`);
    }
  }
}

export async function existingChatIds(request: APIRequestContext): Promise<Set<string>> {
  const chats = await apiGet<Array<{ id: string }>>(request, "/api/chats");
  return new Set(chats.map((chat) => chat.id));
}

export function loadApiModelCases(): ApiModelCase[] {
  if (!fs.existsSync(secretPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(secretPath, "utf8")) as ApiModelCase[] | { models?: ApiModelCase[] };
  const models = Array.isArray(parsed) ? parsed : parsed.models || [];
  return models.filter((item) => {
    if (!item.name || !item.baseUrl || !item.apiKey) return false;
    try {
      const host = new URL(item.baseUrl).hostname.toLowerCase();
      if (host === "example.com" || host.endsWith(".example.com")) {
        console.warn(`[e2e] Skipping ${item.name}: baseUrl uses reserved example.com host.`);
        return false;
      }
      return true;
    } catch {
      console.warn(`[e2e] Skipping ${item.name}: baseUrl is not a valid URL.`);
      return false;
    }
  });
}

export async function expectNoFrameworkOverlay(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(/Internal Server Error|Failed to load module script|vite.*error/i);
}

function mockModel(): Record<string, unknown> {
  return {
    id: "mock-qwen",
    name: "Mock Qwen",
    provider: "mock",
    kind: "cloud",
    modelName: "qwen2.5-coder:7b",
    description: "E2E mock model.",
    requirements: { ramGb: 1, diskGb: 0 },
  };
}

function mockAgent(model: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "e2e-agent",
    name: "E2E Agent",
    enabled: true,
    order: 1,
    modelId: String(model.id),
    systemPrompt: "",
  };
}
