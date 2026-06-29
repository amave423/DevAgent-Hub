import { CheckCircle2, Cloud, Cpu, Download, HardDrive, Loader2, RefreshCcw, ShieldCheck, TestTube2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProgressBar } from "../components/ProgressBar";
import {
  addCloudModel,
  deleteLocalModel,
  getModelCatalog,
  listHuggingFaceFiles,
  listLocalModelDownloads,
  retryLocalModelDownload,
  searchModels,
  startLocalModelDownload,
  testCloudModel,
} from "../api/models";
import { saveRuntimeSettings } from "../api/runtime";
import { testWebSearch } from "../api/tools";
import type {
  ActionPolicy,
  AddCloudModelRequest,
  AgentModel,
  AgentRunMode,
  AgentsConfig,
  CloudApiFormat,
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
import type { PageInfoContent } from "../i18n/pageInfo";

export function SettingsPanel({
  config,
  settings,
  statuses,
  patchSettings,
  patchConfig,
  t,
  info,
}: {
  config: AgentsConfig;
  settings: DevHubSettings;
  statuses: IntegrationStatus[];
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  patchConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
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
  const [downloads, setDownloads] = useState<ModelDownloadState[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isTestingCloudModel, setIsTestingCloudModel] = useState(false);
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [cloudTestNotice, setCloudTestNotice] = useState<string | null>(null);
  const [webSearchNotice, setWebSearchNotice] = useState<string | null>(null);
  const [cloudForm, setCloudForm] = useState<AddCloudModelRequest>({
    id: "",
    name: "",
    modelName: "",
    provider: "custom",
    baseUrl: "",
    apiKeyEnv: "AGENT_STUDIO_API_KEY",
    apiKey: "",
    apiFormat: "openai-chat-completions",
    endpointPath: "",
    description: "",
  });

  useEffect(() => {
    void refreshCatalog();
    void refreshDownloads();
  }, []);

  useEffect(() => {
    const hasActive = downloads.some((download) => ["queued", "running"].includes(download.status));
    if (!hasActive) return;
    const timer = window.setInterval(() => void refreshDownloads(), 1000);
    return () => window.clearInterval(timer);
  }, [downloads]);

  const localModels = useMemo(
    () => catalog?.localModels.filter((model) => model.source === localSource) ?? [],
    [catalog, localSource],
  );
  const displayedLocalModels = searchResults?.source === localSource ? searchResults.models : localModels;
  const selectedLocalModel = displayedLocalModels.find((model) => model.id === selectedLocalModelId) ?? displayedLocalModels[0];
  const selectedLocalModelAlreadyAvailable = Boolean(
    selectedLocalModel && config.models.some((model) => model.id === selectedLocalModel.id || model.name === selectedLocalModel.modelName),
  );
  const cloudProviderOptions = catalog?.cloudProviders ?? [
    { id: "custom", name: "Custom", baseUrl: "", apiKeyEnv: "AGENT_STUDIO_API_KEY", description: "" },
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

  async function refreshCatalog() {
    try {
      const loadedCatalog = await getModelCatalog();
      setCatalog(loadedCatalog);
      const first = loadedCatalog.localModels.find((model) => model.source === localSource);
      if (first) setSelectedLocalModelId(first.id);
      setCatalogError(null);
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Could not load model catalog.");
    }
  }

  async function refreshDownloads() {
    try {
      const loaded = await listLocalModelDownloads();
      setDownloads(loaded);
      for (const download of loaded) {
        if (download.status === "completed" && download.model) {
          upsertModel(download.model);
        }
      }
      setIsDownloading(loaded.some((download) => ["queued", "running"].includes(download.status)));
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Could not load downloads.");
    }
  }

  function upsertModel(model: AgentModel) {
    patchConfig((current) => {
      const existingModel = current.models.find((item) => item.id === model.id);
      if (existingModel && JSON.stringify(existingModel) === JSON.stringify(model)) {
        return current;
      }
      return {
        ...current,
        models: existingModel
          ? current.models.map((item) => (item.id === model.id ? model : item))
          : [...current.models, model],
      };
    });
  }

  function patchRuntime(patch: Partial<AgentsConfig["runtime"]>) {
    patchConfig((current) => ({
      ...current,
      runtime: { ...current.runtime, ...patch },
    }));
    void saveRuntimeSettings({
      agentMode: patch.agentMode,
      actionPolicy: patch.actionPolicy,
    }).catch((caught: Error) => setSettingsNotice(caught.message));
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
      setDownloads((current) => [state, ...current]);
      void refreshDownloads();
    } catch (caught) {
      setIsDownloading(false);
      setSettingsNotice(caught instanceof Error ? caught.message : "Model download failed.");
    }
  }

  async function handleRetryDownload(downloadId: string) {
    setSettingsNotice(null);
    try {
      const state = await retryLocalModelDownload(downloadId);
      setDownloads((current) => [state, ...current]);
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Retry failed.");
    }
  }

  async function handleDeleteLocalModel() {
    if (!selectedLocalModel) return;
    setSettingsNotice(null);
    try {
      const ref = selectedLocalModel.modelName || selectedLocalModel.id;
      const saved = await deleteLocalModel(localSource, ref);
      patchConfig(() => saved);
      setSettingsNotice(t("modelDeleted"));
      await refreshCatalog();
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Could not delete model.");
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
      apiFormat: provider === "anthropic" ? "anthropic-messages" : current.apiFormat ?? "openai-chat-completions",
      endpointPath: provider === "anthropic" ? "/messages" : current.endpointPath ?? "",
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
        modelName: cloudForm.modelName?.trim() || cloudForm.name.trim(),
        provider: cloudForm.provider.trim() || "custom",
        baseUrl: cloudForm.baseUrl?.trim() || undefined,
        apiKeyEnv: cloudForm.apiKeyEnv?.trim() || undefined,
        apiKey: cloudForm.apiKey?.trim() || undefined,
        apiFormat: cloudForm.apiFormat || "openai-chat-completions",
        endpointPath: cloudForm.endpointPath?.trim() || undefined,
        description: cloudForm.description?.trim() || "",
      });
      patchConfig(() => saved);
      setSettingsNotice(t("cloudModelAdded"));
      setCloudForm((current) => ({ ...current, id: "", name: "", modelName: "", apiKey: "", description: "" }));
    } catch (caught) {
      setSettingsNotice(caught instanceof Error ? caught.message : "Cloud model was not added.");
    }
  }

  async function handleTestCloudModel() {
    if (!cloudForm.name.trim()) return;
    setCloudTestNotice(null);
    setIsTestingCloudModel(true);
    try {
      const result = await testCloudModel({
        name: cloudForm.name.trim(),
        modelName: cloudForm.modelName?.trim() || cloudForm.name.trim(),
        provider: cloudForm.provider.trim() || "custom",
        baseUrl: cloudForm.baseUrl?.trim() || undefined,
        apiKeyEnv: cloudForm.apiKeyEnv?.trim() || undefined,
        apiKey: cloudForm.apiKey?.trim() || undefined,
        apiFormat: cloudForm.apiFormat || "openai-chat-completions",
        endpointPath: cloudForm.endpointPath?.trim() || undefined,
      });
      const resolved = result.result?.resolvedModel || result.result?.requestedModel || cloudForm.name.trim();
      const tokens = result.result?.usage?.totalTokens;
      const tokenText = tokens == null ? t("tokensNotReturned") : `${tokens} ${t("tokens")}`;
      const urlText = result.result?.requestUrl ? `${t("requestUrl")}: ${result.result.requestUrl}; ` : "";
      setCloudTestNotice(`${result.message}: ${urlText}${resolved}; ${tokenText}; ${result.result?.latencyMs ?? 0} ms${result.output ? `; ${result.output}` : ""}`);
    } catch (caught) {
      setCloudTestNotice(caught instanceof Error ? caught.message : "Cloud model test failed.");
    } finally {
      setIsTestingCloudModel(false);
    }
  }

  async function handleTestWebSearch() {
    setWebSearchNotice(null);
    setIsTestingSearch(true);
    try {
      await saveRuntimeSettings({ webSearchEnabled: true, webSearchBaseUrl: settings.webSearchBaseUrl.trim() });
      const result = await testWebSearch("DevAgent Hub", 3);
      setWebSearchNotice(`${t("webSearchTestOk")}: ${result.results.length}`);
    } catch (caught) {
      setWebSearchNotice(caught instanceof Error ? caught.message : "Search test failed.");
    } finally {
      setIsTestingSearch(false);
    }
  }

  return (
    <div className="tab-panel settings-panel">
      <PanelHeader title={t("settingsTitle")} subtitle={t("settingsSubtitle")} info={info} infoLabel={t("info")} />
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
              <select value={selectedLocalModel?.id ?? ""} onChange={(event) => void handleSelectLocalModel(event.target.value)}>
                {displayedLocalModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} / {model.provider}{model.installed ? " / installed" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedLocalModel && (
            <div className="model-detail-row">
              <HardDrive size={18} />
              <span>
                {localizedModelDescription(selectedLocalModel.id, selectedLocalModel.description, settings.language)} RAM {selectedLocalModel.requirements.ramGb}GB / disk {selectedLocalModel.requirements.diskGb}GB
              </span>
              {selectedLocalModelAlreadyAvailable && <em>{t("modelAlreadyAvailable")}</em>}
            </div>
          )}

          {localSource === "huggingface" && (
            <>
              <div className="settings-grid compact-grid">
                <label className="field">
                  <span>{t("huggingFaceRepo")}</span>
                  <input value={hfRepoId} onChange={(event) => setHfRepoId(event.target.value)} onBlur={() => void loadHuggingFaceFiles(hfRepoId)} placeholder="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" />
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
            <button className="danger-button" onClick={() => void handleDeleteLocalModel()} disabled={!selectedLocalModelAlreadyAvailable && !selectedLocalModel?.installed}>
              <Trash2 size={16} />
              {t("deleteModel")}
            </button>
            <button className="secondary-button" onClick={() => void refreshDownloads()}>
              <RefreshCcw size={16} />
              {t("refresh")}
            </button>
          </div>

          {downloads.length > 0 && (
            <div className="download-list">
              {downloads.slice(0, 6).map((download) => (
                <article className="download-state" key={download.downloadId}>
                  <div className="section-heading compact">
                    <div>
                      <h3>{download.displayName || download.modelName || download.modelId}</h3>
                      <span>{download.message}</span>
                    </div>
                    <strong>{download.status}</strong>
                  </div>
                  <ProgressBar value={download.progress} />
                  <div className="inline-actions left">
                    {download.status === "failed" && (
                      <button className="secondary-button" onClick={() => void handleRetryDownload(download.downloadId)}>
                        <RefreshCcw size={16} />
                        {t("retry")}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3>{t("cloudModels")}</h3>
          {cloudTestNotice && <div className="notice-strip inline">{cloudTestNotice}</div>}
          <div className="settings-grid">
            <label className="field">
              <span>{t("cloudProvider")}</span>
              <select value={cloudForm.provider} onChange={(event) => selectCloudProvider(event.target.value)}>
                {cloudProviderOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("cloudModelName")}</span>
              <input value={cloudForm.name} onChange={(event) => updateCloudForm({ name: event.target.value })} placeholder="Claude Sonnet, GPT coder" />
            </label>
            <label className="field">
              <span>{t("cloudModelActualName")}</span>
              <input value={cloudForm.modelName ?? ""} onChange={(event) => updateCloudForm({ modelName: event.target.value })} placeholder="gpt-4o-mini, anthropic/claude-sonnet-4" />
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
              <span>{t("apiFormat")}</span>
              <select value={cloudForm.apiFormat ?? "openai-chat-completions"} onChange={(event) => updateCloudForm({ apiFormat: event.target.value as CloudApiFormat })}>
                <option value="openai-chat-completions">{t("apiFormatOpenAI")}</option>
                <option value="anthropic-messages">{t("apiFormatAnthropic")}</option>
                <option value="custom-openai-path">{t("apiFormatCustomPath")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("endpointPath")}</span>
              <input value={cloudForm.endpointPath ?? ""} onChange={(event) => updateCloudForm({ endpointPath: event.target.value })} placeholder={cloudForm.apiFormat === "anthropic-messages" ? "/messages" : "/chat/completions"} />
              <small>{t("endpointPathHelp")}</small>
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
          <div className="inline-actions left">
            <button className="secondary-button" onClick={() => void handleTestCloudModel()} disabled={!cloudForm.name.trim() || isTestingCloudModel}>
              {isTestingCloudModel ? <Loader2 className="spin" size={16} /> : <TestTube2 size={16} />}
              {isTestingCloudModel ? t("testingModel") : t("testModel")}
            </button>
            <button className="secondary-button" onClick={() => void handleAddCloudModel()} disabled={!cloudForm.name.trim()}>
              <Cloud size={16} />
              {t("addCloudModel")}
            </button>
          </div>
        </section>

        <section>
          <h3>{t("runtime")}</h3>
          <div className="settings-grid">
            <label className="field">
              <span>{t("runnerMode")}</span>
              <select
                value={config.runtime.runnerMode}
                onChange={(event) =>
                  patchRuntime({ runnerMode: event.target.value as AgentsConfig["runtime"]["runnerMode"] })
                }
              >
                <option value="auto">auto</option>
                <option value="live">live</option>
                <option value="mock">mock</option>
              </select>
            </label>
            <label className="field">
              <span>{t("agentMode")}</span>
              <select value={config.runtime.agentMode} onChange={(event) => patchRuntime({ agentMode: event.target.value as AgentRunMode })}>
                <option value="plan">{t("planMode")}</option>
                <option value="coding">{t("codingMode")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("actionPolicy")}</span>
              <select value={config.runtime.actionPolicy} onChange={(event) => patchRuntime({ actionPolicy: event.target.value as ActionPolicy })}>
                <option value="confirm">{t("confirmActions")}</option>
                <option value="auto-confirm">{t("autoConfirmActions")}</option>
                <option value="full-access">{t("fullAccess")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("theme")}</span>
              <select value={settings.theme} onChange={(event) => patchSettings({ theme: event.target.value as DevHubSettings["theme"] })}>
                <option value="dark">{t("darkTheme")}</option>
                <option value="light">{t("lightTheme")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("previewUrl")}</span>
              <input value={settings.previewUrl} onChange={(event) => patchSettings({ previewUrl: event.target.value })} />
            </label>
          </div>
        </section>

        <section>
          <h3>{t("webSearchSettings")}</h3>
          <p className="settings-note">{t("searxngHelp")}</p>
          {webSearchNotice && <div className="notice-strip inline">{webSearchNotice}</div>}
          <div className="settings-grid">
            <label className="field">
              <span>{t("webSearch")}</span>
              <select
                value={settings.webSearchEnabled ? "enabled" : "disabled"}
                onChange={(event) => patchSettings({ webSearchEnabled: event.target.value === "enabled" })}
              >
                <option value="enabled">{t("connected")}</option>
                <option value="disabled">{t("notConfigured")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("webSearchBaseUrl")}</span>
              <input
                value={settings.webSearchBaseUrl}
                onChange={(event) => patchSettings({ webSearchBaseUrl: event.target.value })}
                placeholder="https://search.example.com"
              />
            </label>
          </div>
          <div className="inline-actions left">
            <button className="secondary-button" onClick={() => void handleTestWebSearch()} disabled={!settings.webSearchBaseUrl.trim() || isTestingSearch}>
              {isTestingSearch ? <Loader2 className="spin" size={16} /> : <TestTube2 size={16} />}
              {isTestingSearch ? t("testingWebSearch") : t("testWebSearch")}
            </button>
          </div>
        </section>

        <section>
          <h3>{t("guardrails")}</h3>
          <div className="guardrail-grid">
            <article>
              <ShieldCheck size={20} />
              <strong>{t("actionPolicy")}</strong>
              <span>{t("actionPolicyDesc")}</span>
            </article>
            <article>
              <CheckCircle2 size={20} />
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

function localizedModelDescription(id: string, fallback: string, language: DevHubSettings["language"]): string {
  if (language !== "ru") return fallback;
  const descriptions: Record<string, string> = {
    "ollama-qwen25-coder-7b": "Рекомендуемая локальная модель для кода с хорошим балансом скорости и качества.",
    "ollama-deepseek-coder-67b": "Сильная локальная модель для генерации и правки кода.",
    "ollama-qwen25-coder-14b": "Более качественная локальная модель для кода, требует больше RAM.",
    "ollama-codellama-7b": "Локальная модель семейства Code Llama для задач программирования.",
    "ollama-codellama-13b": "Более крупный вариант Code Llama для сложных изменений кода.",
    "ollama-llama32-3b": "Быстрая локальная модель для коротких задач, черновиков и планов.",
    "ollama-llama31-8b": "Универсальная локальная модель для планирования и текстовых задач.",
    "ollama-mistral-7b": "Быстрая универсальная локальная модель.",
    "ollama-phi4": "Компактная reasoning-модель для легких агентских шагов.",
    "huggingface-custom-file": "Скачивание конкретного файла модели из Hugging Face Hub.",
  };
  return descriptions[id] ?? fallback;
}
