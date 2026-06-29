const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

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

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
