import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  BrainCircuit,
  Code2,
  Github,
  Globe2,
  Languages,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Moon,
  RotateCcw,
  Settings2,
  ScrollText,
  Sun,
  TerminalSquare,
} from "lucide-react";

import { useAgents } from "./hooks/useAgents";
import { useWorkspace } from "./hooks/useWorkspace";
import { StatusPill } from "./components/StatusPill";
import { ProgressBar } from "./components/ProgressBar";
import { Metric } from "./components/Metric";
import { IntegrationCards } from "./components/IntegrationCard";
import { ChatPanel } from "./panels/ChatPanel";
import { AgentsPanel } from "./panels/AgentsPanel";
import { CodePanel } from "./panels/CodePanel";
import { TerminalPanel } from "./panels/TerminalPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { GithubPanel } from "./panels/GithubPanel";
import { LogsPanel } from "./panels/LogsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { t as translate } from "./i18n";
import { pageInfo } from "./i18n/pageInfo";
import type { WorkbenchTab } from "./types";
import type { CopyKey } from "./i18n/ru";
import { normalizeAgentOrder } from "./utils";

const tabs: Array<{ id: WorkbenchTab; icon: ReactNode; labelKey: CopyKey }> = [
  { id: "chat", icon: <MessageSquareText size={18} />, labelKey: "tabChat" },
  { id: "agents", icon: <BrainCircuit size={18} />, labelKey: "tabAgents" },
  { id: "code", icon: <Code2 size={18} />, labelKey: "tabCode" },
  { id: "terminal", icon: <TerminalSquare size={18} />, labelKey: "tabTerminal" },
  { id: "preview", icon: <Globe2 size={18} />, labelKey: "tabPreview" },
  { id: "github", icon: <Github size={18} />, labelKey: "tabGithub" },
  { id: "logs", icon: <ScrollText size={18} />, labelKey: "tabLogs" },
  { id: "settings", icon: <Settings2 size={18} />, labelKey: "tabSettings" },
];

const ACTIVE_TAB_KEY = "devagent-hub.active-tab";
const THEME_KEY = "devagent-hub.theme";

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

function tabFromHash(): WorkbenchTab | null {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return isWorkbenchTab(hash) ? hash : null;
}

function loadStoredTheme(): "dark" | "light" | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
}

export function App() {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(() => loadActiveTab());
  const [taskText, setTaskText] = useState(
    "Собери план MVP для автономной IDE-панели DevAgent Hub и предложи первые изменения в коде.",
  );
  const autoStartEditorRef = useRef(false);

  useEffect(() => {
    if (taskText.includes("Р") || taskText.includes("С")) {
      setTaskText("");
    }
  }, []);

  const {
    config,
    settings,
    taskState,
    logs,
    isSaving,
    isRunning,
    error,
    language,
    enabledAgents,
    patchConfig,
    patchSettings,
    handleSave,
    handleRun,
    handleCancel,
    resetRun,
    applyPurposes,
    patchRuntime,
  } = useAgents();

  const {
    workspaceStatus,
    workspaceNotice,
    setWorkspaceNotice,
    isStartingEditor,
    effectiveOpenVsCodeUrl,
    integrationStatuses,
    refreshWorkspace,
    handleStartOpenVSCode,
    handleStopOpenVSCode,
    handleInstallOpenVSCode,
  } = useWorkspace(settings);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    if (window.location.hash !== `#${activeTab}`) {
      window.history.replaceState(null, "", `#${activeTab}`);
    }
  }, [activeTab]);

  useEffect(() => {
    function onHashChange() {
      const tab = tabFromHash();
      if (tab) {
        setActiveTab(tab);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const initial = loadStoredTheme();
    if (initial) {
      applyTheme(initial);
    } else if (settings?.theme) {
      applyTheme(settings.theme);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!settings?.theme) return;
    applyTheme(settings.theme);
    window.localStorage.setItem(THEME_KEY, settings.theme);
  }, [settings?.theme]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (config && settings) void handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!workspaceStatus?.openVsCode.configured || workspaceStatus.openVsCode.running || isStartingEditor) return;
    if (autoStartEditorRef.current) return;
    autoStartEditorRef.current = true;
    void handleStartOpenVSCode();
  }, [handleStartOpenVSCode, isStartingEditor, workspaceStatus?.openVsCode.configured, workspaceStatus?.openVsCode.running]);

  const t = (key: CopyKey) => translate(language, key);

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
              title={t(tab.labelKey)}
              data-tooltip={t(tab.labelKey)}
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
              <span>{t("productSubtitle")}</span>
            </div>
          </div>

          <div className="status-strip">
            <StatusPill label={`${enabledAgents.length} ${t("activeAgents")}`} tone="ok" />
            <StatusPill label={taskState?.status ?? t("ready")} tone={isRunning ? "busy" : "neutral"} />
            <StatusPill label={effectiveOpenVsCodeUrl ? "OpenVSCode" : "OpenVSCode off"} tone={effectiveOpenVsCodeUrl ? "ok" : "warn"} />
          </div>

          <div className="topbar-actions">
            <button
              className="icon-button"
              title={language === "ru" ? "Язык" : "Language"}
              onClick={() => patchSettings({ language: language === "ru" ? "en" : "ru" })}
            >
              <Languages size={18} />
              <span>{language.toUpperCase()}</span>
            </button>
            <button
              className="icon-button"
              title={settings.theme === "dark" ? t("lightTheme") : t("darkTheme")}
              onClick={() => patchSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
            >
              {settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="icon-button" title={t("reset")} onClick={resetRun}>
              <RotateCcw size={18} />
            </button>
          </div>
        </header>

        {isSaving && <div className="notice-strip">{t("autosaving")}</div>}
        {error && <div className="error-strip">{error}</div>}
        {workspaceNotice && <div className="notice-strip">{workspaceNotice}</div>}

        <div className={`workspace-layout ${activeTab === "chat" ? "chat-active" : ""}`}>
          <section className="workbench">
            {activeTab === "chat" && (
              <ChatPanel
                language={language}
                taskText={taskText}
                setTaskText={setTaskText}
                taskState={taskState}
                logs={logs}
                isRunning={isRunning}
                onRun={handleRun}
                onCancel={handleCancel}
                t={t}
                config={config}
                patchRuntime={patchRuntime}
                info={pageInfo(language, "chat")}
              />
            )}
            {activeTab === "agents" && (
              <AgentsPanel
                config={config}
                activeAgentId={taskState?.activeAgentId}
                onChange={(agents) =>
                  patchConfig((current) => normalizeAgentOrder({ ...current, agents }))
                }
                t={t}
                info={pageInfo(language, "agents")}
              />
            )}
            {activeTab === "code" && (
              <CodePanel
                effectiveUrl={effectiveOpenVsCodeUrl}
                workspaceStatus={workspaceStatus}
                isStarting={isStartingEditor}
                onInstall={handleInstallOpenVSCode}
                t={t}
                info={pageInfo(language, "code")}
              />
            )}
            {activeTab === "terminal" && <TerminalPanel t={t} info={pageInfo(language, "terminal")} />}
            {activeTab === "preview" && (
              <PreviewPanel settings={settings} patchSettings={patchSettings} t={t} info={pageInfo(language, "preview")} />
            )}
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
                info={pageInfo(language, "github")}
              />
            )}
            {activeTab === "logs" && <LogsPanel logs={logs} taskState={taskState} t={t} info={pageInfo(language, "logs")} />}
            {activeTab === "settings" && (
              <SettingsPanel
                config={config}
                settings={settings}
                statuses={integrationStatuses}
                patchSettings={patchSettings}
                patchConfig={patchConfig}
                t={t}
                info={pageInfo(language, "settings")}
              />
            )}
          </section>

          {activeTab !== "chat" && (
            <aside className="right-rail">
              <RunSummary taskState={taskState} logs={logs} enabledAgents={enabledAgents} t={t} />
              <IntegrationCards statuses={integrationStatuses} t={t} />
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}

function RunSummary({
  taskState,
  logs,
  enabledAgents,
  t,
}: {
  taskState: { taskId?: string; status?: string; progress?: number } | null;
  logs: unknown[];
  enabledAgents: unknown[];
  t: (key: CopyKey) => string;
}) {
  return (
    <section className="rail-card">
      <div className="section-heading compact">
        <div>
          <h3>{t("runSummary")}</h3>
          <span>{taskState?.taskId ? taskState.taskId.slice(0, 8) : t("ready")}</span>
        </div>
        <Activity size={18} />
      </div>
      <ProgressBar value={taskState?.progress ?? 0} />
      <div className="metrics-grid">
        <Metric label={t("status")} value={taskState?.status ?? t("ready")} />
        <Metric label={t("agentsTitle")} value={String(enabledAgents.length)} />
        <Metric label={t("events")} value={String(logs.length)} />
      </div>
    </section>
  );
}

function loadActiveTab(): WorkbenchTab {
  try {
    const hashTab = tabFromHash();
    if (hashTab) {
      return hashTab;
    }
    const stored = window.localStorage.getItem(ACTIVE_TAB_KEY) as WorkbenchTab | null;
    if (isWorkbenchTab(stored)) {
      return stored;
    }
    return "chat";
  } catch {
    return "chat";
  }
}
