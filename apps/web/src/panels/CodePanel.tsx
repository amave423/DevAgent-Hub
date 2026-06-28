import { Code2, Download, ExternalLink, Play, Square } from "lucide-react";
import type { WorkspaceStatus } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { EmptyToolState } from "../components/EmptyToolState";
import type { CopyKey } from "../i18n/ru";

export function CodePanel({
  effectiveUrl,
  workspaceStatus,
  isStarting,
  onStart,
  onStop,
  onInstall,
  t,
}: {
  effectiveUrl: string;
  workspaceStatus: WorkspaceStatus | null;
  isStarting: boolean;
  onStart: () => void;
  onStop: () => void;
  onInstall: () => void;
  t: (key: CopyKey) => string;
}) {
  const isInstalled = workspaceStatus?.openVsCode.configured ?? false;
  const isRunning = workspaceStatus?.openVsCode.running ?? false;

  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader
        title={t("codeTitle")}
        subtitle={workspaceStatus?.openVsCode.message || t("codeSubtitle")}
        action={
          <div className="inline-actions">
            {effectiveUrl && (
              <a className="secondary-link" href={effectiveUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                {t("openExternal")}
              </a>
            )}
            {!isInstalled && (
              <button className="secondary-button" onClick={onInstall} disabled={isStarting}>
                {isStarting ? <Loader /> : <Download size={16} />}
                {t("installEditor")}
              </button>
            )}
            {isRunning ? (
              <button className="secondary-button" onClick={onStop} disabled={isStarting}>
                {isStarting ? <Loader /> : <Square size={16} />}
                {t("stopEditor")}
              </button>
            ) : (
              <button className="primary-button" onClick={onStart} disabled={isStarting || !isInstalled}>
                {isStarting ? <Loader /> : <Play size={16} />}
                {t("startEditor")}
              </button>
            )}
          </div>
        }
      />
      {effectiveUrl ? (
        <iframe className="tool-frame" title="OpenVSCode Server" src={effectiveUrl} allow="clipboard-read; clipboard-write" />
      ) : (
        <EmptyToolState icon={<Code2 size={32} />} title={t("notConfigured")} message={t("codeEmpty")} />
      )}
    </div>
  );
}

function Loader() {
  return <span className="spin" style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #56c39a", borderTopColor: "transparent", borderRadius: "50%" }} />;
}
