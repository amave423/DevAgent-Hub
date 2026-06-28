import { useState } from "react";
import type { ReactNode } from "react";
import { Code2, Files, Globe2, MessageSquareText, TerminalSquare } from "lucide-react";

import type { AgentLogEvent } from "../../types";

type WorkspaceTab = "chat" | "files" | "editor" | "terminal" | "browser";

interface WorkspacePanelProps {
  result?: string | null;
  logs: AgentLogEvent[];
}

const tabs: Array<{ id: WorkspaceTab; label: string; icon: ReactNode }> = [
  { id: "chat", label: "Чат", icon: <MessageSquareText size={16} /> },
  { id: "files", label: "Файлы", icon: <Files size={16} /> },
  { id: "editor", label: "Код", icon: <Code2 size={16} /> },
  { id: "terminal", label: "Терминал", icon: <TerminalSquare size={16} /> },
  { id: "browser", label: "Браузер", icon: <Globe2 size={16} /> },
];

export function WorkspacePanel({ result, logs }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chat");
  const [previewUrl, setPreviewUrl] = useState("https://example.com");

  return (
    <section className="workspace-panel">
      <nav className="workspace-tabs" aria-label="Рабочие области">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="workspace-body">
        {activeTab === "chat" && (
          <div className="chat-output">
            <article className="message user-message">
              <strong>Задача</strong>
              <p>Запуск идет через выбранную цепочку агентов и сохраняет логи в правой панели.</p>
            </article>
            <article className="message assistant-message">
              <strong>Результат</strong>
              <p>{result ?? "Финальный результат появится после завершения текущей задачи."}</p>
            </article>
          </div>
        )}

        {activeTab === "files" && (
          <div className="file-tree">
            <button>configs/agents.json</button>
            <button>services/agent-api/app/main.py</button>
            <button>apps/web/src/App.tsx</button>
            <button>installer/main.js</button>
          </div>
        )}

        {activeTab === "editor" && (
          <textarea
            className="code-editor"
            spellCheck={false}
            defaultValue={`export const chain = ["Generator", "Critic", "Optimizer", "Tester", "Finalizer"];\n\n// Браузерный редактор предоставляет OpenVSCode/code-server.`}
          />
        )}

        {activeTab === "terminal" && (
          <pre className="terminal-view">
            {logs.length === 0
              ? "$ npm run start:api\n$ npm run dev:web"
              : logs.map((log) => `[${log.phase}] ${log.message}`).join("\n")}
          </pre>
        )}

        {activeTab === "browser" && (
          <div className="browser-view">
            <input value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} />
            <iframe title="preview" src={previewUrl} sandbox="allow-scripts allow-same-origin allow-forms" />
          </div>
        )}
      </div>
    </section>
  );
}
