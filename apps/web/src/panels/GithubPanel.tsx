import { useMemo, useState } from "react";
import { FileCode2, Github, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  commitGitChanges,
  createGitHubPullRequest,
  createGitHubRepo,
  deleteGitHubToken,
  pushGitChanges,
  saveGitHubToken,
  testGitHubToken,
} from "../api/workspace";
import type { DevHubSettings, IntegrationStatus, WorkspaceActionResponse, WorkspaceStatus } from "../types";
import { PanelHeader } from "../components/PanelHeader";
import { Metric } from "../components/Metric";
import { IntegrationCards } from "../components/IntegrationCard";
import type { CopyKey } from "../i18n/ru";
import type { PageInfoContent } from "../i18n/pageInfo";

export function GithubPanel({
  settings,
  patchSettings,
  workspaceStatus,
  statuses,
  onRefresh,
  onAction,
  t,
  info,
}: {
  settings: DevHubSettings;
  patchSettings: (patch: Partial<DevHubSettings>) => void;
  workspaceStatus: WorkspaceStatus | null;
  statuses: IntegrationStatus[];
  onRefresh: () => void;
  onAction: (response: WorkspaceActionResponse) => void;
  t: (key: CopyKey) => string;
  info: PageInfoContent;
}) {
  const [repoName, setRepoName] = useState(workspaceStatus?.github.repository ?? "devagent-hub");
  const [commitMessage, setCommitMessage] = useState("Update DevAgent Hub workspace");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("feature-branch");
  const [tokenInput, setTokenInput] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
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

  async function runAuthAction(action: () => Promise<{ message: string; login?: string | null }>) {
    setIsAuthBusy(true);
    setAuthNotice(null);
    try {
      const result = await action();
      setAuthNotice(`${result.message}${result.login ? ` ${result.login}` : ""}`);
      setTokenInput("");
      onRefresh();
    } catch (caught) {
      setAuthNotice(caught instanceof Error ? caught.message : "GitHub auth action failed.");
    } finally {
      setIsAuthBusy(false);
    }
  }

  return (
    <div className="tab-panel github-panel">
      <PanelHeader
        title={t("githubTitle")}
        subtitle={workspaceStatus?.github.message || t("githubHint")}
        info={info}
        infoLabel={t("info")}
        action={
          <button className="secondary-button" onClick={onRefresh}>
            <RefreshCw size={16} />
            {t("refresh")}
          </button>
        }
      />
      <section className="github-auth-card">
        <div>
          <KeyRound size={18} />
          <div>
            <strong>{t("githubToken")}</strong>
            <span>{workspaceStatus?.github.tokenConfigured ? t("configured") : t("missing")}</span>
          </div>
        </div>
        <div className="github-auth-row">
          <input
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="github_pat_..."
          />
          <button
            className="secondary-button"
            disabled={isAuthBusy || !tokenInput.trim()}
            onClick={() => void runAuthAction(() => saveGitHubToken(tokenInput.trim()))}
          >
            {isAuthBusy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
            {t("saveToken")}
          </button>
          <button className="secondary-button" disabled={isAuthBusy} onClick={() => void runAuthAction(testGitHubToken)}>
            {t("testToken")}
          </button>
          <button className="danger-button" disabled={isAuthBusy} onClick={() => void runAuthAction(deleteGitHubToken)}>
            <Trash2 size={16} />
            {t("deleteToken")}
          </button>
        </div>
        {authNotice && <div className="notice-strip inline">{authNotice}</div>}
      </section>
      <div className="settings-grid">
        <label className="field">
          <span>{t("owner")}</span>
          <input value={settings.githubOwner} onChange={(event) => patchSettings({ githubOwner: event.target.value })} placeholder="amave423" />
          <small>{t("ownerHelp")}</small>
        </label>
        <label className="field">
          <span>{t("repoName")}</span>
          <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="devagent-hub" />
          <small>{t("repoNameHelp")}</small>
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
          <small>{t("visibilityHelp")}</small>
        </label>
        <label className="field">
          <span>{t("commitMessage")}</span>
          <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
          <small>{t("commitMessageHelp")}</small>
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
                createGitHubRepo({
                  name: repoName.trim(),
                  owner: settings.githubOwner.trim() || null,
                  visibility: settings.githubDefaultVisibility,
                  description: "Created by DevAgent Hub",
                }),
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
                commitGitChanges({
                  message: commitMessage.trim(),
                  files: changedFiles,
                }),
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
                pushGitChanges({
                  branch: workspaceStatus?.git.branch,
                  setUpstream: true,
                }),
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

      <details className="pr-form">
        <summary>{t("pullRequest")}</summary>
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
              const [owner, repo] = (workspaceStatus?.github.repository ?? "").split("/");
              return createGitHubPullRequest({
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
      </details>

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
