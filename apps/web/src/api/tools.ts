import type { WebSearchResponse } from "../types";
import { devHubFetch, readErrorMessage } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<T>;
}

export function webSearch(query: string, limit = 5): Promise<WebSearchResponse> {
  return request<WebSearchResponse>("/api/tools/web-search", {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}

export function testWebSearch(query = "Orqen Studio", limit = 3): Promise<WebSearchResponse> {
  return request<WebSearchResponse>("/api/tools/web-search/test", {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}
