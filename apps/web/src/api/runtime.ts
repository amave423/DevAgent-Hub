import type { ActionPolicy, AgentRunMode, AppTheme, RuntimeSettings } from "../types";
import { devHubFetch } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getRuntimeSettings(): Promise<RuntimeSettings> {
  return request<RuntimeSettings>("/api/settings/runtime");
}

export function saveRuntimeSettings(payload: {
  theme?: AppTheme;
  agentMode?: AgentRunMode;
  actionPolicy?: ActionPolicy;
  webSearchEnabled?: boolean;
  webSearchBaseUrl?: string;
}): Promise<RuntimeSettings> {
  return request<RuntimeSettings>("/api/settings/runtime", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface PendingAction {
  id: string;
  title: string;
  description: string;
  kind: "file" | "git" | "terminal" | "github" | "model";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export function listActions(): Promise<PendingAction[]> {
  return request<PendingAction[]>("/api/actions");
}

export function approveAction(id: string): Promise<{ ok: boolean; action: PendingAction }> {
  return request<{ ok: boolean; action: PendingAction }>(`/api/actions/${id}/approve`, {
    method: "POST",
    body: "{}",
  });
}

export function rejectAction(id: string): Promise<{ ok: boolean; action: PendingAction }> {
  return request<{ ok: boolean; action: PendingAction }>(`/api/actions/${id}/reject`, {
    method: "POST",
    body: "{}",
  });
}
