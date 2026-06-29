import type {
  BrowserDownloadResponse,
  BrowserPageResponse,
  BrowserScreenshotResponse,
  BrowserStatusResponse,
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

export function getBrowserStatus(): Promise<BrowserStatusResponse> {
  return request<BrowserStatusResponse>("/api/browser/status");
}

export function openBrowserPage(url: string, screenshot = false): Promise<BrowserPageResponse> {
  return request<BrowserPageResponse>("/api/browser/open", {
    method: "POST",
    body: JSON.stringify({ url, screenshot }),
  });
}

export function captureBrowserScreenshot(url: string): Promise<BrowserScreenshotResponse> {
  return request<BrowserScreenshotResponse>("/api/browser/screenshot", {
    method: "POST",
    body: JSON.stringify({ url, fullPage: true }),
  });
}

export function downloadBrowserFile(url: string): Promise<BrowserDownloadResponse> {
  return request<BrowserDownloadResponse>("/api/browser/download", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}
