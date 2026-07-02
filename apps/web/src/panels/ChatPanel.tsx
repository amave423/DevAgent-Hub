import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Code2,
  Compass,
  Copy,
  Download,
  History,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
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
  ReasoningLevel,
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
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  function handleRenameChat(chatId: string, currentTitle: string) {
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  }

  function handleCancelRename() {
    setRenamingChatId(null);
    setRenameValue("");
  }

  async function handleConfirmRename(chatId: string) {
    const next = renameValue.trim();
    if (!next || next === chatSummaries.find((c) => c.id === chatId)?.title) {
      handleCancelRename();
      return;
    }
    try {
      const chat = await getChat(chatId);
      const updated = { ...chat, title: next };
      const stored = window.localStorage.getItem("devagent-hub.chats");
      if (stored) {
        const all = JSON.parse(stored) as ChatSession[];
        const idx = all.findIndex((c) => c.id === chatId);
        if (idx >= 0) {
          all[idx] = updated;
          window.localStorage.setItem("devagent-hub.chats", JSON.stringify(all));
        }
      }
      await refreshChatList();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not rename chat.");
    } finally {
      handleCancelRename();
    }
  }

  function handleCopyChat() {
    if (!activeChat) return;
    const text = activeChat.messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n\n");
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      setNotice("Chat copied to clipboard.");
    }
  }

  function handleExportChat() {
    if (!activeChat) return;
    const text = `# ${activeChat.title}\n\n${activeChat.messages
      .map((m) => `## ${m.role}\n${m.content}`)
      .join("\n\n")}`;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeChat.title || "chat"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleRegenerateFromMessage(message: ChatMessage) {
    if (!activeChat || isRunning || message.role !== "user") return;
    void Promise.resolve(onRun(message.content, {
      chatId: activeChat.id,
      agentIds: enabledAgents.map((agent) => agent.id),
      browserAccess: browserAccessEnabledForRun,
    })).then(() => refreshActiveChat(activeChat.id));
  }

  function handleContinueFromMessage(message: ChatMessage) {
    if (!activeChat || isRunning || message.role !== "user") return;
    const prompt = language === "ru"
      ? `Продолжи работу по этому сообщению, учитывая предыдущую историю чата:\n\n${message.content}`
      : `Continue working on this message, using the previous chat history:\n\n${message.content}`;
    void Promise.resolve(onRun(prompt, {
      chatId: activeChat.id,
      agentIds: enabledAgents.map((agent) => agent.id),
      browserAccess: browserAccessEnabledForRun,
    })).then(() => refreshActiveChat(activeChat.id));
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
  const reasoningLines = buildReasoningLines(logs, t);

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
              {renamingChatId === chat.id ? (
                <input
                  className="rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => void handleConfirmRename(chat.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleConfirmRename(chat.id);
                    } else if (event.key === "Escape") {
                      handleCancelRename();
                    }
                  }}
                />
              ) : (
                <button onClick={() => setActiveChatId(chat.id)} type="button">
                  <strong>{chat.title}</strong>
                  <span>{chat.lastMessage || formatDate(chat.updatedAt, language)}</span>
                </button>
              )}
              <div className="history-item-actions">
                <button className="icon-button" type="button" title={t("renameChat")} onClick={() => handleRenameChat(chat.id, chat.title)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger-icon" type="button" title={t("deleteChat")} onClick={() => void handleDeleteChat(chat.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
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
          <div className="toolbar-spacer" />
          <button className="icon-button" type="button" title={t("copyChat")} onClick={() => handleCopyChat()} disabled={!activeChat?.messages.length}>
            <Copy size={15} />
          </button>
          <button className="icon-button" type="button" title={t("exportChat")} onClick={() => handleExportChat()} disabled={!activeChat?.messages.length}>
            <Download size={15} />
          </button>
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
            <ChatMessageBubble
              key={message.id}
              message={message}
              t={t}
              language={language}
              isRunning={isRunning}
              onRegenerate={handleRegenerateFromMessage}
              onContinue={handleContinueFromMessage}
            />
          ))}

          {(isRunning || reasoningLines.length > 0 || taskState?.error) && (
            <ReasoningPanel
              lines={reasoningLines}
              taskState={taskState}
              isRunning={isRunning}
              t={t}
              language={language}
            />
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
              <button className={config.runtime.agentMode === "plan" ? "active" : ""} type="button" onClick={() => setMode("plan")} title={t("planMode")}>
                <Bot size={15} />
                <span>{t("planMode")}</span>
              </button>
              <button className={config.runtime.agentMode === "coding" ? "active" : ""} type="button" onClick={() => setMode("coding")} title={t("codingMode")}>
                <Code2 size={15} />
                <span>{t("codingMode")}</span>
              </button>
              <button className={config.runtime.agentMode === "goal" ? "active" : ""} type="button" onClick={() => setMode("goal")} title={t("goalMode")}>
                <Sparkles size={15} />
                <span>{t("goalMode")}</span>
              </button>
              <button className={config.runtime.agentMode === "full-access" ? "active" : ""} type="button" onClick={() => setMode("full-access")} title={t("fullAccessMode")}>
                <History size={15} />
                <span>{t("fullAccessMode")}</span>
              </button>
            </div>
            <label className="compact-select">
              <span>{t("reasoningLevel")}</span>
              <select
                value={config.runtime.reasoningLevel}
                onChange={(event) => patchRuntime({ reasoningLevel: event.target.value as ReasoningLevel })}
              >
                <option value="none">{t("reasoningNone")}</option>
                <option value="low">{t("reasoningLow")}</option>
                <option value="medium">{t("reasoningMedium")}</option>
                <option value="high">{t("reasoningHigh")}</option>
              </select>
            </label>
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

function ReasoningPanel({
  lines,
  taskState,
  isRunning,
  t,
  language,
}: {
  lines: ReasoningLine[];
  taskState: TaskState | null;
  isRunning: boolean;
  t: (key: CopyKey) => string;
  language: AppLanguage;
}) {
  const visibleLines = lines.length > 0
    ? lines
    : [{ id: "thinking", text: t("thinking"), level: "info" as const }];
  const statusText = isRunning ? t("thinking") : taskState?.status === "failed" ? "Error" : t("answerReady");

  return (
    <details className="reasoning-card live-reasoning" open={isRunning}>
      <summary>
        <span>
          <ChevronDown size={16} />
          {t("reasoning")}
        </span>
        <em>{statusText}</em>
      </summary>
      <div className="reasoning-stream">
        {visibleLines.map((line) => (
          <p key={line.id} className={line.level}>
            {line.text}
          </p>
        ))}
        {taskState?.error && <p className="error">{taskState.error}</p>}
      </div>
      {taskState?.llmCalls?.length ? <LLMAudit calls={taskState.llmCalls} t={t} /> : null}
      <time className="reasoning-time">{taskState ? formatDate(taskState.updatedAt, language) : ""}</time>
    </details>
  );
}

interface ReasoningLine {
  id: string;
  text: string;
  level: AgentLogEvent["level"];
}

function buildReasoningLines(logs: AgentLogEvent[], t: (key: CopyKey) => string): ReasoningLine[] {
  const lines: ReasoningLine[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    if (log.phase === "prompt") continue;
    const agent = log.agentName ?? t("agentRole");
    let text = "";
    if (log.phase === "queue") {
      text = t("reasoningAccepted");
    } else if (log.phase === "run") {
      text = agent + " " + t("reasoningAgentRunning");
    } else if (log.phase === "result") {
      text = agent + " " + t("reasoningAgentDone");
    } else if (log.phase === "complete") {
      text = t("answerReady");
    } else if (log.phase === "fallback") {
      text = t("reasoningFallback");
    } else if (log.level === "error") {
      text = log.message;
    }
    if (!text) continue;
    const key = log.phase + ":" + (log.agentId ?? "") + ":" + text;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ id: String(log.id), text, level: log.level });
  }

  return lines.slice(-6);
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = splitMarkdownBlocks(content);
  return (
    <div className="markdown-content">
      {blocks.map((block, index) => block.type === "code" ? (
        <pre key={index} className="markdown-code-block"><code>{block.value}</code></pre>
      ) : (
        <MarkdownTextBlock key={index} text={block.value} />
      ))}
    </div>
  );
}

function MarkdownTextBlock({ text }: { text: string }) {
  const chunks = text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  return (
    <>
      {chunks.map((chunk, index) => {
        const lines = chunk.split("\n");
        if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
          return <ul key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>)}</ul>;
        }
        if (lines.every((line) => /^\d+[.)]\s+/.test(line.trim()))) {
          return <ol key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^\d+[.)]\s+/, ""))}</li>)}</ol>;
        }
        const heading = chunk.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const Tag = heading[1].length === 1 ? "h3" : heading[1].length === 2 ? "h4" : "h5";
          return <Tag key={index}>{renderInlineMarkdown(heading[2])}</Tag>;
        }
        return <p key={index}>{renderInlineMarkdown(chunk)}</p>;
      })}
    </>
  );
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\x60[^\x60]+\x60|https?:\/\/\S+)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("\x60") && part.endsWith("\x60")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    }
    return <span key={index}>{part}</span>;
  });
}

function splitMarkdownBlocks(content: string): Array<{ type: "text" | "code"; value: string }> {
  const blocks: Array<{ type: "text" | "code"; value: string }> = [];
  const fence = String.fromCharCode(96, 96, 96);
  const pattern = new RegExp(fence + "[^\\n]*\\n?([\\s\\S]*?)" + fence, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) blocks.push({ type: "text", value: before });
    blocks.push({ type: "code", value: match[1].trimEnd() });
    lastIndex = pattern.lastIndex;
  }
  const tail = content.slice(lastIndex);
  if (tail.trim()) blocks.push({ type: "text", value: tail });
  return blocks.length ? blocks : [{ type: "text", value: content }];
}

function ChatMessageBubble({
  message,
  t,
  language,
  isRunning,
  onRegenerate,
  onContinue,
}: {
  message: ChatMessage;
  t: (key: CopyKey) => string;
  language: AppLanguage;
  isRunning: boolean;
  onRegenerate: (message: ChatMessage) => void;
  onContinue: (message: ChatMessage) => void;
}) {
  const label =
    message.role === "user" ? t("user") :
    message.role === "tool" ? t("tool") :
    message.role === "agent" ? t("agentRole") :
    message.role === "browser" ? t("browserRole") :
    message.role === "terminal" ? t("terminalRole") :
    message.role === "github" ? t("githubRole") :
    t("assistant");
  return (
    <article className={`chat-bubble ${message.role}`}>
      <header>
        <strong>{label}</strong>
        <time>{formatDate(message.createdAt, language)}</time>
      </header>
      <MarkdownContent content={message.content} />
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
      {message.role === "user" && (
        <div className="message-actions">
          <button type="button" onClick={() => onRegenerate(message)} disabled={isRunning}>
            <Sparkles size={14} />
            {t("regenerateChat")}
          </button>
          <button type="button" onClick={() => onContinue(message)} disabled={isRunning}>
            <History size={14} />
            {t("continueChat")}
          </button>
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
            <small>{call.rawUsageAvailable ? `${tokens} ${t("tokens")}` : t("tokensNotReturned")}</small>
            {call.finishReason && <small>{t("finishReason")}: {call.finishReason}</small>}
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
