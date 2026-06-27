import React from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import AgentStudioService from "#/api/agent-studio-service/agent-studio.api";
import {
  AgentDefinition,
  AgentLogEvent,
  AgentsConfig,
  TaskState,
} from "#/api/agent-studio-service/agent-studio.types";
import { BrandButton } from "#/components/features/settings/brand-button";
import { Typography } from "#/ui/typography";
import { createPermissionGuard } from "#/utils/org/permission-guard";

export const clientLoader = createPermissionGuard("view_llm_settings");

const DEFAULT_TASK =
  "Проверь цепочку агентов на короткой задаче и верни итоговый результат.";

export default function MultiAgentSettingsScreen() {
  const [config, setConfig] = React.useState<AgentsConfig | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRunning, setIsRunning] = React.useState(false);
  const [taskText, setTaskText] = React.useState(DEFAULT_TASK);
  const [taskState, setTaskState] = React.useState<TaskState | null>(null);
  const [logs, setLogs] = React.useState<AgentLogEvent[]>([]);
  const [draggedAgentId, setDraggedAgentId] = React.useState<string | null>(
    null,
  );
  const eventSourceRef = React.useRef<EventSource | null>(null);

  React.useEffect(() => {
    AgentStudioService.getConfig()
      .then((nextConfig) => {
        setConfig(normalizeAgentOrder(nextConfig));
        setError(null);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setIsLoading(false));

    return () => eventSourceRef.current?.close();
  }, []);

  const enabledAgents = React.useMemo(
    () => config?.agents.filter((agent) => agent.enabled) ?? [],
    [config],
  );

  const updateConfig = React.useCallback(
    (updater: (current: AgentsConfig) => AgentsConfig) => {
      setConfig((current) =>
        current ? normalizeAgentOrder(updater(current)) : current,
      );
    },
    [],
  );

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await AgentStudioService.saveConfig(
        normalizeAgentOrder(config),
      );
      setConfig(saved);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось сохранить конфигурацию.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async () => {
    if (!config || !taskText.trim()) return;
    eventSourceRef.current?.close();
    setIsRunning(true);
    setError(null);
    setLogs([]);
    setTaskState(null);

    try {
      const response = await AgentStudioService.run(taskText.trim(), config);
      const initialState = await AgentStudioService.getStatus(response.taskId);
      setTaskState(initialState);
      eventSourceRef.current = AgentStudioService.subscribeToLogs(
        response.taskId,
        {
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
        },
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось запустить цепочку.",
      );
      setIsRunning(false);
    }
  };

  const handleCancel = async () => {
    if (!taskState) return;
    setError(null);
    try {
      const cancelledState = await AgentStudioService.cancel(taskState.taskId);
      eventSourceRef.current?.close();
      setTaskState(cancelledState);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось остановить цепочку.",
      );
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex items-center gap-2 text-tertiary-alt">
        <Loader2 size={16} className="animate-spin" />
        <Typography.Text>Загрузка мультиагентной конфигурации</Typography.Text>
      </div>
    );
  }

  return (
    <div
      data-testid="multi-agent-settings-screen"
      className="flex flex-col gap-6 pb-10"
    >
      {error && (
        <div className="rounded-sm border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Typography.Paragraph className="text-tertiary-alt">
              Настройте порядок, модели и системные промпты агентской цепочки.
            </Typography.Paragraph>
            <BrandButton
              type="button"
              variant="secondary"
              startContent={<Plus size={16} />}
              onClick={() => addAgent(config, updateConfig)}
            >
              Добавить
            </BrandButton>
          </div>

          {config.agents.map((agent, index) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              config={config}
              isActive={taskState?.activeAgentId === agent.id}
              isDragging={draggedAgentId === agent.id}
              isFirst={index === 0}
              isLast={index === config.agents.length - 1}
              onDragStart={() => setDraggedAgentId(agent.id)}
              onDragEnd={() => setDraggedAgentId(null)}
              onDrop={() => {
                if (draggedAgentId && draggedAgentId !== agent.id) {
                  reorderAgent(draggedAgentId, agent.id, config, updateConfig);
                }
                setDraggedAgentId(null);
              }}
              onPatch={(patch) =>
                updateConfig((current) => ({
                  ...current,
                  agents: current.agents.map((item) =>
                    item.id === agent.id ? { ...item, ...patch } : item,
                  ),
                }))
              }
              onMove={(direction) =>
                moveAgent(agent.id, direction, config, updateConfig)
              }
              onDelete={() => deleteAgent(agent.id, config, updateConfig)}
            />
          ))}

          <RuntimePanel config={config} updateConfig={updateConfig} />
        </div>

        <aside className="flex flex-col gap-4 rounded-sm border border-[#3D4046] bg-tertiary p-4">
          <div className="flex items-center gap-2">
            <Bot size={18} />
            <Typography.H3>Проверочный запуск</Typography.H3>
          </div>

          <textarea
            className="min-h-[104px] rounded-sm border border-[#717888] bg-base p-2 text-sm text-white focus:border-white focus:outline-none"
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
          />

          <div className="h-2 overflow-hidden rounded-full bg-[#2D3138]">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${taskState?.progress ?? 0}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-tertiary-alt">
            <span>{enabledAgents.length} активных агентов</span>
            <span>{taskState?.status ?? "ready"}</span>
          </div>

          <BrandButton
            type="button"
            variant="primary"
            isDisabled={isRunning || enabledAgents.length === 0}
            startContent={
              isRunning ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )
            }
            onClick={() => void handleRun()}
          >
            Запустить цепочку
          </BrandButton>

          {isRunning && (
            <BrandButton
              type="button"
              variant="secondary"
              isDisabled={!taskState}
              startContent={<Square size={16} />}
              onClick={() => void handleCancel()}
            >
              Остановить
            </BrandButton>
          )}

          <div className="max-h-[360px] overflow-auto rounded-sm border border-[#3D4046] bg-base p-2">
            {logs.length === 0 ? (
              <Typography.Paragraph className="text-tertiary-alt">
                Логи появятся после запуска.
              </Typography.Paragraph>
            ) : (
              <div className="flex flex-col gap-2">
                {logs.map((log) => (
                  <article
                    key={log.id}
                    className="rounded-sm bg-[#171B21] p-2 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-tertiary-alt">
                      <span>{log.agentName ?? log.phase}</span>
                      <span>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-white">{log.message}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          {taskState?.result && (
            <pre className="max-h-[220px] overflow-auto rounded-sm border border-[#3D4046] bg-base p-2 text-xs text-gray-200">
              {taskState.result}
            </pre>
          )}
        </aside>
      </section>

      <div className="sticky bottom-0 bg-base py-4">
        <BrandButton
          type="button"
          variant="primary"
          isDisabled={isSaving}
          startContent={
            isSaving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )
          }
          onClick={() => void handleSave()}
        >
          {isSaving ? "Сохранение" : "Сохранить конфигурацию"}
        </BrandButton>
      </div>
    </div>
  );
}

function RuntimePanel({
  config,
  updateConfig,
}: {
  config: AgentsConfig;
  updateConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void;
}) {
  const patchRuntime = (patch: Partial<AgentsConfig["runtime"]>) => {
    updateConfig((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        ...patch,
      },
    }));
  };

  return (
    <section className="rounded-sm border border-[#3D4046] bg-tertiary p-4">
      <div className="mb-4 flex items-center gap-2">
        <SlidersHorizontal size={18} />
        <Typography.H3>Выполнение</Typography.H3>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <Typography.Text className="text-xs text-tertiary-alt">
            Режим
          </Typography.Text>
          <select
            className="h-9 rounded-sm border border-[#717888] bg-base px-2 text-sm text-white focus:border-white focus:outline-none"
            value={config.runtime.runnerMode}
            onChange={(event) =>
              patchRuntime({
                runnerMode: event.target
                  .value as AgentsConfig["runtime"]["runnerMode"],
              })
            }
          >
            <option value="auto">Auto</option>
            <option value="live">Live only</option>
            <option value="mock">Mock</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <Typography.Text className="text-xs text-tertiary-alt">
            Timeout, sec
          </Typography.Text>
          <input
            type="number"
            min={5}
            max={600}
            className="h-9 rounded-sm border border-[#717888] bg-base px-2 text-sm text-white focus:border-white focus:outline-none"
            value={config.runtime.requestTimeoutSeconds}
            onChange={(event) =>
              patchRuntime({
                requestTimeoutSeconds: clampInteger(event.target.value, 5, 600),
              })
            }
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <Typography.Text className="text-xs text-tertiary-alt">
            Max output
          </Typography.Text>
          <input
            type="number"
            min={1000}
            max={100000}
            step={1000}
            className="h-9 rounded-sm border border-[#717888] bg-base px-2 text-sm text-white focus:border-white focus:outline-none"
            value={config.runtime.maxOutputChars}
            onChange={(event) =>
              patchRuntime({
                maxOutputChars: clampInteger(event.target.value, 1000, 100000),
              })
            }
          />
        </label>
      </div>
    </section>
  );
}

function AgentCard({
  agent,
  config,
  isActive,
  isDragging,
  isFirst,
  isLast,
  onDragStart,
  onDragEnd,
  onDrop,
  onPatch,
  onMove,
  onDelete,
}: {
  agent: AgentDefinition;
  config: AgentsConfig;
  isActive: boolean;
  isDragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onPatch: (patch: Partial<AgentDefinition>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={[
        "rounded-sm border bg-tertiary p-4",
        isActive ? "border-primary" : "border-[#3D4046]",
        isDragging ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <label className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            title="Перетащить"
            className="mt-1 cursor-grab text-tertiary-alt active:cursor-grabbing"
          >
            <GripVertical size={16} />
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-primary"
            checked={agent.enabled}
            onChange={(event) => onPatch({ enabled: event.target.checked })}
          />
          <div className="min-w-0 flex-1">
            <input
              className="w-full rounded-sm border border-[#717888] bg-base px-2 py-1 text-sm font-semibold text-white focus:border-white focus:outline-none"
              value={agent.name}
              onChange={(event) => onPatch({ name: event.target.value })}
            />
            <Typography.Text className="mt-1 block text-xs text-tertiary-alt">
              order {agent.order} · {agent.id}
            </Typography.Text>
          </div>
        </label>

        <div className="flex items-center gap-2">
          <IconButton
            label="Выше"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            <ChevronUp size={15} />
          </IconButton>
          <IconButton label="Ниже" disabled={isLast} onClick={() => onMove(1)}>
            <ChevronDown size={15} />
          </IconButton>
          <IconButton label="Удалить" onClick={onDelete}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5">
          <Typography.Text className="text-xs text-tertiary-alt">
            Модель
          </Typography.Text>
          <select
            className="h-9 rounded-sm border border-[#717888] bg-base px-2 text-sm text-white focus:border-white focus:outline-none"
            value={agent.modelId}
            onChange={(event) => onPatch({ modelId: event.target.value })}
          >
            {config.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <Typography.Text className="text-xs text-tertiary-alt">
            Системный промпт
          </Typography.Text>
          <textarea
            className="min-h-[92px] rounded-sm border border-[#717888] bg-base p-2 text-sm text-white focus:border-white focus:outline-none"
            value={agent.systemPrompt}
            onChange={(event) => onPatch({ systemPrompt: event.target.value })}
          />
        </label>
      </div>
    </article>
  );
}

function IconButton({
  label,
  disabled,
  children,
  onClick,
}: React.PropsWithChildren<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-sm border border-[#3D4046] text-gray-200 hover:border-primary disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function addAgent(
  config: AgentsConfig,
  updateConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void,
) {
  const nextIndex = config.agents.length + 1;
  updateConfig((current) => ({
    ...current,
    agents: [
      ...current.agents,
      {
        id: `custom-${Date.now()}`,
        name: `Agent ${nextIndex}`,
        enabled: true,
        order: nextIndex,
        modelId: current.models[0]?.id ?? "",
        systemPrompt: "Опишите роль агента и критерии качества его ответа.",
      },
    ],
  }));
}

function deleteAgent(
  agentId: string,
  config: AgentsConfig,
  updateConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void,
) {
  if (config.agents.length <= 1) return;
  updateConfig((current) => ({
    ...current,
    agents: current.agents.filter((agent) => agent.id !== agentId),
  }));
}

function moveAgent(
  agentId: string,
  direction: -1 | 1,
  config: AgentsConfig,
  updateConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void,
) {
  const index = config.agents.findIndex((agent) => agent.id === agentId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= config.agents.length)
    return;

  updateConfig((current) => {
    const agents = current.agents.slice();
    const [agent] = agents.splice(index, 1);
    agents.splice(targetIndex, 0, agent);
    return { ...current, agents };
  });
}

function reorderAgent(
  draggedAgentId: string,
  targetAgentId: string,
  config: AgentsConfig,
  updateConfig: (updater: (current: AgentsConfig) => AgentsConfig) => void,
) {
  const sourceIndex = config.agents.findIndex(
    (agent) => agent.id === draggedAgentId,
  );
  const targetIndex = config.agents.findIndex(
    (agent) => agent.id === targetAgentId,
  );
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

  updateConfig((current) => {
    const agents = current.agents.slice();
    const [draggedAgent] = agents.splice(sourceIndex, 1);
    agents.splice(targetIndex, 0, draggedAgent);
    return { ...current, agents };
  });
}

function normalizeAgentOrder(config: AgentsConfig): AgentsConfig {
  return {
    ...config,
    runtime: normalizeRuntime(config.runtime),
    agents: config.agents
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((agent, index) => ({ ...agent, order: index + 1 })),
  };
}

function normalizeRuntime(
  runtime: Partial<AgentsConfig["runtime"]>,
): AgentsConfig["runtime"] {
  return {
    maxParallelTasks: runtime.maxParallelTasks ?? 2,
    logRetention: runtime.logRetention ?? 2000,
    runnerMode: runtime.runnerMode ?? "auto",
    requestTimeoutSeconds: runtime.requestTimeoutSeconds ?? 120,
    maxOutputChars: runtime.maxOutputChars ?? 12000,
  };
}

function clampInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}
