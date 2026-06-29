import type {
  AddCloudModelRequest,
  AgentsConfig,
  LocalModelSource,
  ModelFileListResponse,
  ModelCatalogResponse,
  ModelDownloadRequest,
  ModelDownloadState,
  ModelSearchResponse,
} from "../types";
import { apiBaseUrl } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
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

export function searchModels(source: LocalModelSource, query: string): Promise<ModelSearchResponse> {
  return request<ModelSearchResponse>(`/api/models/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(query)}`);
}

export function listHuggingFaceFiles(repoId: string): Promise<ModelFileListResponse> {
  return request<ModelFileListResponse>(`/api/models/huggingface/files?repo_id=${encodeURIComponent(repoId)}`);
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
