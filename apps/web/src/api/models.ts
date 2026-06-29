import type {
  AddCloudModelRequest,
  AgentsConfig,
  CloudModelTestRequest,
  CloudModelTestResponse,
  LocalModelSource,
  ModelFileListResponse,
  ModelCatalogResponse,
  ModelDownloadRequest,
  ModelDownloadState,
  ModelSearchResponse,
} from "../types";
import { devHubFetch } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);

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

export function listLocalModelDownloads(): Promise<ModelDownloadState[]> {
  return request<ModelDownloadState[]>("/api/models/local/downloads");
}

export function retryLocalModelDownload(downloadId: string): Promise<ModelDownloadState> {
  return request<ModelDownloadState>(`/api/models/local/downloads/${downloadId}/retry`, {
    method: "POST",
    body: "{}",
  });
}

export function deleteLocalModel(source: LocalModelSource, modelRef: string): Promise<AgentsConfig> {
  return request<AgentsConfig>(`/api/models/local/${encodeURIComponent(source)}/${encodeURIComponent(modelRef)}`, {
    method: "DELETE",
  });
}

export function addCloudModel(payload: AddCloudModelRequest): Promise<AgentsConfig> {
  return request<AgentsConfig>("/api/models/cloud", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function testCloudModel(payload: CloudModelTestRequest): Promise<CloudModelTestResponse> {
  return request<CloudModelTestResponse>("/api/models/cloud/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
