import type {
  AddCloudModelRequest,
  AgentsConfig,
  ModelCatalogResponse,
  ModelDownloadRequest,
  ModelDownloadState,
} from "../types";

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

export function getModelCatalog(): Promise<ModelCatalogResponse> {
  return request<ModelCatalogResponse>("/api/models/catalog");
}

export function startLocalModelDownload(payload: ModelDownloadRequest): Promise<ModelDownloadState> {
  return request<ModelDownloadState>("/api/models/local/download", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getLocalModelDownload(downloadId: string): Promise<ModelDownloadState> {
  return request<ModelDownloadState>(`/api/models/local/downloads/${downloadId}`);
}

export function addCloudModel(payload: AddCloudModelRequest): Promise<AgentsConfig> {
  return request<AgentsConfig>("/api/models/cloud", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
