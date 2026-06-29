import { Code2, Download } from "lucide-react";
import type { WorkspaceStatus } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { EmptyToolState } from "../components/EmptyToolState";
import type { CopyKey } from "../i18n/ru";
import type { PageInfoContent } from "../i18n/pageInfo";

export function CodePanel({
  effectiveUrl,
  workspaceStatus,
  isStarting,
  onInstall,
  t,
  info,
}: {
  effectiveUrl: string;
  workspaceStatus: WorkspaceStatus | null;
  isStarting: boolean;
  onInstall: () => void;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
}) {
  const isInstalled = workspaceStatus?.openVsCode.configured ?? false;

  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader
        title={t("codeTitle")}
        subtitle={workspaceStatus?.openVsCode.message || t("codeSubtitle")}
        info={info}
        infoLabel={t("info")}
        action={
          !isInstalled ? (
            <button className="secondary-button" onClick={onInstall} disabled={isStarting}>
              {isStarting ? <Loader /> : <Download size={16} />}
              {t("installEditor")}
            </button>
          ) : null
        }
      />
      {effectiveUrl ? (
        <iframe className="tool-frame" title="OpenVSCode Server" src={effectiveUrl} allow="clipboard-read; clipboard-write" />
      ) : (
        <EmptyToolState
          icon={<Code2 size={32} />}
          title={isInstalled ? t("startingEditor") : t("notConfigured")}
          message={isInstalled ? t("codeStarting") : t("codeEmpty")}
        />
      )}
    </div>
  );
}

function Loader() {
  return <span className="spin" style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #56c39a", borderTopColor: "transparent", borderRadius: "50%" }} />;
}
