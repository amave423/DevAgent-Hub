import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import type { AgentDefinition, AgentModel } from "../../types";

interface AgentPanelProps {
  agents: AgentDefinition[];
  models: AgentModel[];
  activeAgentId?: string | null;
  onCreate: () => void;
  onEdit: (agent: AgentDefinition) => void;
  onChange: (agents: AgentDefinition[]) => void;
}

export function AgentPanel({ agents, models, activeAgentId, onCreate, onEdit, onChange }: AgentPanelProps) {
  const sortedAgents = agents.slice().sort((a, b) => a.order - b.order);

  function patchAgent(id: string, patch: Partial<AgentDefinition>) {
    onChange(sortedAgents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  }

  function deleteAgent(id: string) {
    onChange(sortedAgents.filter((agent) => agent.id !== id));
  }

  function moveAgent(id: string, direction: -1 | 1) {
    const index = sortedAgents.findIndex((agent) => agent.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sortedAgents.length) return;
    const next = sortedAgents.slice();
    const [agent] = next.splice(index, 1);
    next.splice(targetIndex, 0, agent);
    onChange(next.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })));
  }

  return (
    <aside className="agent-panel">
      <div className="panel-heading">
        <div>
          <h2>Агенты</h2>
          <span>{sortedAgents.length} в цепочке</span>
        </div>
        <button className="icon-button" title="Добавить агента" onClick={onCreate}>
          <Plus size={18} />
        </button>
      </div>

      <div className="agent-list">
        {sortedAgents.map((agent, index) => {
          const model = models.find((item) => item.id === agent.modelId);
          const isActive = agent.id === activeAgentId;

          return (
            <article className={`agent-row ${isActive ? "is-active" : ""}`} key={agent.id}>
              <div className="agent-row-main">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    onChange={(event) => patchAgent(agent.id, { enabled: event.target.checked })}
                  />
                  <span />
                </label>
                <div className="agent-copy">
                  <strong>{agent.name}</strong>
	                  <small>{model?.name ?? "модель не выбрана"}</small>
                </div>
              </div>
              <select
                value={agent.modelId}
                onChange={(event) => patchAgent(agent.id, { modelId: event.target.value })}
                aria-label={`Модель для ${agent.name}`}
              >
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="row-actions">
                <button className="icon-button" title="Выше" onClick={() => moveAgent(agent.id, -1)} disabled={index === 0}>
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Ниже"
                  onClick={() => moveAgent(agent.id, 1)}
                  disabled={index === sortedAgents.length - 1}
                >
                  <ArrowDown size={16} />
                </button>
                <button className="icon-button" title="Редактировать" onClick={() => onEdit(agent)}>
                  <Pencil size={16} />
                </button>
                <button className="icon-button danger" title="Удалить" onClick={() => deleteAgent(agent.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
