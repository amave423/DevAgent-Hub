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

  const effectiveOpenVsCodeUrl = resolveOpenVsCodeUrl(settings?.openVsCodeUrl || "", workspaceStatus);

  const integrationStatuses = useMemo<IntegrationStatus[]>(
    () => {
      const ru = settings?.language !== "en";
      return [
        {
          id: "openvscode",
          label: "OpenVSCode Server",
          status: effectiveOpenVsCodeUrl ? "connected" : workspaceStatus?.openVsCode.configured ? "planned" : "not_configured",
          detail: workspaceStatus?.openVsCode.message || effectiveOpenVsCodeUrl || (ru ? "Не настроено." : "Not configured."),
        },
        {
          id: "github",
          label: ru ? "GitHub-автоматизация" : "GitHub automation",
          status: workspaceStatus?.github.tokenConfigured ? "connected" : settings?.githubOwner ? "planned" : "not_configured",
          detail: workspaceStatus?.github.tokenConfigured
            ? workspaceStatus.github.repository
              ? `${ru ? "Репозиторий" : "Repository"}: ${workspaceStatus.github.repository}`
              : "GITHUB_TOKEN is configured."
            : workspaceStatus?.github.message || (ru ? "Укажи GITHUB_TOKEN или GH_TOKEN для автоматизации." : "Set GITHUB_TOKEN or GH_TOKEN to enable automation."),
        },
        {
          id: "terminal",
          label: ru ? "Терминал окружения" : "Runtime terminal",
          status: "connected",
          detail: ru ? "Терминал доступен через WebSocket PTY." : "Terminal is available via WebSocket PTY.",
        },
      ];
    },
    [effectiveOpenVsCodeUrl, settings, workspaceStatus],
  );

  useEffect(() => {
    getWorkspaceStatus()
      .then(setWorkspaceStatus)
      .catch((caught) => setWorkspaceNotice(caught instanceof Error ? caught.message : "Рабочая папка недоступна."));
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const next = await getWorkspaceStatus();
      setWorkspaceStatus(next);
      setWorkspaceNotice(next.git.message);
    } catch (caught) {
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Не удалось обновить рабочую папку.");
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
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Не удалось запустить OpenVSCode Server.");
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
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Не удалось остановить OpenVSCode Server.");
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
      setWorkspaceNotice(caught instanceof Error ? caught.message : "Не удалось установить OpenVSCode Server.");
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
        message: caught instanceof Error ? caught.message : "Действие с рабочей папкой не выполнено.",
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

function resolveOpenVsCodeUrl(settingsUrl: string, workspaceStatus: WorkspaceStatus | null): string {
  if (workspaceStatus?.openVsCode.running && workspaceStatus.openVsCode.url) {
    return workspaceStatus.openVsCode.url;
  }

  if (settingsUrl && !isLoopbackEditorUrl(settingsUrl)) {
    return settingsUrl;
  }

  return "";
}

function isLoopbackEditorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
