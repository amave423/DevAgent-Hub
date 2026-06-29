import { authQuery, websocketBaseUrl } from "./base";

export interface TerminalSocket {
  send(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onOutput: ((data: string) => void) | null;
  onError: ((error: Event) => void) | null;
  onClose: (() => void) | null;
}

export function connectTerminal(): TerminalSocket {
  const query = authQuery();
  const url = `${websocketBaseUrl()}/api/terminal/ws${query ? `?${query}` : ""}`;

  const ws = new WebSocket(url);
  const socket: TerminalSocket = {
    send(data: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    },
    resize(cols: number, rows: number) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
    close() {
      ws.close();
    },
    onOutput: null,
    onError: null,
    onClose: null,
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data as string);
      if (payload.type === "output" && socket.onOutput) {
        socket.onOutput(payload.data);
      }
    } catch {
      // ignore malformed frames
    }
  };

  ws.onerror = (event) => {
    socket.onError?.(event);
  };

  ws.onclose = () => {
    socket.onClose?.();
  };

  return socket;
}
