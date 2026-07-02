import { ExternalLink, Globe2 } from "lucide-react";
import type { DevHubSettings } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import type { CopyKey } from "../i18n/ru";
import type { PageInfoContent } from "../i18n/pageInfo";

export function PreviewPanel({
  settings,
  patchSettings,
  t,
  info,
}: {
  settings: DevHubSettings;
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
}) {
  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader title={t("previewTitle")} subtitle={t("previewSubtitle")} info={info} infoLabel={t("info")} />
      <div className="url-bar">
        <Globe2 size={16} />
        <input aria-label={t("previewUrl")} value={settings.previewUrl} onChange={(event) => patchSettings({ previewUrl: event.target.value })} />
        <a className="icon-link" href={settings.previewUrl} target="_blank" rel="noreferrer" title={t("openExternal")} aria-label={t("openExternal")}>
          <ExternalLink size={16} />
        </a>
      </div>
      <iframe className="tool-frame" title={t("previewTitle")} src={settings.previewUrl} sandbox="allow-scripts allow-same-origin allow-forms" />
    </div>
  );
}
