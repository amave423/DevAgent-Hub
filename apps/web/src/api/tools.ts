import type { WebSearchResponse } from "../types";
import { devHubFetch } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function webSearch(query: string, limit = 5): Promise<WebSearchResponse> {
  return request<WebSearchResponse>("/api/tools/web-search", {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}
