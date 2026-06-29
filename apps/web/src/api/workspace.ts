import type {
  GitCommitRequest,
  GitHubCreateRepoRequest,
  GitHubPullRequestRequest,
  GitHubTokenTestResponse,
  GitPushRequest,
  StartOpenVSCodeRequest,
  WorkspaceActionResponse,
  WorkspaceStatus,
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

export function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  return request<WorkspaceStatus>("/api/workspace/status");
}

export function startOpenVSCode(payload: StartOpenVSCodeRequest = {}): Promise<WorkspaceStatus> {
  return request<WorkspaceStatus>("/api/workspace/openvscode/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function stopOpenVSCode(): Promise<WorkspaceStatus> {
  return request<WorkspaceStatus>("/api/workspace/openvscode/stop", {
    method: "POST",
    body: "{}",
  });
}

export function createGitHubRepo(payload: GitHubCreateRepoRequest): Promise<WorkspaceActionResponse> {
  return request<WorkspaceActionResponse>("/api/workspace/github/repos", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function commitGitChanges(payload: GitCommitRequest): Promise<WorkspaceActionResponse> {
  return request<WorkspaceActionResponse>("/api/workspace/git/commit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function pushGitChanges(payload: GitPushRequest): Promise<WorkspaceActionResponse> {
  return request<WorkspaceActionResponse>("/api/workspace/git/push", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function installOpenVSCode(): Promise<WorkspaceActionResponse> {
  return request<WorkspaceActionResponse>("/api/workspace/openvscode/install", {
    method: "POST",
    body: "{}",
  });
}

export function listWorkspaceFiles(path = "."): Promise<Array<{ name: string; path: string; isDirectory: boolean; size: number }>> {
  return request(`/api/workspace/files?path=${encodeURIComponent(path)}`);
}

export function readFileContent(path: string): Promise<{ path: string; content: string }> {
  return request(`/api/workspace/files/content?path=${encodeURIComponent(path)}`);
}

export function createGitHubPullRequest(payload: GitHubPullRequestRequest): Promise<WorkspaceActionResponse> {
  return request<WorkspaceActionResponse>("/api/workspace/github/pull-request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveGitHubToken(token: string): Promise<GitHubTokenTestResponse> {
  return request<GitHubTokenTestResponse>("/api/github/token", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function testGitHubToken(): Promise<GitHubTokenTestResponse> {
  return request<GitHubTokenTestResponse>("/api/github/test", {
    method: "POST",
    body: "{}",
  });
}

export function deleteGitHubToken(): Promise<GitHubTokenTestResponse> {
  return request<GitHubTokenTestResponse>("/api/github/token", {
    method: "DELETE",
  });
}
