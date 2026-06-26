import { useEffect, useState } from "react";
import { X } from "lucide-react";

import type { AgentDefinition, AgentModel } from "../../types";

interface AgentConfigModalProps {
  open: boolean;
  agent: AgentDefinition | null;
  models: AgentModel[];
  onClose: () => void;
  onSave: (agent: AgentDefinition) => void;
}

export function AgentConfigModal({ open, agent, models, onClose, onSave }: AgentConfigModalProps) {
  const [draft, setDraft] = useState<AgentDefinition | null>(agent);

  useEffect(() => {
    setDraft(agent);
  }, [agent]);

  if (!open || !draft) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Настройка агента</h2>
            <span>{draft.id}</span>
          </div>
          <button className="icon-button" title="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <label className="field">
          <span>Имя</span>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>

        <label className="field">
          <span>Модель</span>
          <select value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.provider}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Системный промпт</span>
          <textarea
            value={draft.systemPrompt}
            onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
            rows={8}
          />
        </label>

        <footer className="modal-actions">
          <label className="checkline">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            Включен
          </label>
          <button className="primary-button" onClick={() => onSave(draft)}>
            Сохранить агента
          </button>
        </footer>
      </section>
    </div>
  );
}

