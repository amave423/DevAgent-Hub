import { Activity } from "lucide-react";
import type { AgentLogEvent, TaskState } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { EmptyToolState } from "../components/EmptyToolState";
import type { CopyKey } from "../i18n/ru";

export function LogsPanel({
  logs,
  taskState,
  t,
}: {
  logs: AgentLogEvent[];
  taskState: TaskState | null;
  t: (key: CopyKey) => string;
}) {
  return (
    <div className="tab-panel">
      <PanelHeader title={t("logsTitle")} subtitle={taskState?.taskId ? `Task ${taskState.taskId.slice(0, 8)}` : "No active task"} />
      <div className="log-list">
        {logs.length === 0 && (
          <EmptyToolState icon={<Activity size={28} />} title={t("noLogs")} message={t("noLogsHint")} />
        )}
        {logs.map((log) => (
          <article className={`log-row level-${log.level}`} key={log.id}>
            <span>{log.progress}%</span>
            <div>
              <strong>{log.agentName ?? log.phase}</strong>
              <p>{log.message}</p>
            </div>
            <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
          </article>
        ))}
      </div>
    </div>
  );
}
