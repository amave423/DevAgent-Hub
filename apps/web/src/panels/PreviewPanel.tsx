import { ExternalLink, Globe2 } from "lucide-react";
import type { DevHubSettings } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import type { CopyKey } from "../i18n/ru";

export function PreviewPanel({
  settings,
  patchSettings,
  t,
}: {
  settings: DevHubSettings;
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  t: (key: CopyKey) => string;
}) {
  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader title={t("previewTitle")} subtitle="Inspect local apps and agent-built web output." />
      <div className="url-bar">
        <Globe2 size={16} />
        <input value={settings.previewUrl} onChange={(event) => patchSettings({ previewUrl: event.target.value })} />
        <a className="icon-link" href={settings.previewUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={16} />
        </a>
      </div>
      <iframe className="tool-frame" title="Preview" src={settings.previewUrl} sandbox="allow-scripts allow-same-origin allow-forms" />
    </div>
  );
}
