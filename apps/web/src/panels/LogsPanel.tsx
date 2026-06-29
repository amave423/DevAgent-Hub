import { Activity } from "lucide-react";
import type { AgentLogEvent, TaskState } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { EmptyToolState } from "../components/EmptyToolState";
import type { CopyKey } from "../i18n/ru";
import type { PageInfoContent } from "../i18n/pageInfo";

export function LogsPanel({
  logs,
  taskState,
  t,
  info,
}: {
  logs: AgentLogEvent[];
  taskState: TaskState | null;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
}) {
  return (
    <div className="tab-panel">
      <PanelHeader
        title={t("logsTitle")}
        subtitle={taskState?.taskId ? `${t("taskLabel")} ${taskState.taskId.slice(0, 8)}` : t("noActiveTask")}
        info={info}
        infoLabel={t("info")}
      />
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
