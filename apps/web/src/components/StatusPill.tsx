import type { ReactNode } from "react";

type Tone = "ok" | "warn" | "busy" | "neutral";

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}
