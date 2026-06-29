import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  getAgentsConfig,
  getTaskStatus,
  runAgents,
  saveAgentsConfig,
  subscribeToLogs,
} from "../api/agents";
import { runChat } from "../api/chats";
import { getRuntimeSettings, saveRuntimeSettings } from "../api/runtime";
import type {
  AgentDefinition,
  AgentLogEvent,
  AgentModel,
  AgentsConfig,
  DevHubSettings,
  ModelPurpose,
  ModelPurposeId,
  TaskState,
} from "../types";

interface RunOptions {
  chatId?: string;
  attachmentIds?: string[];
  agentIds?: string[];
  webSearch?: boolean;
  browserAccess?: boolean;
}

const SETTINGS_KEY = "devagent-hub.settings.v1";

const purposeDefinitions: Array<Omit<ModelPurpose, "modelId">> = [
  {
    id: "planning",
    label: "Planning",
    description: "Task decomposition, architecture choices and launch plans.",
  },
  {
    id: "coding",
    label: "Coding",
    description: "Main implementation, refactoring and code generation.",
  },
  {
    id: "review",
    label: "Review",
    description: "Critique, risks, security and quality checks.",
  },
  {
    id: "testing",
    label: "Testing",
    description: "Test plans, smoke checks and regression analysis.",
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

export function useAgents() {
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [settings, setSettings] = useState<DevHubSettings | null>(null);
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const loadedConfigRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getAgentsConfig()
      .then(async (loadedConfig) => {
        if (cancelled) return;
        let normalizedConfig = normalizeConfig(loadedConfig);
        let loadedSettings = loadSettings(normalizedConfig);
        try {
          const runtime = await getRuntimeSettings();
          normalizedConfig = {
            ...normalizedConfig,
            runtime: {
              ...normalizedConfig.runtime,
              agentMode: runtime.agentMode,
              actionPolicy: runtime.actionPolicy,
            },
          };
          loadedSettings = {
            ...loadedSettings,
            theme: runtime.theme,
            webSearchEnabled: runtime.webSearchEnabled,
            webSearchBaseUrl: runtime.webSearchBaseUrl,
          };
        } catch {
          // Runtime settings are optional during local dev boot.
        }
        if (!cancelled) {
          setConfig(normalizedConfig);
          setSettings(loadedSettings);
        }
      })
      .catch((caught: Error) => setError(caught.message));

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (settings) {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      document.documentElement.dataset.theme = settings.theme;
    }
  }, [settings]);

  useEffect(() => {
    if (!config) return;
    if (!loadedConfigRef.current) {
      loadedConfigRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveAgentsConfig(config)
        .catch((caught: Error) => setError(caught.message));
    }, 700);

    return () => window.clearTimeout(timer);
  }, [config]);

  const language = settings?.language ?? "ru";

  const enabledAgents = useMemo(
    () =>
      config?.agents
        .filter((agent) => agent.enabled)
        .sort((left, right) => left.order - right.order) ?? [],
    [config],
  );

  const patchConfig = useCallback(
    (updater: (current: AgentsConfig) => AgentsConfig) => {
      setConfig((current) => {
        if (!current) return current;
        const next = updater(current);
        return next === current ? current : normalizeConfig(next);
      });
    },
    [],
  );

  const patchSettings = useCallback(
    (patch: Partial<DevHubSettings>) => {
      setSettings((current) => (current ? { ...current, ...patch } : current));
      if (patch.theme) {
        void saveRuntimeSettings({ theme: patch.theme }).catch((caught: Error) => setError(caught.message));
      }
      if (patch.webSearchEnabled !== undefined || patch.webSearchBaseUrl !== undefined) {
        void saveRuntimeSettings({
          webSearchEnabled: patch.webSearchEnabled,
          webSearchBaseUrl: patch.webSearchBaseUrl,
        }).catch((caught: Error) => setError(caught.message));
      }
    },
    [],
  );

  async function handleSave() {
    if (!config || !settings) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveAgentsConfig(config);
      setConfig(normalizeConfig(saved));
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      await saveRuntimeSettings({
        theme: settings.theme,
        agentMode: saved.runtime.agentMode,
        actionPolicy: saved.runtime.actionPolicy,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRun(taskText: string, options: RunOptions = {}) {
    if (!config || !settings || !taskText.trim()) return;

    eventSourceRef.current?.close();
    setIsRunning(true);
    setError(null);
    setLogs([]);
    setTaskState(null);

    try {
      const runtimeConfig = normalizeConfig(config);
      const response = options.chatId
        ? await runChat(options.chatId, {
            content: taskText.trim(),
            attachmentIds: options.attachmentIds ?? [],
            agentIds: options.agentIds ?? enabledAgents.map((agent) => agent.id),
            mode: runtimeConfig.runtime.agentMode,
            actionPolicy: runtimeConfig.runtime.actionPolicy,
            webSearch: Boolean(options.webSearch),
            browserAccess: Boolean(options.browserAccess),
          })
        : await runAgents(taskText.trim(), runtimeConfig);
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
      setError(caught instanceof Error ? caught.message : "Could not start agent chain.");
      setIsRunning(false);
    }
  }

  async function handleCancel() {
    if (!taskState) return;
    try {
      await cancelTask(taskState.taskId);
      setIsRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel task.");
    }
  }

  function resetRun() {
    eventSourceRef.current?.close();
    setLogs([]);
    setTaskState(null);
    setIsRunning(false);
    setError(null);
  }

  function applyPurposes() {
    if (!config || !settings) return;
    patchConfig((current) => applyPurposeModels(current, settings));
  }

  const patchRuntime = useCallback(
    (patch: Partial<AgentsConfig["runtime"]>) => {
      patchConfig((current) => ({
        ...current,
        runtime: { ...current.runtime, ...patch },
      }));
      void saveRuntimeSettings({
        agentMode: patch.agentMode,
        actionPolicy: patch.actionPolicy,
      }).catch((caught: Error) => setError(caught.message));
    },
    [patchConfig],
  );

  return {
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
    setError,
  };
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
      theme: parsed.theme ?? fallback.theme,
      modelPurposes: mergePurposes(config, parsed.modelPurposes),
    };
  } catch {
    return fallback;
  }
}

function defaultSettings(config: AgentsConfig): DevHubSettings {
  return {
    language: "ru",
    theme: "dark",
    openVsCodeUrl: "",
    previewUrl: "http://127.0.0.1:5173",
      githubOwner: "",
      githubDefaultVisibility: "private",
      modelPurposes: mergePurposes(config),
      webSearchEnabled: false,
      webSearchBaseUrl: "",
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
  return normalizeConfig({
    ...config,
    agents: config.agents.map((agent) => {
      const purpose = agentPurposeMap[agent.id] ?? "coding";
      return {
        ...agent,
        modelId: purposeById[purpose] ?? agent.modelId,
      };
    }),
  });
}

function normalizeConfig(config: AgentsConfig): AgentsConfig {
  return {
    ...config,
    runtime: {
      maxParallelTasks: config.runtime?.maxParallelTasks ?? 2,
      logRetention: config.runtime?.logRetention ?? 2000,
      runnerMode: config.runtime?.runnerMode ?? "auto",
      agentMode: config.runtime?.agentMode ?? "plan",
      actionPolicy: config.runtime?.actionPolicy ?? "confirm",
      requestTimeoutSeconds: config.runtime?.requestTimeoutSeconds ?? 120,
      maxOutputChars: config.runtime?.maxOutputChars ?? 12000,
    },
  };
}
