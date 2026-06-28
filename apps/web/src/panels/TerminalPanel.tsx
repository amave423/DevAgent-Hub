import { PanelHeader } from "../components/PanelHeader";
import { Terminal } from "../components/Terminal";
import type { CopyKey } from "../i18n/ru";

export function TerminalPanel({ t }: { t: (key: CopyKey) => string }) {
  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader title={t("terminalTitle")} subtitle={t("terminalHint")} />
      <div className="terminal-container">
        <Terminal />
      </div>
    </div>
  );
}
