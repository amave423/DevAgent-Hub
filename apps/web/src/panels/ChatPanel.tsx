import { ChevronDown, Loader2, Paperclip, Send, StopCircle } from "lucide-react";
import type { AgentLogEvent, AppLanguage, TaskState } from "../types";
import type { CopyKey } from "../i18n/ru";

export function ChatPanel({
  taskText,
  setTaskText,
  taskState,
  logs,
  isRunning,
  onRun,
  onCancel,
  t,
}: {
  language: AppLanguage;
  taskText: string;
  setTaskText: (value: string) => void;
  taskState: TaskState | null;
  logs: AgentLogEvent[];
  isRunning: boolean;
  onRun: () => void;
  onCancel: () => void;
  t: (key: CopyKey) => string;
}) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning && taskText.trim()) onRun();
    }
  }

  const visibleLogs = logs.filter((log) => log.phase !== "prompt");

  return (
    <div className="tab-panel chat-panel chatgpt-layout">
      <section className="conversation-stream chat-messages">
        <article className="message user-message">
          <strong>{t("user")}</strong>
          <p>{taskState?.task || taskText || t("taskPlaceholder")}</p>
        </article>

        {(isRunning || logs.length > 0) && (
          <details className="reasoning-card" open={isRunning}>
            <summary>
              <span>
                <ChevronDown size={16} />
                {t("reasoning")}
              </span>
              <em>{taskState?.status ?? t("running")}</em>
            </summary>
            <div className="chain-steps vertical">
              {renderChainSteps(logs)}
            </div>
            <div className="reasoning-log">
              {visibleLogs.map((log) => (
                <p key={log.id} className={log.level}>
                  <strong>{log.agentName ?? log.phase}</strong>
                  <span>{log.message}</span>
                </p>
              ))}
            </div>
          </details>
        )}

        <article className="message assistant-message final-result">
          <strong>{t("result")}</strong>
          <p>{taskState?.error || taskState?.result || t("noResult")}</p>
        </article>
      </section>

      <section className="chat-composer">
        <button className="icon-button" type="button" title={t("attachments")}>
          <Paperclip size={18} />
        </button>
        <textarea
          value={taskText}
          onChange={(event) => setTaskText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("taskPlaceholder")}
          rows={1}
        />
        {isRunning ? (
          <button className="danger-button" onClick={onCancel}>
            <StopCircle size={16} />
            {t("cancel")}
          </button>
        ) : (
          <button className="primary-button" onClick={onRun} disabled={!taskText.trim()}>
            {isRunning ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            {t("run")}
          </button>
        )}
      </section>
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
