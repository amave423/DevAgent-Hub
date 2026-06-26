import { AlertTriangle, Bug, CheckCircle2, Info } from "lucide-react";

import type { AgentLogEvent } from "../../types";

interface ThinkingDisplayProps {
  logs: AgentLogEvent[];
}

export function ThinkingDisplay({ logs }: ThinkingDisplayProps) {
  return (
    <div className="thinking-log">
      {logs.length === 0 && <div className="empty-log">Логи появятся после запуска цепочки.</div>}
      {logs.map((log) => (
        <article className={`log-entry level-${log.level}`} key={log.id}>
          <div className="log-icon">{iconForLevel(log.level)}</div>
          <div className="log-copy">
            <div className="log-meta">
              <strong>{log.agentName ?? log.phase}</strong>
              <time>{new Date(log.timestamp).toLocaleTimeString("ru-RU")}</time>
            </div>
            <p>{log.message}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function iconForLevel(level: AgentLogEvent["level"]) {
  if (level === "success") return <CheckCircle2 size={15} />;
  if (level === "warning") return <AlertTriangle size={15} />;
  if (level === "error") return <AlertTriangle size={15} />;
  if (level === "debug") return <Bug size={15} />;
  return <Info size={15} />;
}

