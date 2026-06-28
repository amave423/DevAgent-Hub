import { Cpu, ShieldCheck, SlidersHorizontal, TestTube2 } from "lucide-react";
import type { AgentModel, AgentsConfig, DevHubSettings, IntegrationStatus } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { IntegrationCards } from "../components/IntegrationCard";
import type { CopyKey } from "../i18n/ru";
import type { ModelPurposeId } from "../types";

export function SettingsPanel({
  config,
  settings,
  statuses,
  patchSettings,
  patchConfig,
  applyPurposes,
  t,
}: {
  config: AgentsConfig;
  settings: DevHubSettings;
  statuses: IntegrationStatus[];
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  patchConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void;
  applyPurposes: () => void;
  t: (key: CopyKey) => string;
}) {
  function patchPurpose(id: ModelPurposeId, modelId: string) {
    patchSettings({
      modelPurposes: settings.modelPurposes.map((purpose) =>
        purpose.id === id ? { ...purpose, modelId } : purpose,
      ),
    });
  }

  return (
    <div className="tab-panel settings-panel">
      <PanelHeader title={t("settingsTitle")} subtitle={t("settingsSubtitle")} />
      <div className="settings-sections">
        <section>
          <h3>{t("modelPurposes")}</h3>
          <div className="purpose-list">
            {settings.modelPurposes.map((purpose) => (
              <label className="purpose-row" key={purpose.id}>
                <div>
                  <strong>{purpose.label}</strong>
                  <span>{purpose.description}</span>
                </div>
                <select value={purpose.modelId} onChange={(event) => patchPurpose(purpose.id, event.target.value)}>
                  {config.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.provider}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="secondary-button" onClick={applyPurposes}>
            <SlidersHorizontal size={16} />
            {t("applyPurposes")}
          </button>
        </section>

        <section>
          <h3>{t("runtime")}</h3>
          <div className="settings-grid">
            <label className="field">
	              <span>{t("runnerMode")}</span>
              <select
                value={config.runtime.runnerMode}
                onChange={(event) =>
                  patchConfig((current) => ({
                    ...current,
                    runtime: { ...current.runtime, runnerMode: event.target.value as AgentsConfig["runtime"]["runnerMode"] },
                  }))
                }
              >
                <option value="auto">auto</option>
                <option value="live">live</option>
                <option value="mock">mock</option>
              </select>
            </label>
            <label className="field">
	              <span>{t("openVsCodeUrl")}</span>
              <input value={settings.openVsCodeUrl} onChange={(event) => patchSettings({ openVsCodeUrl: event.target.value })} placeholder="http://127.0.0.1:3001" />
            </label>
            <label className="field">
	              <span>{t("previewUrl")}</span>
              <input value={settings.previewUrl} onChange={(event) => patchSettings({ previewUrl: event.target.value })} />
            </label>
          </div>
        </section>

        <section>
          <h3>{t("guardrails")}</h3>
          <div className="guardrail-grid">
            <article>
              <ShieldCheck size={20} />
	              <strong>{t("scopedGitWrites")}</strong>
	              <span>{t("scopedGitWritesDesc")}</span>
            </article>
            <article>
              <TestTube2 size={20} />
	              <strong>{t("verifyBeforePr")}</strong>
	              <span>{t("verifyBeforePrDesc")}</span>
            </article>
            <article>
              <Cpu size={20} />
	              <strong>{t("modelRouting")}</strong>
	              <span>{t("modelRoutingDesc")}</span>
            </article>
          </div>
        </section>

        <section>
          <h3>{t("integrations")}</h3>
          <IntegrationCards statuses={statuses} t={t} />
        </section>
      </div>
    </div>
  );
}
