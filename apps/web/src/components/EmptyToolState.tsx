import type { ReactNode } from "react";

export function EmptyToolState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="empty-tool-state">
      {icon}
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}
