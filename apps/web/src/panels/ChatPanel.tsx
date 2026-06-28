import { Loader2, Send, StopCircle, WandSparkles } from "lucide-react";
import type { AgentLogEvent, AppLanguage, TaskState } from "../types";
import type { CopyKey } from "../i18n/ru";

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
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!isRunning && taskText.trim()) onRun();
    }
  }

  return (
    <div className="tab-panel chat-panel">
      <section className="task-composer">
        <div className="section-heading">
          <div>
            <h2>{t("taskLabel")}</h2>
            <span>
              {isRunning ? t("running") : t("agentChainDesc")}
            </span>
          </div>
          <div className="inline-actions">
            {isRunning && (
              <button className="danger-button" onClick={onCancel}>
                <StopCircle size={16} />
                {t("cancel")}
              </button>
            )}
            <button
              className="primary-button"
              onClick={onRun}
              disabled={isRunning || !taskText.trim()}
            >
              {isRunning ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
              {t("run")}
            </button>
          </div>
        </div>
        <textarea
          value={taskText}
          onChange={(event) => setTaskText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("taskPlaceholder")}
          rows={5}
        />
      </section>

      {/* Agent chain progress visualization */}
      {logs.length > 0 && (
        <section className="chain-progress">
          <h3>{t("agentChain")}</h3>
          <div className="chain-steps">
            {renderChainSteps(logs, taskState, t)}
          </div>
        </section>
      )}

      <section className="conversation-stream">
        <article className="message user-message">
          <strong>{t("user")}</strong>
          <p>{taskText}</p>
        </article>

        {/* Show per-agent outputs from logs */}
        {logs
          .filter((log) => log.phase === "result")
          .map((log) => (
            <article className="message assistant-message" key={log.id}>
              <strong>{log.agentName ?? "Agent"}</strong>
              <p className="agent-step-result">
                {t("result")} ✓ {log.progress}%
              </p>
            </article>
          ))}

        {/* Final result */}
        <article className="message assistant-message final-result">
          <strong>{t("result")}</strong>
          <p>{taskState?.result ?? t("noResult")}</p>
        </article>
      </section>
    </div>
  );
}

function renderChainSteps(
  logs: AgentLogEvent[],
  taskState: TaskState | null,
  t: (key: CopyKey) => string,
) {
  // Get unique agent IDs and their latest status
  const agentSteps = new Map<string, { name: string; phase: string; progress: number }>();
  for (const log of logs) {
    if (log.agentId) {
      agentSteps.set(log.agentId, {
        name: log.agentName ?? log.agentId,
        phase: log.phase,
        progress: log.progress,
      });
    }
  }

  return Array.from(agentSteps.entries()).map(([id, step]) => {
    const isDone = step.phase === "result";
    const isRunning = step.phase === "run" || step.phase === "prompt";
    const isFailed = step.phase === "fallback";
    return (
      <div
        key={id}
        className={`chain-step ${isDone ? "done" : isRunning ? "running" : isFailed ? "failed" : ""}`}
      >
        <span className="chain-step-name">{step.name}</span>
        <span className="chain-step-status">
          {isDone ? "✓" : isRunning ? "⟳" : isFailed ? "⚠" : "○"}
        </span>
      </div>
    );
  });
}
