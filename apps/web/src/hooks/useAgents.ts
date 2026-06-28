import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAgentsConfig,
  getTaskStatus,
  runAgents,
  saveAgentsConfig,
  subscribeToLogs,
  cancelTask,
} from "../api/agents";
import type {
  AgentDefinition,
  AgentLogEvent,
  AgentsConfig,
  AppLanguage,
  DevHubSettings,
  ModelPurpose,
  ModelPurposeId,
  TaskState,
} from "../types";

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

export function useAgents() {
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [settings, setSettings] = useState<DevHubSettings | null>(null);
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    getAgentsConfig()
      .then((loadedConfig) => {
        setConfig(loadedConfig);
        setSettings(loadSettings(loadedConfig));
      })
      .catch((caught: Error) => setError(caught.message));

    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    if (settings) {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings]);

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
      setConfig((current) => (current ? updater(current) : current));
    },
    [],
  );

  const patchSettings = useCallback(
    (patch: Partial<DevHubSettings>) => {
      setSettings((current) => (current ? { ...current, ...patch } : current));
    },
    [],
  );

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

  async function handleRun(taskText: string) {
    if (!config || !settings || !taskText.trim()) return;

    eventSourceRef.current?.close();
    setIsRunning(true);
    setError(null);
    setLogs([]);
    setTaskState(null);

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

  async function handleCancel() {
    if (!taskState) return;
    try {
      await cancelTask(taskState.taskId);
      setIsRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to cancel task.");
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

import type { AgentModel } from "../types";
