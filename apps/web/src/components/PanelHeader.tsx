import type { ReactNode } from "react";

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {action}
    </div>
  );
}
