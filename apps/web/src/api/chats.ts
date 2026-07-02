import type {
  ChatAttachment,
  ChatMessage,
  ChatRunRequest,
  ChatSession,
  ChatSummary,
  RunAgentsResponse,
} from "../types";
import { devHubFetch, readErrorMessage } from "./base";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await devHubFetch(path, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<T>;
}

export function listChats(): Promise<ChatSummary[]> {
  return request<ChatSummary[]>("/api/chats");
}

export function createChat(title?: string): Promise<ChatSession> {
  return request<ChatSession>("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getChat(chatId: string): Promise<ChatSession> {
  return request<ChatSession>(`/api/chats/${encodeURIComponent(chatId)}`);
}

export function deleteChat(chatId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
}

export function addChatMessage(chatId: string, content: string): Promise<ChatMessage> {
  return request<ChatMessage>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ role: "user", content }),
  });
}

export function runChat(chatId: string, payload: ChatRunRequest): Promise<RunAgentsResponse> {
  return request<RunAgentsResponse>(`/api/chats/${encodeURIComponent(chatId)}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadChatAttachment(chatId: string, file: File): Promise<ChatAttachment> {
  const response = await devHubFetch(
    `/api/chats/${encodeURIComponent(chatId)}/attachments?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<ChatAttachment>;
}
