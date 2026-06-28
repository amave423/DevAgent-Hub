import { useMemo, useState } from "react";
import { FileCode2, Github, RefreshCw, ShieldCheck } from "lucide-react";
import type { DevHubSettings, IntegrationStatus, WorkspaceActionResponse, WorkspaceStatus } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { Metric } from "../components/Metric";
import { IntegrationCards } from "../components/IntegrationCard";
import type { CopyKey } from "../i18n/ru";

export function GithubPanel({
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
  t: (key: CopyKey) => string;
}) {
  const [repoName, setRepoName] = useState(workspaceStatus?.github.repository ?? "devagent-hub");
  const [commitMessage, setCommitMessage] = useState("Update DevAgent Hub workspace");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("feature-branch");
  const [isBusy, setIsBusy] = useState(false);
  const changedFiles = useMemo(
    () => workspaceStatus?.git.changes.map(changedPath).filter(isNonEmptyString) ?? [],
    [workspaceStatus],
  );

  async function runAction(action: () => Promise<WorkspaceActionResponse>) {
    setIsBusy(true);
    try {
      const result = await action();
      onAction(result);
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
            <RefreshCw size={16} />
            {t("refresh")}
          </button>
        }
      />
      <div className="settings-grid">
        <label className="field">
          <span>{t("owner")}</span>
          <input value={settings.githubOwner} onChange={(event) => patchSettings({ githubOwner: event.target.value })} placeholder="amave423" />
        </label>
        <label className="field">
          <span>{t("repoName")}</span>
          <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="devagent-hub" />
        </label>
        <label className="field">
          <span>{t("defaultVisibility")}</span>
          <select
            value={settings.githubDefaultVisibility}
            onChange={(event) => patchSettings({ githubDefaultVisibility: event.target.value as "private" | "public" })}
          >
            <option value="private">{t("private")}</option>
            <option value="public">{t("public")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("commitMessage")}</span>
          <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
        </label>
      </div>
      <div className="github-status-grid">
	        <Metric label={t("workspace")} value={workspaceStatus?.rootPath ?? t("unknown")} />
	        <Metric label={t("branch")} value={workspaceStatus?.git.branch ?? t("notRepo")} />
	        <Metric label={t("changedFiles")} value={String(changedFiles.length)} />
	        <Metric label={t("token")} value={workspaceStatus?.github.tokenConfigured ? t("configured") : t("missing")} />
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
          <strong>{t("createRepo")}</strong>
	          <p>{t("githubCreateRepoDesc")}</p>
          <button
            className="secondary-button"
            disabled={isBusy || !workspaceStatus?.github.tokenConfigured || !repoName.trim()}
            onClick={() =>
              void runAction(() =>
                import("../api/workspace").then((m) =>
                  m.createGitHubRepo({
                    name: repoName.trim(),
                    owner: settings.githubOwner.trim() || null,
                    visibility: settings.githubDefaultVisibility,
                    description: "Created by DevAgent Hub",
                  }),
                ),
              )
            }
          >
            {t("create")}
          </button>
        </article>
        <article>
          <FileCode2 size={18} />
          <strong>{t("commitChanges")}</strong>
	          <p>{t("githubCommitDesc")}</p>
          <button
            className="secondary-button"
            disabled={isBusy || changedFiles.length === 0 || !commitMessage.trim()}
            onClick={() =>
              void runAction(() =>
                import("../api/workspace").then((m) =>
                  m.commitGitChanges({
                    message: commitMessage.trim(),
                    files: changedFiles,
                  }),
                ),
              )
            }
          >
            {t("commit")}
          </button>
        </article>
        <article>
          <Github size={18} />
          <strong>{t("pushBranch")}</strong>
	          <p>{t("githubPushDesc")}</p>
          <button
            className="secondary-button"
            disabled={isBusy || !workspaceStatus?.git.isRepository || !workspaceStatus.git.branch}
            onClick={() =>
              void runAction(() =>
                import("../api/workspace").then((m) =>
                  m.pushGitChanges({
                    branch: workspaceStatus?.git.branch,
                    setUpstream: true,
                  }),
                ),
              )
            }
          >
            {t("push")}
          </button>
        </article>
        <article>
          <ShieldCheck size={18} />
          <strong>{t("pullRequest")}</strong>
	          <p>{t("githubPrDesc")}</p>
        </article>
      </div>

      {/* PR form */}
      <div className="pr-form">
        <div className="settings-grid">
          <label className="field">
            <span>{t("prTitle")}</span>
            <input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="Add new feature" />
          </label>
          <label className="field">
            <span>{t("prHead")}</span>
            <input value={prHead} onChange={(event) => setPrHead(event.target.value)} placeholder="feature-branch" />
          </label>
          <label className="field">
            <span>{t("prBase")}</span>
            <input value="main" readOnly />
          </label>
        </div>
        <label className="field">
          <span>{t("prBody")}</span>
	          <textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} rows={3} placeholder={t("describeChanges")} />
        </label>
        <button
          className="secondary-button"
          disabled={isBusy || !workspaceStatus?.github.tokenConfigured || !prTitle.trim() || !workspaceStatus?.github.repository}
          onClick={() =>
            void runAction(async () => {
              const m = await import("../api/workspace");
              const [owner, repo] = (workspaceStatus?.github.repository ?? "").split("/");
              return m.createGitHubPullRequest({
                owner: owner ?? settings.githubOwner,
                repository: repo ?? repoName,
                title: prTitle.trim(),
                head: prHead.trim(),
                base: "main",
                body: prBody.trim(),
              });
            })
          }
        >
          {t("createPR")}
        </button>
      </div>

      <IntegrationCards statuses={statuses.filter((status) => status.id === "github")} t={t} />
    </div>
  );
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
