const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const AUTH_TOKEN_KEY = "devagent-hub.auth-token";

export function apiBaseUrl(): string {
  if (!RAW_API_BASE_URL) return "";

  try {
    const current = window.location;
    const target = new URL(RAW_API_BASE_URL, current.origin);
    const currentIsPackagedApp = current.port === "3000" || current.port === "";
    const bothLoopback = isLoopback(current.hostname) && isLoopback(target.hostname);

    if (currentIsPackagedApp && bothLoopback) {
      return "";
    }

    return target.origin.replace(/\/$/, "");
  } catch {
    return RAW_API_BASE_URL.replace(/\/$/, "");
  }
}

export function websocketBaseUrl(): string {
  const base = apiBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export function accessToken(): string {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

export function authQuery(): string {
  const token = accessToken();
  return token ? `token=${encodeURIComponent(token)}` : "";
}

export async function devHubFetch(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const token = accessToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("X-DevAgent-Token", token);
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && retry) {
    const nextToken = window.prompt("DevAgent Hub access token");
    if (nextToken) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, nextToken.trim());
      return devHubFetch(path, init, false);
    }
  }

  return response;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
