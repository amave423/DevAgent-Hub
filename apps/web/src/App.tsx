import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, CheckCircle2, Loader2, Play, RotateCcw, Save, Settings2 } from "lucide-react";

import { getAgentsConfig, getTaskStatus, runAgents, saveAgentsConfig, subscribeToLogs } from "./api/agents";
import { AgentConfigModal } from "./components/agents/AgentConfigModal";
import { AgentPanel } from "./components/agents/AgentPanel";
import { ThinkingDisplay } from "./components/agents/ThinkingDisplay";
import { WorkspacePanel } from "./components/workspace/WorkspacePanel";
import type { AgentDefinition, AgentLogEvent, AgentsConfig, TaskState } from "./types";

const emptyTaskState: TaskState | null = null;

export function App() {
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [taskText, setTaskText] = useState("Собери план MVP для панели управления агентами и выдели первые файлы для реализации.");
  const [taskState, setTaskState] = useState<TaskState | null>(emptyTaskState);
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    getAgentsConfig()
      .then(setConfig)
      .catch((caught: Error) => setError(caught.message));

    return () => eventSourceRef.current?.close();
  }, []);

  const enabledAgents = useMemo(
    () => config?.agents.filter((agent) => agent.enabled).sort((a, b) => a.order - b.order) ?? [],
    [config],
  );

  async function handleSaveConfig(nextConfig = config) {
    if (!nextConfig) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveAgentsConfig(nextConfig);
      setConfig(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить конфигурацию.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRun() {
    if (!config || !taskText.trim()) return;
    eventSourceRef.current?.close();
    setIsRunning(true);
    setError(null);
    setLogs([]);
    setTaskState(null);

    try {
      const response = await runAgents(taskText.trim(), config);
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
      setError(caught instanceof Error ? caught.message : "Не удалось запустить цепочку агентов.");
      setIsRunning(false);
    }
  }

  function updateConfig(updater: (current: AgentsConfig) => AgentsConfig) {
    setConfig((current) => (current ? updater(current) : current));
  }

  function handleEditAgent(agent: AgentDefinition) {
    setEditingAgent(agent);
    setIsConfigModalOpen(true);
  }

  function handleCreateAgent() {
    setEditingAgent({
      id: `agent-${Date.now()}`,
      name: "New Agent",
      enabled: true,
      order: (config?.agents.length ?? 0) + 1,
      modelId: config?.models[0]?.id ?? "",
      systemPrompt: "Опиши роль агента и критерии качества его ответа.",
    });
    setIsConfigModalOpen(true);
  }

  function handleUpsertAgent(agent: AgentDefinition) {
    if (!config) return;
    const exists = config.agents.some((item) => item.id === agent.id);
    const agents = exists
      ? config.agents.map((item) => (item.id === agent.id ? agent : item))
      : [...config.agents, agent];
    const nextConfig = normalizeAgentOrder({ ...config, agents });
    setConfig(nextConfig);
    setIsConfigModalOpen(false);
  }

  function handleResetLogs() {
    setLogs([]);
    setTaskState(null);
    setError(null);
    eventSourceRef.current?.close();
    setIsRunning(false);
  }

  if (!config) {
    return (
      <main className="boot-screen">
        <Loader2 className="spin" size={28} />
        <span>Загрузка конфигурации агентов</span>
        {error && <strong>{error}</strong>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Bot size={24} />
          <div>
            <h1>AI Agent Studio</h1>
            <span>OpenHands multi-agent control layer</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Сбросить логи" onClick={handleResetLogs}>
            <RotateCcw size={18} />
          </button>
          <button className="secondary-button" onClick={() => void handleSaveConfig()} disabled={isSaving}>
            {isSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Сохранить
          </button>
          <button className="primary-button" onClick={() => void handleRun()} disabled={isRunning || enabledAgents.length === 0}>
            {isRunning ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Запустить
          </button>
        </div>
      </header>

      {error && <div className="error-strip">{error}</div>}

      <section className="layout-grid">
        <AgentPanel
          agents={config.agents}
          models={config.models}
          activeAgentId={taskState?.activeAgentId}
          onCreate={handleCreateAgent}
          onEdit={handleEditAgent}
          onChange={(agents) => updateConfig((current) => normalizeAgentOrder({ ...current, agents }))}
        />

        <section className="workbench">
          <div className="task-bar">
            <label htmlFor="task-text">Задача для цепочки</label>
            <textarea
              id="task-text"
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              rows={4}
            />
            <div className="task-meta">
              <span>
                <Activity size={15} />
                {enabledAgents.length} активных агентов
              </span>
              <span>
                <CheckCircle2 size={15} />
                {taskState?.status ?? "ready"}
              </span>
            </div>
          </div>
          <WorkspacePanel result={taskState?.result} logs={logs} />
        </section>

        <aside className="inspector">
          <div className="inspector-heading">
            <div>
              <h2>Выполнение</h2>
              <span>{taskState?.taskId ? `task ${taskState.taskId.slice(0, 8)}` : "ожидание запуска"}</span>
            </div>
            <button className="icon-button" title="Настройки" onClick={() => handleSaveConfig()}>
              <Settings2 size={18} />
            </button>
          </div>
          <div className="progress-track">
            <div style={{ width: `${taskState?.progress ?? 0}%` }} />
          </div>
          <ThinkingDisplay logs={logs} />
        </aside>
      </section>

      <AgentConfigModal
        open={isConfigModalOpen}
        agent={editingAgent}
        models={config.models}
        onClose={() => setIsConfigModalOpen(false)}
        onSave={handleUpsertAgent}
      />
    </main>
  );
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

