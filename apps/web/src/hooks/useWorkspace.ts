import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commitGitChanges,
  createGitHubRepo,
  getWorkspaceStatus,
  pushGitChanges,
  startOpenVSCode,
  stopOpenVSCode,
  installOpenVSCode,
} from "../api/workspace";
import type { DevHubSettings, IntegrationStatus, WorkspaceActionResponse, WorkspaceStatus } from "../types";

export function useWorkspace(settings: DevHubSettings | null) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [isStartingEditor, setIsStartingEditor] = useState(false);

  const effectiveOpenVsCodeUrl = settings?.openVsCodeUrl || workspaceStatus?.openVsCode.url || "";

  const integrationStatuses = useMemo<IntegrationStatus[]>(
    () => [
      {
        id: "openvscode",
        label: "OpenVSCode Server",
        status: effectiveOpenVsCodeUrl ? "connected" : workspaceStatus?.openVsCode.configured ? "planned" : "not_configured",
        detail: workspaceStatus?.openVsCode.message || effectiveOpenVsCodeUrl || "Not configured.",
      },
      {
        id: "github",
        label: "GitHub automation",
        status: workspaceStatus?.github.tokenConfigured ? "connected" : settings?.githubOwner ? "planned" : "not_configured",
        detail: workspaceStatus?.github.tokenConfigured
          ? workspaceStatus.github.repository
            ? `Repository: ${workspaceStatus.github.repository}`
            : "GITHUB_TOKEN is configured."
          : workspaceStatus?.github.message || "Set GITHUB_TOKEN or GH_TOKEN to enable automation.",
      },
      {
        id: "terminal",
        label: "Runtime terminal",
        status: "connected",
        detail: "Terminal is available via WebSocket PTY.",
      },
    ],
    [effectiveOpenVsCodeUrl, settings, workspaceStatus],
  );

  useEffect(() => {
    getWorkspaceStatus()
      .then(setWorkspaceStatus)
      .catch((caught) => setWorkspaceNotice(caught instanceof Error ? caught.message : "Workspace unavailable."));
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const next = await getWorkspaceStatus();
      setWorkspaceStatus(next);
      setWorkspaceNotice(next.git.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to refresh workspace.");
    }
  }, []);

  const handleStartOpenVSCode = useCallback(async () => {
    setIsStartingEditor(true);
    setWorkspaceNotice(null);
    try {
      const next = await startOpenVSCode({
        port: 3001,
        workspacePath: workspaceStatus?.rootPath,
      });
      setWorkspaceStatus(next);
      if (next.openVsCode.url && settings) {
        // Note: caller should patch settings
      }
      setWorkspaceNotice(next.openVsCode.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to start OpenVSCode Server.");
    } finally {
      setIsStartingEditor(false);
    }
  }, [workspaceStatus, settings]);

  const handleStopOpenVSCode = useCallback(async () => {
    setIsStartingEditor(true);
    setWorkspaceNotice(null);
    try {
      const next = await stopOpenVSCode();
      setWorkspaceStatus(next);
      setWorkspaceNotice(next.openVsCode.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to stop OpenVSCode Server.");
    } finally {
      setIsStartingEditor(false);
    }
  }, []);

  const handleInstallOpenVSCode = useCallback(async () => {
    setIsStartingEditor(true);
    setWorkspaceNotice(null);
    try {
      const result = await installOpenVSCode();
      setWorkspaceNotice(result.message);
      await refreshWorkspace();
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Failed to install OpenVSCode Server.");
    } finally {
      setIsStartingEditor(false);
    }
  }, [refreshWorkspace]);

  async function runWorkspaceAction(action: () => Promise<WorkspaceActionResponse>): Promise<WorkspaceActionResponse> {
    try {
      const result = await action();
      setWorkspaceNotice(result.message);
      await refreshWorkspace();
      return result;
    } catch (caught) {
      const response: WorkspaceActionResponse = {
        ok: false,
        message: caught instanceof Error ? caught.message : "Workspace action failed.",
        output: "",
      };
      setWorkspaceNotice(response.message);
      return response;
    }
  }

  return {
    workspaceStatus,
    workspaceNotice,
    setWorkspaceNotice,
    isStartingEditor,
    effectiveOpenVsCodeUrl,
    integrationStatuses,
    refreshWorkspace,
    handleStartOpenVSCode,
    handleStopOpenVSCode,
    handleInstallOpenVSCode,
    runWorkspaceAction,
  };
}
