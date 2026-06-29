import { PanelHeader } from "../components/PanelHeader";
import { Terminal } from "../components/Terminal";
import type { CopyKey } from "../i18n/ru";
import type { PageInfoContent } from "../i18n/pageInfo";

export function TerminalPanel({ t, info }: { t: (key: CopyKey) => string; info: PageInfoContent }) {
  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader title={t("terminalTitle")} subtitle={t("terminalHint")} info={info} infoLabel={t("info")} />
      <div className="terminal-container">
        <Terminal />
      </div>
    </div>
  );
}
