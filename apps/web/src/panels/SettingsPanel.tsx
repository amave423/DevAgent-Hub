import { Cloud, Cpu, Download, HardDrive, Loader2, ShieldCheck, SlidersHorizontal, TestTube2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProgressBar } from "../components/ProgressBar";
import {
  addCloudModel,
  getLocalModelDownload,
  getModelCatalog,
  listHuggingFaceFiles,
  searchModels,
  startLocalModelDownload,
} from "../api/models";
import type {
  AddCloudModelRequest,
  AgentModel,
  AgentsConfig,
  DevHubSettings,
  IntegrationStatus,
  LocalModelSource,
  ModelCatalogResponse,
  ModelDownloadState,
  ModelSearchResponse,
} from "../types";
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
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [localSource, setLocalSource] = useState<LocalModelSource>("ollama");
  const [selectedLocalModelId, setSelectedLocalModelId] = useState("ollama-qwen25-coder-7b");
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ModelSearchResponse | null>(null);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [hfRepoId, setHfRepoId] = useState("");
  const [hfFilename, setHfFilename] = useState("");
  const [hfDisplayName, setHfDisplayName] = useState("");
  const [hfFiles, setHfFiles] = useState<string[]>([]);
  const [downloadState, setDownloadState] = useState<ModelDownloadState | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [cloudForm, setCloudForm] = useState<AddCloudModelRequest>({
    id: "",
    name: "",
    provider: "custom",
    baseUrl: "",
    apiKeyEnv: "AGENT_STUDIO_API_KEY",
    apiKey: "",
    description: "",
  });

  useEffect(() => {
    let cancelled = false;
    getModelCatalog()
      .then((loadedCatalog) => {
        if (cancelled) return;
        setCatalog(loadedCatalog);
        const first = loadedCatalog.localModels.find((model) => model.source === localSource);
        if (first) setSelectedLocalModelId(first.id);
      })
      .catch((caught: Error) => {
        if (!cancelled) setCatalogError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const localModels = useMemo(
    () => catalog?.localModels.filter((model) => model.source === localSource) ?? [],
    [catalog, localSource],
  );
  const displayedLocalModels = searchResults?.source === localSource ? searchResults.models : localModels;

  const selectedLocalModel = displayedLocalModels.find((model) => model.id === selectedLocalModelId) ?? displayedLocalModels[0];
  const selectedLocalModelAlreadyAvailable = Boolean(
    selectedLocalModel && config.models.some((model) => model.id === selectedLocalModel.id),
  );
  const cloudProviderOptions = catalog?.cloudProviders ?? [
    {
      id: "custom",
      name: "Custom",
      baseUrl: "",
      apiKeyEnv: "AGENT_STUDIO_API_KEY",
      description: "",
    },
  ];
  const canDownloadLocalModel =
    Boolean(selectedLocalModel) &&
    !isDownloading &&
    (localSource !== "huggingface" || (hfRepoId.trim().length > 0 && hfFilename.trim().length > 0));

  useEffect(() => {
    if (displayedLocalModels.length === 0) return;
    if (!displayedLocalModels.some((model) => model.id === selectedLocalModelId)) {
      setSelectedLocalModelId(displayedLocalModels[0].id);
    }
  }, [displayedLocalModels, selectedLocalModelId]);

  useEffect(() => {
    if (!downloadState || ["completed", "failed", "cancelled"].includes(downloadState.status)) return;

    const timer = window.setInterval(() => {
      void getLocalModelDownload(downloadState.downloadId)
        .then((state) => {
          setDownloadState(state);
          if (state.status === "completed") {
            setIsDownloading(false);
            setSettingsNotice(t("downloadReady"));
            if (state.model) upsertModel(state.model);
          }
          if (state.status === "failed" || state.status === "cancelled") {
            setIsDownloading(false);
          }
        })
        .catch((caught: Error) => {
          setIsDownloading(false);
          setSettingsNotice(caught.message);
        });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [downloadState?.downloadId, downloadState?.status]);

  function patchPurpose(id: ModelPurposeId, modelId: string) {
    patchSettings({
      modelPurposes: settings.modelPurposes.map((purpose) =>
        purpose.id === id ? { ...purpose, modelId } : purpose,
      ),
    });
  }

  function upsertModel(model: AgentModel) {
    patchConfig((current) => {
      const existing = current.models.some((item) => item.id === model.id);
      return {
        ...current,
        models: existing
          ? current.models.map((item) => (item.id === model.id ? model : item))
          : [...current.models, model],
      };
    });
  }

  async function handleDownloadModel() {
    if (!selectedLocalModel) return;
    setSettingsNotice(null);
    setIsDownloading(true);
    try {
      const state = await startLocalModelDownload({
        modelId: selectedLocalModel.id,
        source: localSource,
        modelName: localSource === "ollama" ? selectedLocalModel.modelName || selectedLocalModel.name || modelSearchQuery.trim() : undefined,
        repoId: localSource === "huggingface" ? hfRepoId.trim() : undefined,
        filename: localSource === "huggingface" ? hfFilename.trim() : undefined,
        displayName: localSource === "huggingface" ? hfDisplayName.trim() : undefined,
      });
      setDownloadState(state);
    } catch (caught) {
      setIsDownloading(false);
      setSettingsNotice(caught instanceof Error ? caught.message : "Model download failed.");
    }
  }

  async function handleSearchModels() {
    setIsSearchingModels(true);
    setSettingsNotice(null);
    try {
      const result = await searchModels(localSource, modelSearchQuery.trim());
      setSearchResults(result);
      const first = result.models[0];
      if (first) {
        setSelectedLocalModelId(first.id);
        if (localSource === "huggingface" && first.repoId) {
          setHfRepoId(first.repoId);
          await loadHuggingFaceFiles(first.repoId);
        }
      }
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Model search failed.");
    } finally {
      setIsSearchingModels(false);
    }
  }

  async function handleSelectLocalModel(modelId: string) {
    setSelectedLocalModelId(modelId);
    const model = displayedLocalModels.find((item) => item.id === modelId);
    if (localSource === "huggingface" && model?.repoId) {
      setHfRepoId(model.repoId);
      await loadHuggingFaceFiles(model.repoId);
    }
  }

  async function loadHuggingFaceFiles(repoId: string) {
    if (!repoId.trim()) return;
    try {
      const result = await listHuggingFaceFiles(repoId.trim());
      setHfFiles(result.files);
      setHfFilename(result.files[0] ?? "");
    } catch (caught) {
      setHfFiles([]);
      setSettingsNotice(caught instanceof Error ? caught.message : "Could not load Hugging Face files.");
    }
  }

  function updateCloudForm(patch: Partial<AddCloudModelRequest>) {
    setCloudForm((current) => ({ ...current, ...patch }));
  }

  function selectCloudProvider(provider: string) {
    const preset = catalog?.cloudProviders.find((item) => item.id === provider);
    setCloudForm((current) => ({
      ...current,
      provider,
      baseUrl: preset?.baseUrl ?? current.baseUrl ?? "",
      apiKeyEnv: preset?.apiKeyEnv ?? current.apiKeyEnv ?? "AGENT_STUDIO_API_KEY",
    }));
  }

  async function handleAddCloudModel() {
    if (!cloudForm.name.trim()) return;
    setSettingsNotice(null);
    try {
      const saved = await addCloudModel({
        ...cloudForm,
        id: cloudForm.id?.trim() || undefined,
        name: cloudForm.name.trim(),
        provider: cloudForm.provider.trim() || "custom",
        baseUrl: cloudForm.baseUrl?.trim() || undefined,
        apiKeyEnv: cloudForm.apiKeyEnv?.trim() || undefined,
        apiKey: cloudForm.apiKey?.trim() || undefined,
        description: cloudForm.description?.trim() || "",
      });
      patchConfig(() => saved);
      setSettingsNotice(t("cloudModelAdded"));
      setCloudForm((current) => ({ ...current, id: "", name: "", apiKey: "", description: "" }));
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Cloud model was not added.");
    }
  }

  return (
    <div className="tab-panel settings-panel">
      <PanelHeader title={t("settingsTitle")} subtitle={t("settingsSubtitle")} />
      <div className="settings-sections">
        {settingsNotice && <div className="notice-strip inline">{settingsNotice}</div>}
        {catalogError && <div className="error-strip inline">{catalogError}</div>}

        <section>
          <h3>{t("localModels")}</h3>
          <p className="settings-note">{t("modelDownloadNote")}</p>
          <div className="settings-grid">
            <label className="field">
              <span>{t("localModelSource")}</span>
              <select
                value={localSource}
                onChange={(event) => {
                  setLocalSource(event.target.value as LocalModelSource);
                  setSearchResults(null);
                  setModelSearchQuery("");
                }}
              >
                <option value="ollama">{t("ollamaSource")}</option>
                <option value="huggingface">{t("huggingfaceSource")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("modelSearch")}</span>
              <input
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                placeholder={localSource === "ollama" ? "qwen2.5-coder:7b, mistral, llama" : "qwen coder gguf, deepseek coder"}
              />
            </label>
            <div className="field action-field">
              <span>&nbsp;</span>
              <button className="secondary-button" onClick={() => void handleSearchModels()} disabled={isSearchingModels}>
                {isSearchingModels ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                {t("searchModels")}
              </button>
            </div>
            <label className="field">
              <span>{t("localModel")}</span>
              <select
                value={selectedLocalModel?.id ?? ""}
                onChange={(event) => void handleSelectLocalModel(event.target.value)}
              >
                {displayedLocalModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.provider}{model.installed ? " · installed" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedLocalModel && (
            <div className="model-detail-row">
              <HardDrive size={18} />
              <span>
                {selectedLocalModel.description} RAM {selectedLocalModel.requirements.ramGb}GB · disk {selectedLocalModel.requirements.diskGb}GB
              </span>
              {selectedLocalModelAlreadyAvailable && <em>{t("modelAlreadyAvailable")}</em>}
            </div>
          )}

          {localSource === "huggingface" && (
            <>
              <div className="settings-grid compact-grid">
                <label className="field">
                  <span>{t("huggingFaceRepo")}</span>
                  <input
                    value={hfRepoId}
                    onChange={(event) => setHfRepoId(event.target.value)}
                    onBlur={() => void loadHuggingFaceFiles(hfRepoId)}
                    placeholder="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"
                  />
                </label>
                <label className="field">
                  <span>{t("huggingFaceFilename")}</span>
                  {hfFiles.length > 0 ? (
                    <select value={hfFilename} onChange={(event) => setHfFilename(event.target.value)}>
                      {hfFiles.map((file) => (
                        <option key={file} value={file}>{file}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={hfFilename} onChange={(event) => setHfFilename(event.target.value)} placeholder="model-q4_k_m.gguf" />
                  )}
                </label>
                <label className="field">
                  <span>{t("huggingFaceDisplayName")}</span>
                  <input value={hfDisplayName} onChange={(event) => setHfDisplayName(event.target.value)} placeholder="Qwen coder local" />
                </label>
              </div>
              <p className="settings-note">{t("localRuntimeNotice")}</p>
            </>
          )}

          <div className="inline-actions left">
            <button className="secondary-button" onClick={() => void handleDownloadModel()} disabled={!canDownloadLocalModel}>
              {isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              {t("downloadModel")}
            </button>
          </div>

          {downloadState && (
            <div className="download-state">
              <div className="section-heading compact">
                <div>
                  <h3>{t("downloadProgress")}</h3>
                  <span>{downloadState.message}</span>
                </div>
                <strong>{downloadState.progress}%</strong>
              </div>
              <ProgressBar value={downloadState.progress} />
            </div>
          )}
        </section>

        <section>
          <h3>{t("cloudModels")}</h3>
          <div className="settings-grid">
            <label className="field">
              <span>{t("cloudProvider")}</span>
              <select value={cloudForm.provider} onChange={(event) => selectCloudProvider(event.target.value)}>
                {cloudProviderOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("cloudModelName")}</span>
              <input value={cloudForm.name} onChange={(event) => updateCloudForm({ name: event.target.value })} placeholder="gpt-4o-mini, claude-sonnet, provider/model" />
            </label>
            <label className="field">
              <span>{t("customModelId")}</span>
              <input value={cloudForm.id ?? ""} onChange={(event) => updateCloudForm({ id: event.target.value })} placeholder="custom-coder" />
            </label>
            <label className="field">
              <span>{t("cloudBaseUrl")}</span>
              <input value={cloudForm.baseUrl ?? ""} onChange={(event) => updateCloudForm({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
            </label>
            <label className="field">
              <span>{t("apiKeyEnv")}</span>
              <input value={cloudForm.apiKeyEnv ?? ""} onChange={(event) => updateCloudForm({ apiKeyEnv: event.target.value })} placeholder="AGENT_STUDIO_API_KEY" />
            </label>
            <label className="field">
              <span>{t("apiKeyOptional")}</span>
              <input value={cloudForm.apiKey ?? ""} onChange={(event) => updateCloudForm({ apiKey: event.target.value })} type="password" placeholder="sk-..." />
            </label>
          </div>
          <button className="secondary-button" onClick={() => void handleAddCloudModel()} disabled={!cloudForm.name.trim()}>
            <Cloud size={16} />
            {t("addCloudModel")}
          </button>
        </section>

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
