import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Code2,
  Cpu,
  ExternalLink,
  Eye,
  FileCode2,
  Github,
  Globe2,
  Languages,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Play,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  TestTube2,
  WandSparkles,
} from "lucide-react";

import {
  getAgentsConfig,
  getTaskStatus,
  runAgents,
  saveAgentsConfig,
  subscribeToLogs,
} from "./api/agents";
import {
  commitGitChanges,
  createGitHubRepo,
  getWorkspaceStatus,
  pushGitChanges,
  startOpenVSCode,
  stopOpenVSCode,
} from "./api/workspace";
import type {
  AgentDefinition,
  AgentLogEvent,
  AgentModel,
  AgentsConfig,
  AppLanguage,
  DevHubSettings,
  IntegrationStatus,
  ModelPurpose,
  ModelPurposeId,
  TaskState,
  WorkbenchTab,
  WorkspaceActionResponse,
  WorkspaceStatus,
} from "./types";

const SETTINGS_KEY = "devagent-hub.settings.v1";

const purposeDefinitions: Array<Omit<ModelPurpose, "modelId">> = [
  {
    id: "planning",
    label: "Planning",
    description: "Task decomposition, architecture decisions and run plans.",
  },
  {
    id: "coding",
    label: "Coding",
    description: "Main implementation, refactors and code generation.",
  },
  {
    id: "review",
    label: "Review",
    description: "Critique, risk checks, security and quality review.",
  },
  {
    id: "testing",
    label: "Testing",
    description: "Test plans, smoke checks, regression analysis.",
  },
  {
    id: "final",
    label: "Final",
    description: "Final answer, patch summary and release notes.",
  },
];

const agentPurposeMap: Record<string, ModelPurposeId> = {
  generator: "planning",
  optimizer: "coding",
  critic: "review",
  tester: "testing",
  finalizer: "final",
};

const copy = {
  ru: {
    loading: "Загрузка DevAgent Hub",
    apiHint: "Запусти API: npm run start:api, затем npm run dev:web",
    run: "Запустить",
    save: "Сохранить",
    reset: "Сбросить",
    ready: "готово",
    running: "выполняется",
    taskPlaceholder: "Опиши задачу для цепочки агентов...",
    taskLabel: "Задача для AI-агентов",
    activeAgents: "активных агентов",
    result: "Результат",
    noResult: "Результат появится после завершения задачи.",
    openExternal: "Открыть отдельно",
    notConfigured: "Не настроено",
    planned: "Запланировано",
    connected: "Подключено",
    codeTitle: "OpenVSCode Server",
    codeEmpty:
      "Укажи URL OpenVSCode Server в Settings. После этого редактор откроется прямо здесь.",
    terminalTitle: "Terminal",
    terminalHint:
      "Основной терминал уже есть внутри OpenVSCode. Отдельный xterm-канал будет подключен к backend runtime позже.",
    previewTitle: "Preview",
    githubTitle: "GitHub",
    githubHint:
      "Здесь будет OAuth/токен GitHub, создание репозиториев, commit, push и pull request от имени агента.",
    agentsTitle: "Agents",
    settingsTitle: "Settings",
    logsTitle: "Logs",
    modelPurposes: "Назначения моделей",
    runtime: "Runtime",
    integrations: "Интеграции",
    guardrails: "Guardrails",
    applyPurposes: "Применить к агентам",
    refresh: "Обновить",
    startEditor: "Запустить редактор",
    stopEditor: "Остановить",
  },
  en: {
    loading: "Loading DevAgent Hub",
    apiHint: "Start the API: npm run start:api, then npm run dev:web",
    run: "Run",
    save: "Save",
    reset: "Reset",
    ready: "ready",
    running: "running",
    taskPlaceholder: "Describe a task for the agent chain...",
    taskLabel: "AI agent task",
    activeAgents: "active agents",
    result: "Result",
    noResult: "The result will appear after the task completes.",
    openExternal: "Open separately",
    notConfigured: "Not configured",
    planned: "Planned",
    connected: "Connected",
    codeTitle: "OpenVSCode Server",
    codeEmpty:
      "Set an OpenVSCode Server URL in Settings. The editor will load here.",
    terminalTitle: "Terminal",
    terminalHint:
      "The primary terminal is already inside OpenVSCode. A standalone xterm channel will be wired to the backend runtime later.",
    previewTitle: "Preview",
    githubTitle: "GitHub",
    githubHint:
      "This area will handle GitHub OAuth/token auth, repo creation, commit, push and pull requests for agents.",
    agentsTitle: "Agents",
    settingsTitle: "Settings",
    logsTitle: "Logs",
    modelPurposes: "Model purposes",
    runtime: "Runtime",
    integrations: "Integrations",
    guardrails: "Guardrails",
    applyPurposes: "Apply to agents",
    refresh: "Refresh",
    startEditor: "Start editor",
    stopEditor: "Stop",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

const tabs: Array<{ id: WorkbenchTab; icon: ReactNode; label: string }> = [
  { id: "chat", icon: <MessageSquareText size={18} />, label: "Chat" },
  { id: "agents", icon: <BrainCircuit size={18} />, label: "Agents" },
  { id: "code", icon: <Code2 size={18} />, label: "Code" },
  { id: "terminal", icon: <TerminalSquare size={18} />, label: "Terminal" },
  { id: "preview", icon: <Globe2 size={18} />, label: "Preview" },
  { id: "github", icon: <Github size={18} />, label: "GitHub" },
  { id: "logs", icon: <Activity size={18} />, label: "Logs" },
  { id: "settings", icon: <Settings2 size={18} />, label: "Settings" },
];

export function App() {
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [settings, setSettings] = useState<DevHubSettings | null>(null);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("chat");
  const [taskText, setTaskText] = useState(
    "Собери план MVP для автономной IDE-панели DevAgent Hub и предложи первые изменения в коде.",
  );
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isStartingEditor, setIsStartingEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    getAgentsConfig()
      .then((loadedConfig) => {
        setConfig(loadedConfig);
        setSettings(loadSettings(loadedConfig));
      })
      .catch((caught: Error) => setError(caught.message));

    getWorkspaceStatus()
      .then(setWorkspaceStatus)
      .catch((caught: Error) => setWorkspaceNotice(caught.message));

    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    if (settings) {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  const language = settings?.language ?? "ru";
  const t = (key: keyof (typeof copy)["ru"]) => copy[language][key];

  const enabledAgents = useMemo(
    () =>
      config?.agents
        .filter((agent) => agent.enabled)
        .sort((left, right) => left.order - right.order) ?? [],
    [config],
  );

  const effectiveOpenVsCodeUrl = settings?.openVsCodeUrl || workspaceStatus?.openVsCode.url || "";

  const integrationStatuses = useMemo<IntegrationStatus[]>(
    () => [
      {
        id: "openvscode",
        label: "OpenVSCode Server",
        status: effectiveOpenVsCodeUrl ? "connected" : workspaceStatus?.openVsCode.configured ? "planned" : "not_configured",
        detail: workspaceStatus?.openVsCode.message || effectiveOpenVsCodeUrl || t("codeEmpty"),
      },
      {
        id: "github",
        label: "GitHub automation",
        status: workspaceStatus?.github.tokenConfigured ? "connected" : settings?.githubOwner ? "planned" : "not_configured",
        detail: workspaceStatus?.github.tokenConfigured
          ? workspaceStatus.github.repository
            ? `Repository: ${workspaceStatus.github.repository}`
            : "GITHUB_TOKEN is configured."
          : workspaceStatus?.github.message || "Set GITHUB_TOKEN or GH_TOKEN to enable automation.",
      },
      {
        id: "terminal",
        label: "Runtime terminal",
        status: "planned",
        detail: "Standalone xterm transport will mirror the OpenVSCode terminal.",
      },
    ],
    [effectiveOpenVsCodeUrl, settings, t, workspaceStatus],
  );

  async function refreshWorkspace() {
    try {
      const next = await getWorkspaceStatus();
      setWorkspaceStatus(next);
      setWorkspaceNotice(next.git.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to refresh workspace.");
    }
  }

  async function handleStartOpenVSCode() {
    setIsStartingEditor(true);
    setWorkspaceNotice(null);
    try {
      const next = await startOpenVSCode({
        port: 3001,
        workspacePath: workspaceStatus?.rootPath,
      });
      setWorkspaceStatus(next);
      if (next.openVsCode.url) {
        patchSettings({ openVsCodeUrl: next.openVsCode.url });
      }
      setWorkspaceNotice(next.openVsCode.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to start OpenVSCode Server.");
    } finally {
      setIsStartingEditor(false);
    }
  }

  async function handleStopOpenVSCode() {
    setIsStartingEditor(true);
    setWorkspaceNotice(null);
    try {
      const next = await stopOpenVSCode();
      setWorkspaceStatus(next);
      setWorkspaceNotice(next.openVsCode.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to stop OpenVSCode Server.");
    } finally {
      setIsStartingEditor(false);
    }
  }

  async function handleSave() {
    if (!config || !settings) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveAgentsConfig(config);
      setConfig(saved);
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRun() {
    if (!config || !settings || !taskText.trim()) return;

    eventSourceRef.current?.close();
    setIsRunning(true);
    setError(null);
    setLogs([]);
    setTaskState(null);
    setActiveTab("chat");

    try {
      const runtimeConfig = applyPurposeModels(config, settings);
      const response = await runAgents(taskText.trim(), runtimeConfig);
      const initialState = await getTaskStatus(response.taskId);
      setTaskState(initialState);
      eventSourceRef.current = subscribeToLogs(response.taskId, {
        onLog: (event) => {
          setLogs((current) => [...current, event]);
          setTaskState((current) =>
            current
              ? {
                  ...current,
                  progress: event.progress,
                  activeAgentId: event.agentId ?? current.activeAgentId,
                  updatedAt: event.timestamp,
                }
              : current,
          );
        },
        onDone: (state) => {
          setTaskState(state);
          setIsRunning(false);
        },
        onError: (caught) => {
          setError(caught.message);
          setIsRunning(false);
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to run agent chain.");
      setIsRunning(false);
    }
  }

  function resetRun() {
    eventSourceRef.current?.close();
    setLogs([]);
    setTaskState(null);
    setIsRunning(false);
    setError(null);
  }

  function patchConfig(updater: (current: AgentsConfig) => AgentsConfig) {
    setConfig((current) => (current ? updater(current) : current));
  }

  function patchSettings(patch: Partial<DevHubSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  if (!config || !settings) {
    return (
      <main className="boot-screen">
        <Loader2 className="spin" size={30} />
        <strong>{t("loading")}</strong>
        <span>{t("apiHint")}</span>
        {error && <code>{error}</code>}
      </main>
    );
  }

  return (
    <main className="devhub-shell">
      <aside className="sidebar">
        <div className="product-mark">
          <Bot size={26} />
        </div>
        <nav aria-label="Workspace">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
            >
              {tab.icon}
            </button>
          ))}
        </nav>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div className="brand">
            <LayoutDashboard size={24} />
            <div>
              <h1>DevAgent Hub</h1>
              <span>Autonomous AI development workspace</span>
            </div>
          </div>

          <div className="status-strip">
            <StatusPill label={`${enabledAgents.length} ${t("activeAgents")}`} tone="ok" />
            <StatusPill label={taskState?.status ?? t("ready")} tone={isRunning ? "busy" : "neutral"} />
            <StatusPill label={settings.openVsCodeUrl ? "OpenVSCode" : "OpenVSCode off"} tone={settings.openVsCodeUrl ? "ok" : "warn"} />
          </div>

          <div className="topbar-actions">
            <button className="icon-button" title="Language" onClick={() => patchSettings({ language: language === "ru" ? "en" : "ru" })}>
              <Languages size={18} />
              <span>{language.toUpperCase()}</span>
            </button>
            <button className="icon-button" title={t("reset")} onClick={resetRun}>
              <RotateCcw size={18} />
            </button>
            <button className="secondary-button" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {t("save")}
            </button>
            <button className="primary-button" onClick={() => void handleRun()} disabled={isRunning || enabledAgents.length === 0}>
              {isRunning ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {t("run")}
            </button>
          </div>
        </header>

        {error && <div className="error-strip">{error}</div>}
        {workspaceNotice && <div className="notice-strip">{workspaceNotice}</div>}

        <div className="workspace-layout">
          <section className="workbench">
            {activeTab === "chat" && (
              <ChatPanel
                language={language}
                taskText={taskText}
                setTaskText={setTaskText}
                taskState={taskState}
                logs={logs}
                isRunning={isRunning}
                onRun={() => void handleRun()}
                t={t}
              />
            )}
            {activeTab === "agents" && (
              <AgentsPanel
                config={config}
                activeAgentId={taskState?.activeAgentId}
                onChange={(agents) => patchConfig((current) => normalizeAgentOrder({ ...current, agents }))}
              />
            )}
            {activeTab === "code" && (
              <CodePanel
                settings={settings}
                workspaceStatus={workspaceStatus}
                effectiveUrl={effectiveOpenVsCodeUrl}
                isStarting={isStartingEditor}
                onStart={() => void handleStartOpenVSCode()}
                onStop={() => void handleStopOpenVSCode()}
                t={t}
              />
            )}
            {activeTab === "terminal" && <TerminalPanel logs={logs} t={t} />}
            {activeTab === "preview" && <PreviewPanel settings={settings} patchSettings={patchSettings} t={t} />}
            {activeTab === "github" && (
              <GithubPanel
                settings={settings}
                patchSettings={patchSettings}
                workspaceStatus={workspaceStatus}
                statuses={integrationStatuses}
                onRefresh={() => void refreshWorkspace()}
                onAction={(response) => {
                  setWorkspaceNotice(response.message);
                  void refreshWorkspace();
                }}
                t={t}
              />
            )}
            {activeTab === "logs" && <LogsPanel logs={logs} taskState={taskState} t={t} />}
            {activeTab === "settings" && (
              <SettingsPanel
                config={config}
                settings={settings}
                statuses={integrationStatuses}
                patchSettings={patchSettings}
                patchConfig={patchConfig}
                applyPurposes={() => patchConfig((current) => applyPurposeModels(current, settings))}
                t={t}
              />
            )}
          </section>

          <aside className="right-rail">
            <RunSummary taskState={taskState} logs={logs} enabledAgents={enabledAgents} t={t} />
            <IntegrationCards statuses={integrationStatuses} t={t} />
          </aside>
        </div>
      </section>
    </main>
  );
}

function ChatPanel({
  language,
  taskText,
  setTaskText,
  taskState,
  logs,
  isRunning,
  onRun,
  t,
}: {
  language: AppLanguage;
  taskText: string;
  setTaskText: (value: string) => void;
  taskState: TaskState | null;
  logs: AgentLogEvent[];
  isRunning: boolean;
  onRun: () => void;
  t: (key: keyof (typeof copy)["ru"]) => string;
}) {
  const lastLog = logs.at(-1);
  return (
    <div className="tab-panel chat-panel">
      <section className="task-composer">
        <div className="section-heading">
          <div>
            <h2>{t("taskLabel")}</h2>
            <span>{isRunning ? t("running") : "Generator -> Critic -> Optimizer -> Tester -> Finalizer"}</span>
          </div>
          <button className="primary-button" onClick={onRun} disabled={isRunning}>
            {isRunning ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
            {t("run")}
          </button>
        </div>
        <textarea
          value={taskText}
          onChange={(event) => setTaskText(event.target.value)}
          placeholder={t("taskPlaceholder")}
          rows={7}
        />
      </section>

      <section className="conversation-stream">
        <article className="message user-message">
          <strong>{language === "ru" ? "Пользователь" : "User"}</strong>
          <p>{taskText}</p>
        </article>
        <article className="message assistant-message">
          <strong>{t("result")}</strong>
          <p>{taskState?.result ?? lastLog?.message ?? t("noResult")}</p>
        </article>
      </section>
    </div>
  );
}

function AgentsPanel({
  config,
  activeAgentId,
  onChange,
}: {
  config: AgentsConfig;
  activeAgentId?: string | null;
  onChange: (agents: AgentDefinition[]) => void;
}) {
  const agents = config.agents.slice().sort((left, right) => left.order - right.order);

  function patchAgent(id: string, patch: Partial<AgentDefinition>) {
    onChange(agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  }

  function moveAgent(id: string, direction: -1 | 1) {
    const index = agents.findIndex((agent) => agent.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= agents.length) return;
    const next = agents.slice();
    const [agent] = next.splice(index, 1);
    next.splice(targetIndex, 0, agent);
    onChange(next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })));
  }

  function addAgent() {
    onChange([
      ...agents,
      {
        id: `agent-${Date.now()}`,
        name: "New Agent",
        enabled: true,
        order: agents.length + 1,
        modelId: config.models[0]?.id ?? "",
        systemPrompt: "Define this agent role and its quality criteria.",
      },
    ]);
  }

  return (
    <div className="tab-panel">
      <div className="section-heading">
        <div>
          <h2>Agent Chain</h2>
          <span>Configure order, role prompts and per-agent models.</span>
        </div>
        <button className="secondary-button" onClick={addAgent}>
          <BrainCircuit size={16} />
          Add agent
        </button>
      </div>
      <div className="agent-grid">
        {agents.map((agent, index) => {
          const model = config.models.find((item) => item.id === agent.modelId);
          return (
            <article className={`agent-card ${activeAgentId === agent.id ? "active" : ""}`} key={agent.id}>
              <header>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    onChange={(event) => patchAgent(agent.id, { enabled: event.target.checked })}
                  />
                  <span />
                </label>
                <div>
                  <input value={agent.name} onChange={(event) => patchAgent(agent.id, { name: event.target.value })} />
                  <small>{model?.name ?? "model not set"}</small>
                </div>
              </header>
              <select value={agent.modelId} onChange={(event) => patchAgent(agent.id, { modelId: event.target.value })}>
                {config.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.provider}
                  </option>
                ))}
              </select>
              <textarea
                value={agent.systemPrompt}
                onChange={(event) => patchAgent(agent.id, { systemPrompt: event.target.value })}
                rows={6}
              />
              <footer>
                <button className="icon-button" onClick={() => moveAgent(agent.id, -1)} disabled={index === 0}>
                  ↑
                </button>
                <button className="icon-button" onClick={() => moveAgent(agent.id, 1)} disabled={index === agents.length - 1}>
                  ↓
                </button>
                <button className="danger-button" onClick={() => onChange(agents.filter((item) => item.id !== agent.id))}>
                  Remove
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CodePanel({
  workspaceStatus,
  effectiveUrl,
  isStarting,
  onStart,
  onStop,
  t,
}: {
  settings: DevHubSettings;
  workspaceStatus: WorkspaceStatus | null;
  effectiveUrl: string;
  isStarting: boolean;
  onStart: () => void;
  onStop: () => void;
  t: (key: keyof (typeof copy)["ru"]) => string;
}) {
  return (
    <div className="tab-panel full-bleed-panel">
      <PanelHeader
        title={t("codeTitle")}
        subtitle={workspaceStatus?.openVsCode.message || "Browser VS Code powered by OpenVSCode Server."}
        action={
          <div className="inline-actions">
            {effectiveUrl && (
              <a className="secondary-link" href={effectiveUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                {t("openExternal")}
              </a>
            )}
            {workspaceStatus?.openVsCode.running ? (
              <button className="secondary-button" onClick={onStop} disabled={isStarting}>
                {isStarting ? <Loader2 className="spin" size={16} /> : <Code2 size={16} />}
                {t("stopEditor")}
              </button>
            ) : (
              <button className="primary-button" onClick={onStart} disabled={isStarting}>
                {isStarting ? <Loader2 className="spin" size={16} /> : <Code2 size={16} />}
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

function TerminalPanel({ logs, t }: { logs: AgentLogEvent[]; t: (key: keyof (typeof copy)["ru"]) => string }) {
  return (
    <div className="tab-panel">
      <PanelHeader title={t("terminalTitle")} subtitle={t("terminalHint")} />
      <pre className="terminal-view">
        {logs.length > 0
          ? logs.map((log) => `[${log.phase}] ${log.agentName ?? "system"}: ${log.message}`).join("\n")
          : "$ openvscode-server --host 127.0.0.1 --port 3001\n$ npm run start:api\n$ npm run dev:web"}
      </pre>
    </div>
  );
}

function PreviewPanel({
  settings,
  patchSettings,
  t,
}: {
  settings: DevHubSettings;
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  t: (key: keyof (typeof copy)["ru"]) => string;
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

function GithubPanel({
  settings,
  patchSettings,
  workspaceStatus,
  statuses,
  onRefresh,
  onAction,
  t,
}: {
  settings: DevHubSettings;
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  workspaceStatus: WorkspaceStatus | null;
  statuses: IntegrationStatus[];
  onRefresh: () => void;
  onAction: (response: WorkspaceActionResponse) => void;
  t: (key: keyof (typeof copy)["ru"]) => string;
}) {
  const [repoName, setRepoName] = useState(workspaceStatus?.github.repository ?? "devagent-hub");
  const [commitMessage, setCommitMessage] = useState("Update DevAgent Hub workspace");
  const [isBusy, setIsBusy] = useState(false);
  const changedFiles = useMemo(() => workspaceStatus?.git.changes.map(changedPath).filter(isNonEmptyString) ?? [], [workspaceStatus]);

  async function runAction(action: () => Promise<WorkspaceActionResponse>) {
    setIsBusy(true);
    try {
      onAction(await action());
    } catch (caught) {
      onAction({
        ok: false,
        message: caught instanceof Error ? caught.message : "Workspace action failed.",
        output: "",
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="tab-panel github-panel">
      <PanelHeader
        title={t("githubTitle")}
        subtitle={workspaceStatus?.github.message || t("githubHint")}
        action={
          <button className="secondary-button" onClick={onRefresh}>
            <RotateCcw size={16} />
            {t("refresh")}
          </button>
        }
      />
      <div className="settings-grid">
        <label className="field">
          <span>Owner / organization</span>
          <input value={settings.githubOwner} onChange={(event) => patchSettings({ githubOwner: event.target.value })} placeholder="amave423" />
        </label>
        <label className="field">
          <span>Repository name</span>
          <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="devagent-hub" />
        </label>
        <label className="field">
          <span>Default visibility</span>
          <select
            value={settings.githubDefaultVisibility}
            onChange={(event) => patchSettings({ githubDefaultVisibility: event.target.value as "private" | "public" })}
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="field">
          <span>Commit message</span>
          <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
        </label>
      </div>
      <div className="github-status-grid">
        <Metric label="Workspace" value={workspaceStatus?.rootPath ?? "unknown"} />
        <Metric label="Branch" value={workspaceStatus?.git.branch ?? "not a repo"} />
        <Metric label="Changed files" value={String(changedFiles.length)} />
        <Metric label="Token" value={workspaceStatus?.github.tokenConfigured ? "configured" : "missing"} />
      </div>
      {workspaceStatus?.git.changes.length ? (
        <div className="change-list">
          {workspaceStatus.git.changes.slice(0, 10).map((change) => (
            <code key={change}>{change}</code>
          ))}
        </div>
      ) : null}
      <div className="action-board">
        <article>
          <Github size={18} />
          <strong>Create repository</strong>
          <p>Uses GITHUB_TOKEN or GH_TOKEN and creates the repository through GitHub API.</p>
          <button
            className="secondary-button"
            disabled={isBusy || !workspaceStatus?.github.tokenConfigured || !repoName.trim()}
            onClick={() =>
              void runAction(() =>
                createGitHubRepo({
                  name: repoName.trim(),
                  owner: settings.githubOwner.trim() || null,
                  visibility: settings.githubDefaultVisibility,
                  description: "Created by DevAgent Hub",
                }),
              )
            }
          >
            Create
          </button>
        </article>
        <article>
          <FileCode2 size={18} />
          <strong>Commit changes</strong>
          <p>Stages only changed files reported by git status, then creates a commit.</p>
          <button
            className="secondary-button"
            disabled={isBusy || changedFiles.length === 0 || !commitMessage.trim()}
            onClick={() =>
              void runAction(() =>
                commitGitChanges({
                  message: commitMessage.trim(),
                  files: changedFiles,
                }),
              )
            }
          >
            Commit
          </button>
        </article>
        <article>
          <Github size={18} />
          <strong>Push branch</strong>
          <p>Pushes the current branch to origin and sets upstream on first push.</p>
          <button
            className="secondary-button"
            disabled={isBusy || !workspaceStatus?.git.isRepository || !workspaceStatus.git.branch}
            onClick={() =>
              void runAction(() =>
                pushGitChanges({
                  branch: workspaceStatus?.git.branch,
                  setUpstream: true,
                }),
              )
            }
          >
            Push
          </button>
        </article>
        <article>
          <ShieldCheck size={18} />
          <strong>Pull request</strong>
          <p>Backend endpoint is ready; UI form for PR title/body is next.</p>
          <button className="secondary-button" disabled>
            Next
          </button>
        </article>
      </div>
      <IntegrationCards statuses={statuses.filter((status) => status.id === "github")} t={t} />
    </div>
  );
}

function LogsPanel({
  logs,
  taskState,
  t,
}: {
  logs: AgentLogEvent[];
  taskState: TaskState | null;
  t: (key: keyof (typeof copy)["ru"]) => string;
}) {
  return (
    <div className="tab-panel">
      <PanelHeader title={t("logsTitle")} subtitle={taskState?.taskId ? `Task ${taskState.taskId}` : "No active task"} />
      <div className="log-list">
        {logs.length === 0 && <EmptyToolState icon={<Activity size={28} />} title="No logs" message="Run an agent chain to see live thinking and tool events." />}
        {logs.map((log) => (
          <article className={`log-row level-${log.level}`} key={log.id}>
            <span>{log.progress}%</span>
            <div>
              <strong>{log.agentName ?? log.phase}</strong>
              <p>{log.message}</p>
            </div>
            <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
          </article>
        ))}
      </div>
    </div>
  );
}

function SettingsPanel({
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
  t: (key: keyof (typeof copy)["ru"]) => string;
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
      <PanelHeader title={t("settingsTitle")} subtitle="Configure models, integrations and automation behavior." />
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
              <span>Runner mode</span>
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
              <span>OpenVSCode URL</span>
              <input value={settings.openVsCodeUrl} onChange={(event) => patchSettings({ openVsCodeUrl: event.target.value })} placeholder="http://127.0.0.1:3001" />
            </label>
            <label className="field">
              <span>Preview URL</span>
              <input value={settings.previewUrl} onChange={(event) => patchSettings({ previewUrl: event.target.value })} />
            </label>
          </div>
        </section>

        <section>
          <h3>{t("guardrails")}</h3>
          <div className="guardrail-grid">
            <article>
              <ShieldCheck size={20} />
              <strong>Scoped git writes</strong>
              <span>Require agents to list files before commit.</span>
            </article>
            <article>
              <TestTube2 size={20} />
              <strong>Verify before PR</strong>
              <span>Run configured smoke checks before pushing.</span>
            </article>
            <article>
              <Cpu size={20} />
              <strong>Model routing</strong>
              <span>Use cheaper models for planning, stronger models for review.</span>
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

function RunSummary({
  taskState,
  logs,
  enabledAgents,
  t,
}: {
  taskState: TaskState | null;
  logs: AgentLogEvent[];
  enabledAgents: AgentDefinition[];
  t: (key: keyof (typeof copy)["ru"]) => string;
}) {
  return (
    <section className="rail-card">
      <div className="section-heading compact">
        <div>
          <h3>Run</h3>
          <span>{taskState?.taskId ? taskState.taskId.slice(0, 8) : t("ready")}</span>
        </div>
        <Activity size={18} />
      </div>
      <div className="progress-track">
        <div style={{ width: `${taskState?.progress ?? 0}%` }} />
      </div>
      <div className="metrics-grid">
        <Metric label="Status" value={taskState?.status ?? t("ready")} />
        <Metric label="Agents" value={String(enabledAgents.length)} />
        <Metric label="Events" value={String(logs.length)} />
      </div>
    </section>
  );
}

function IntegrationCards({ statuses, t }: { statuses: IntegrationStatus[]; t: (key: keyof (typeof copy)["ru"]) => string }) {
  return (
    <div className="integration-list">
      {statuses.map((status) => (
        <article className={`integration-card ${status.status}`} key={status.id}>
          <CheckCircle2 size={16} />
          <div>
            <strong>{status.label}</strong>
            <span>{status.detail}</span>
          </div>
          <em>{t(status.status === "connected" ? "connected" : status.status === "planned" ? "planned" : "notConfigured")}</em>
        </article>
      ))}
    </div>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {action}
    </div>
  );
}

function EmptyToolState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="empty-tool-state">
      {icon}
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "busy" | "neutral" }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function loadSettings(config: AgentsConfig): DevHubSettings {
  const fallback = defaultSettings(config);
  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<DevHubSettings>;
    return {
      ...fallback,
      ...parsed,
      modelPurposes: mergePurposes(config, parsed.modelPurposes),
    };
  } catch {
    return fallback;
  }
}

function defaultSettings(config: AgentsConfig): DevHubSettings {
  return {
    language: "ru",
    openVsCodeUrl: "",
    previewUrl: "http://127.0.0.1:5173",
    githubOwner: "",
    githubDefaultVisibility: "private",
    modelPurposes: mergePurposes(config),
  };
}

function mergePurposes(config: AgentsConfig, stored: ModelPurpose[] = []): ModelPurpose[] {
  const fallbackModelId = config.models[0]?.id ?? "";
  return purposeDefinitions.map((purpose) => ({
    ...purpose,
    modelId: stored.find((item) => item.id === purpose.id)?.modelId ?? choosePurposeModel(config.models, purpose.id, fallbackModelId),
  }));
}

function choosePurposeModel(models: AgentModel[], purpose: ModelPurposeId, fallback: string): string {
  const cloud = models.find((model) => model.kind === "cloud")?.id;
  const local = models.find((model) => model.kind === "local")?.id;
  if (purpose === "review" || purpose === "final") return cloud ?? local ?? fallback;
  return local ?? cloud ?? fallback;
}

function applyPurposeModels(config: AgentsConfig, settings: DevHubSettings): AgentsConfig {
  const purposeById = Object.fromEntries(settings.modelPurposes.map((purpose) => [purpose.id, purpose.modelId])) as Record<ModelPurposeId, string>;
  return {
    ...config,
    agents: config.agents.map((agent) => {
      const purpose = agentPurposeMap[agent.id] ?? "coding";
      return {
        ...agent,
        modelId: purposeById[purpose] ?? agent.modelId,
      };
    }),
  };
}

function normalizeAgentOrder(config: AgentsConfig): AgentsConfig {
  return {
    ...config,
    agents: config.agents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((agent, index) => ({ ...agent, order: index + 1 })),
  };
}

function changedPath(statusLine: string): string | null {
  const path = statusLine.slice(3).trim();
  if (!path) return null;
  if (path.includes(" -> ")) {
    return path.split(" -> ").at(-1) ?? null;
  }
  return path;
}

function isNonEmptyString(value: string | null): value is string {
  return Boolean(value);
}
