import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Code2,
  Compass,
  Loader2,
  Paperclip,
  Plus,
  Send,
  StopCircle,
  Trash2,
} from "lucide-react";
import { createChat, deleteChat, getChat, listChats, uploadChatAttachment } from "../api/chats";
import { PanelHeader } from "../components/PanelHeader";
import type { PageInfoContent } from "../i18n/pageInfo";
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
  browserAccess?: boolean;
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
  patchRuntime,
  info,
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
  patchRuntime: (patch: Partial<AgentsConfig["runtime"]>) => void;
  info: PageInfoContent;
}) {
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [activeChat, setActiveChat] = useState<ChatSession | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [browserAccessEnabledForRun, setBrowserAccessEnabledForRun] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const enabledAgents = useMemo(
    () => config.agents.filter((agent) => agent.enabled).sort((left, right) => left.order - right.order),
    [config.agents],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [taskText]);

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

  async function handleDeleteChat(chatId: string) {
    if (!window.confirm(t("deleteChatConfirm"))) return;
    setNotice(null);
    try {
      await deleteChat(chatId);
      const summaries = (await listChats()).filter((chat) => chat.id !== chatId);
      if (summaries.length === 0) {
        const created = await createChat();
        setChatSummaries([{
          id: created.id,
          title: created.title,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          lastMessage: "",
        }]);
        setActiveChat(created);
        setActiveChatId(created.id);
      } else {
        setChatSummaries(summaries);
        if (activeChatId === chatId) {
          setActiveChatId(summaries[0].id);
        }
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not delete chat.");
    }
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

  async function handleRunClick() {
    if (!taskText.trim() || isRunning) return;
    let chatId = activeChatId;
    if (!chatId) {
      const chat = await createChat();
      chatId = chat.id;
      setActiveChat(chat);
      setActiveChatId(chat.id);
    }
    const attachmentIds = pendingAttachments.map((attachment) => attachment.id);
    const agentIds = enabledAgents.map((agent) => agent.id);
    const content = taskText.trim();
    setTaskText("");
    setPendingAttachments([]);
    await onRun(content, {
      chatId,
      attachmentIds,
      agentIds,
      browserAccess: browserAccessEnabledForRun,
    });
    await refreshActiveChat(chatId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleRunClick();
    }
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
            <div key={chat.id} className={`chat-history-item ${chat.id === activeChatId ? "active" : ""}`}>
              <button onClick={() => setActiveChatId(chat.id)} type="button">
                <strong>{chat.title}</strong>
                <span>{chat.lastMessage || formatDate(chat.updatedAt, language)}</span>
              </button>
              <button className="icon-button danger-icon" type="button" title={t("deleteChat")} onClick={() => void handleDeleteChat(chat.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        <PanelHeader title={t("tabChat")} subtitle={t("emptyChatHint")} info={info} infoLabel={t("info")} />
        {notice && <div className="notice-strip inline">{notice}</div>}
        <div className="chat-toolbar">
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
            <div className="segmented composer-modes" aria-label={t("agentMode")}>
              <button className={config.runtime.agentMode === "plan" ? "active" : ""} type="button" onClick={() => setMode("plan")}>
                <Bot size={15} />
                {t("planMode")}
              </button>
              <button className={config.runtime.agentMode === "coding" ? "active" : ""} type="button" onClick={() => setMode("coding")}>
                <Code2 size={15} />
                {t("codingMode")}
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("taskPlaceholder")}
              rows={1}
            />
            <button
              className={`icon-button search-run-button ${browserAccessEnabledForRun ? "active" : ""}`}
              type="button"
              title={t("browserAccess")}
              onClick={() => setBrowserAccessEnabledForRun((current) => !current)}
              disabled={isRunning}
            >
              <Compass size={18} />
            </button>
            {isRunning ? (
              <button className="danger-button" onClick={onCancel}>
                <StopCircle size={16} />
                {t("cancel")}
              </button>
            ) : (
              <button className="primary-button" onClick={() => void handleRunClick()} disabled={!taskText.trim() || enabledAgents.length === 0}>
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
            {call.requestUrl && <small>{call.requestUrl}</small>}
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
