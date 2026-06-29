import type { ReactNode } from "react";
import type { PageInfoContent } from "../i18n/pageInfo";
import { PageInfoButton } from "./PageInfoButton";

export function PanelHeader({
  title,
  subtitle,
  action,
  info,
  infoLabel = "Info",
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  info?: PageInfoContent;
  infoLabel?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {(info || action) && (
        <div className="panel-header-actions">
          {info && <PageInfoButton content={info} label={infoLabel} />}
          {action}
        </div>
      )}
    </div>
  );
}
