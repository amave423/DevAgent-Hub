import { ArrowDown, ArrowUp, BrainCircuit, Eraser } from "lucide-react";
import type { AgentDefinition, AgentsConfig } from "../types";
import type { CopyKey } from "../i18n/ru";
import { PanelHeader } from "../components/PanelHeader";
import type { PageInfoContent } from "../i18n/pageInfo";

export function AgentsPanel({
  config,
  activeAgentId,
  onChange,
  t,
  info,
}: {
  config: AgentsConfig;
  activeAgentId?: string | null;
  onChange: (agents: AgentDefinition[]) => void;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
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
        name: t("newAgentName"),
        enabled: true,
        order: agents.length + 1,
        modelId: config.models[0]?.id ?? "",
        systemPrompt: "",
      },
    ]);
  }

  return (
    <div className="tab-panel">
      <PanelHeader
        title={t("agentsTitle")}
        subtitle={t("agentsSubtitle")}
        info={info}
        infoLabel={t("info")}
        action={
          <button className="secondary-button" onClick={addAgent}>
            <BrainCircuit size={16} />
            {t("addAgent")}
          </button>
        }
      />
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
                  <small>{model?.name ?? t("modelNotSet")}</small>
                </div>
              </header>
              <select value={agent.modelId} onChange={(event) => patchAgent(agent.id, { modelId: event.target.value })}>
                {config.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} / {item.provider}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="button" onClick={() => patchAgent(agent.id, { systemPrompt: "" })}>
                <Eraser size={16} />
                {t("noCustomPrompt")}
              </button>
              <textarea
                value={agent.systemPrompt}
                onChange={(event) => patchAgent(agent.id, { systemPrompt: event.target.value })}
                placeholder={t("newAgentPrompt")}
                rows={6}
              />
              <footer>
                <button className="icon-button" type="button" onClick={() => moveAgent(agent.id, -1)} disabled={index === 0} title={t("moveAgentUp")} aria-label={t("moveAgentUp")}>
                  <ArrowUp size={16} />
                </button>
                <button className="icon-button" type="button" onClick={() => moveAgent(agent.id, 1)} disabled={index === agents.length - 1} title={t("moveAgentDown")} aria-label={t("moveAgentDown")}>
                  <ArrowDown size={16} />
                </button>
                <button className="danger-button" type="button" onClick={() => onChange(agents.filter((item) => item.id !== agent.id))}>
                  {t("remove")}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
