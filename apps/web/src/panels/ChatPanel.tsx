import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Globe2,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Send,
  StopCircle,
} from "lucide-react";
import { createChat, getChat, listChats, uploadChatAttachment } from "../api/chats";
import type {
  ActionPolicy,
  AgentLogEvent,
  AgentRunMode,
  AgentsConfig,
  AppLanguage,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatSummary,
  DevHubSettings,
  LLMCallResult,
  TaskState,
} from "../types";
import type { CopyKey } from "../i18n/ru";

const ACTIVE_CHAT_KEY = "devagent-hub.active-chat";
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

interface RunOptions {
  chatId?: string;
  attachmentIds?: string[];
  agentIds?: string[];
  webSearch?: boolean;
}

export function ChatPanel({
  language,
  taskText,
  setTaskText,
  taskState,
  logs,
  isRunning,
  onRun,
  onCancel,
  t,
  config,
  settings,
  patchRuntime,
}: {
  language: AppLanguage;
  taskText: string;
  setTaskText: (value: string) => void;
  taskState: TaskState | null;
  logs: AgentLogEvent[];
  isRunning: boolean;
  onRun: (text: string, options?: RunOptions) => void | Promise<void>;
  onCancel: () => void;
  t: (key: CopyKey) => string;
  config: AgentsConfig;
  settings: DevHubSettings;
  patchRuntime: (patch: Partial<AgentsConfig["runtime"]>) => void;
}) {
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [activeChat, setActiveChat] = useState<ChatSession | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(() =>
    config.agents.filter((agent) => agent.enabled).map((agent) => agent.id),
  );
  const [webSearchEnabledForRun, setWebSearchEnabledForRun] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const enabledAgents = useMemo(
    () => config.agents.filter((agent) => agent.enabled).sort((left, right) => left.order - right.order),
    [config.agents],
  );

  useEffect(() => {
    setSelectedAgentIds((current) => {
      const enabledIds = enabledAgents.map((agent) => agent.id);
      const stillValid = current.filter((id) => enabledIds.includes(id));
      return stillValid.length > 0 ? stillValid : enabledIds;
    });
  }, [enabledAgents]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialChats() {
      setIsLoadingChats(true);
      try {
        let summaries = await listChats();
        if (summaries.length === 0) {
          const created = await createChat();
          summaries = [{
            id: created.id,
            title: created.title,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            lastMessage: "",
          }];
        }
        if (cancelled) return;
        setChatSummaries(summaries);
        const stored = window.localStorage.getItem(ACTIVE_CHAT_KEY);
        const nextId = stored && summaries.some((chat) => chat.id === stored) ? stored : summaries[0]?.id ?? "";
        setActiveChatId(nextId);
      } catch (caught) {
        if (!cancelled) setNotice(caught instanceof Error ? caught.message : "Could not load chats.");
      } finally {
        if (!cancelled) setIsLoadingChats(false);
      }
    }
    void loadInitialChats();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeChatId) return;
    window.localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
    void refreshActiveChat(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    if (!taskState || !activeChatId || !TERMINAL_STATUSES.has(taskState.status)) return;
    const timer = window.setTimeout(() => void refreshActiveChat(activeChatId), 450);
    return () => window.clearTimeout(timer);
  }, [activeChatId, taskState?.status, taskState?.taskId]);

  async function refreshChatList() {
    const summaries = await listChats();
    setChatSummaries(summaries);
  }

  async function refreshActiveChat(chatId = activeChatId) {
    if (!chatId) return;
    try {
      const chat = await getChat(chatId);
      setActiveChat(chat);
      await refreshChatList();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load chat.");
    }
  }

  async function handleNewChat() {
    const chat = await createChat();
    setActiveChat(chat);
    setActiveChatId(chat.id);
    setPendingAttachments([]);
    setTaskText("");
    await refreshChatList();
  }

  async function handleAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    let chatId = activeChatId;
    if (!chatId) {
      const chat = await createChat();
      chatId = chat.id;
      setActiveChat(chat);
      setActiveChatId(chat.id);
    }
    setIsUploading(true);
    setNotice(null);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadChatAttachment(chatId, file));
      }
      setPendingAttachments((current) => [...current, ...uploaded]);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Attachment upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRunClick(forceWebSearch = false) {
    if (!taskText.trim() || isRunning) return;
    let chatId = activeChatId;
    if (!chatId) {
      const chat = await createChat();
      chatId = chat.id;
      setActiveChat(chat);
      setActiveChatId(chat.id);
    }
    const attachmentIds = pendingAttachments.map((attachment) => attachment.id);
    const agentIds = selectedAgentIds.length ? selectedAgentIds : enabledAgents.map((agent) => agent.id);
    const content = taskText.trim();
    setTaskText("");
    setPendingAttachments([]);
    await onRun(content, {
      chatId,
      attachmentIds,
      agentIds,
      webSearch: forceWebSearch || webSearchEnabledForRun,
    });
    await refreshActiveChat(chatId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleRunClick();
    }
  }

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  }

  function setMode(mode: AgentRunMode) {
    patchRuntime({ agentMode: mode });
  }

  function setPolicy(policy: ActionPolicy) {
    patchRuntime({ actionPolicy: policy });
  }

  const messages = activeChat?.messages ?? [];
  const liveLogs = logs.filter((log) => log.phase !== "prompt");

  return (
    <div className="tab-panel chat-panel-v2">
      <aside className="chat-history">
        <div className="chat-history-header">
          <strong>{t("chatHistory")}</strong>
          <button className="icon-button" type="button" title={t("newChat")} onClick={() => void handleNewChat()}>
            <Plus size={16} />
          </button>
        </div>
        <div className="chat-history-list">
          {isLoadingChats && <span className="muted-line">{t("loading")}</span>}
          {chatSummaries.map((chat) => (
            <button
              key={chat.id}
              className={chat.id === activeChatId ? "active" : ""}
              onClick={() => setActiveChatId(chat.id)}
              type="button"
            >
              <strong>{chat.title}</strong>
              <span>{chat.lastMessage || formatDate(chat.updatedAt, language)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        {notice && <div className="notice-strip inline">{notice}</div>}
        <div className="chat-toolbar">
          <div className="segmented">
            <button className={config.runtime.agentMode === "plan" ? "active" : ""} type="button" onClick={() => setMode("plan")}>
              <Bot size={15} />
              {t("planMode")}
            </button>
            <button className={config.runtime.agentMode === "coding" ? "active" : ""} type="button" onClick={() => setMode("coding")}>
              <Code2 size={15} />
              {t("codingMode")}
            </button>
          </div>
          <button
            className={`tool-toggle ${webSearchEnabledForRun ? "active" : ""}`}
            type="button"
            onClick={() => setWebSearchEnabledForRun((current) => !current)}
            title={settings.webSearchBaseUrl ? t("webSearch") : t("webSearchNotConfigured")}
          >
            <Globe2 size={15} />
            {t("webSearch")}
          </button>
          <label className="compact-select">
            <span>{t("actionPolicy")}</span>
            <select value={config.runtime.actionPolicy} onChange={(event) => setPolicy(event.target.value as ActionPolicy)}>
              <option value="confirm">{t("confirmActions")}</option>
              <option value="auto-confirm">{t("autoConfirmActions")}</option>
              <option value="full-access">{t("fullAccess")}</option>
            </select>
          </label>
          <span className={`runner-badge ${config.runtime.runnerMode}`}>{config.runtime.runnerMode}</span>
        </div>

        <div className="agent-chip-row" aria-label={t("selectedAgents")}>
          {enabledAgents.map((agent) => {
            const model = config.models.find((item) => item.id === agent.modelId);
            const active = selectedAgentIds.includes(agent.id);
            return (
              <button key={agent.id} className={active ? "active" : ""} type="button" onClick={() => toggleAgent(agent.id)}>
                {active && <CheckCircle2 size={14} />}
                <span>{agent.name}</span>
                <em>{model?.name ?? t("modelNotSet")}</em>
              </button>
            );
          })}
        </div>

        <section className="chat-message-list">
          {messages.length === 0 && !isRunning && (
            <div className="empty-chat-state">
              <Bot size={28} />
              <strong>{t("emptyChatTitle")}</strong>
              <span>{t("emptyChatHint")}</span>
            </div>
          )}
          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} t={t} language={language} />
          ))}

          {(isRunning || logs.length > 0) && (
            <details className="reasoning-card live-reasoning" open={isRunning}>
              <summary>
                <span>
                  <ChevronDown size={16} />
                  {t("reasoning")}
                </span>
                <em>{taskState?.status ?? t("running")}</em>
              </summary>
              <div className="chain-steps vertical">{renderChainSteps(logs)}</div>
              <div className="reasoning-log">
                {liveLogs.map((log) => (
                  <p key={log.id} className={log.level}>
                    <strong>{log.agentName ?? log.phase}</strong>
                    <span>{log.message}</span>
                  </p>
                ))}
              </div>
              {taskState?.llmCalls?.length ? <LLMAudit calls={taskState.llmCalls} t={t} /> : null}
            </details>
          )}
        </section>

        <section className="chat-composer-v2">
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments">
              {pendingAttachments.map((attachment) => (
                <span key={attachment.id}>
                  <Paperclip size={13} />
                  {attachment.name}
                  <button
                    type="button"
                    onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-row">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void handleAttachFiles(event.target.files)}
            />
            <button className="icon-button" type="button" title={t("attachments")} onClick={() => fileInputRef.current?.click()}>
              {isUploading ? <Loader2 className="spin" size={18} /> : <Paperclip size={18} />}
            </button>
            <textarea
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("taskPlaceholder")}
              rows={1}
            />
            <button
              className="icon-button search-run-button"
              type="button"
              title={t("webSearch")}
              onClick={() => {
                setWebSearchEnabledForRun(true);
                void handleRunClick(true);
              }}
              disabled={!taskText.trim() || isRunning}
            >
              <Search size={18} />
            </button>
            {isRunning ? (
              <button className="danger-button" onClick={onCancel}>
                <StopCircle size={16} />
                {t("cancel")}
              </button>
            ) : (
              <button className="primary-button" onClick={() => void handleRunClick()} disabled={!taskText.trim() || selectedAgentIds.length === 0}>
                <Send size={16} />
                {t("run")}
              </button>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function ChatMessageBubble({
  message,
  t,
  language,
}: {
  message: ChatMessage;
  t: (key: CopyKey) => string;
  language: AppLanguage;
}) {
  const label = message.role === "user" ? t("user") : message.role === "tool" ? t("tool") : t("assistant");
  return (
    <article className={`chat-bubble ${message.role}`}>
      <header>
        <strong>{label}</strong>
        <time>{formatDate(message.createdAt, language)}</time>
      </header>
      <p>{message.content}</p>
      {message.attachments.length > 0 && (
        <div className="message-attachments">
          {message.attachments.map((attachment) => (
            <span key={attachment.id}>
              <Paperclip size={13} />
              {attachment.name}
            </span>
          ))}
        </div>
      )}
      {message.llmCalls.length > 0 && <LLMAudit calls={message.llmCalls} t={t} />}
    </article>
  );
}

function LLMAudit({ calls, t }: { calls: LLMCallResult[]; t: (key: CopyKey) => string }) {
  return (
    <div className="llm-audit">
      {calls.map((call, index) => {
        const tokens = call.usage?.totalTokens;
        const mismatch = call.resolvedModel && call.resolvedModel !== call.requestedModel;
        return (
          <div key={`${call.provider}-${call.requestedModel}-${index}`} className="llm-audit-row">
            <span>{call.provider}</span>
            <strong>{call.resolvedModel || call.requestedModel}</strong>
            {mismatch && <em>{t("modelMismatch")}: {call.requestedModel}</em>}
            <small>{tokens == null ? t("tokensNotReturned") : `${tokens} ${t("tokens")}`}</small>
            <small>{call.latencyMs} ms</small>
          </div>
        );
      })}
    </div>
  );
}

function renderChainSteps(logs: AgentLogEvent[]) {
  const agentSteps = new Map<string, { name: string; phase: string; level: string }>();
  for (const log of logs) {
    if (log.agentId) {
      agentSteps.set(log.agentId, {
        name: log.agentName ?? log.agentId,
        phase: log.phase,
        level: log.level,
      });
    }
  }

  return Array.from(agentSteps.entries()).map(([id, step]) => {
    const isDone = step.phase === "result";
    const isRunning = step.phase === "run" || step.phase === "prompt";
    const isFailed = step.phase === "fallback" || step.level === "error";
    return (
      <div key={id} className={`chain-step ${isDone ? "done" : isRunning ? "running" : isFailed ? "failed" : ""}`}>
        <span className="chain-step-name">{step.name}</span>
        <span className="chain-step-status">{isDone ? "done" : isRunning ? "running" : isFailed ? "error" : step.phase}</span>
      </div>
    );
  });
}

function formatDate(value: string, language: AppLanguage): string {
  try {
    return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
