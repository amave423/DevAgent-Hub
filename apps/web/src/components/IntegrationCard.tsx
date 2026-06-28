import { CheckCircle2 } from "lucide-react";
import type { IntegrationStatus } from "../types";
import type { CopyKey } from "../i18n/ru";

export function IntegrationCards({
  statuses,
  t,
}: {
  statuses: IntegrationStatus[];
  t: (key: CopyKey) => string;
}) {
  return (
    <div className="integration-list">
      {statuses.map((status) => (
        <article className={`integration-card ${status.status}`} key={status.id}>
          <CheckCircle2 size={16} />
          <div>
            <strong>{status.label}</strong>
            <span>{status.detail}</span>
          </div>
          <em>
            {t(
              status.status === "connected"
                ? "connected"
                : status.status === "planned"
                  ? "planned"
                  : "notConfigured",
            )}
          </em>
        </article>
      ))}
    </div>
  );
}
