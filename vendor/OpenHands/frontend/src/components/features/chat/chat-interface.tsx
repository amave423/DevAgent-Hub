import React from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Bot, Loader2 } from "lucide-react";
import AgentStudioService from "#/api/agent-studio-service/agent-studio.api";
import {
  AgentLogEvent,
  TaskState,
} from "#/api/agent-studio-service/agent-studio.types";
import { convertImageToBase64 } from "#/utils/convert-image-to-base-64";
import { createChatMessage } from "#/services/chat-service";
import { BtwMessages } from "./btw-messages";
import { ModelMessages } from "./model-messages";
import { InteractiveChatBox } from "./interactive-chat-box";
import { AgentState } from "#/types/agent-state";
import { useFilteredEvents } from "#/hooks/use-filtered-events";
import { useScrollToBottom } from "#/hooks/use-scroll-to-bottom";
import { TypingIndicator } from "./typing-indicator";
import { ChatSuggestions } from "./chat-suggestions";
import { ScrollProvider } from "#/context/scroll-context";
import { useSendMessage } from "#/hooks/use-send-message";
import { useAgentState } from "#/hooks/use-agent-state";
import { useHandleBuildPlanClick } from "#/hooks/use-handle-build-plan-click";

import { ScrollToBottomButton } from "#/components/shared/buttons/scroll-to-bottom-button";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { ChatMessagesSkeleton } from "./chat-messages-skeleton";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { useErrorMessageStore } from "#/stores/error-message-store";
import { useOptimisticUserMessageStore } from "#/stores/optimistic-user-message-store";
import { ErrorMessageBanner } from "./error-message-banner";
import { Messages as V1Messages } from "#/components/v1/chat";
import { useUnifiedUploadFiles } from "#/hooks/mutation/use-unified-upload-files";
import { validateFiles } from "#/utils/file-validation";
import { useConversationStore } from "#/stores/conversation-store";
import ConfirmationModeEnabled from "./confirmation-mode-enabled";
import { useTaskPolling } from "#/hooks/query/use-task-polling";
import { useConversationWebSocket } from "#/contexts/conversation-websocket-context";
import ChatStatusIndicator from "./chat-status-indicator";
import { getStatusColor, getStatusText } from "#/utils/utils";
import { useNewConversationCommand } from "#/hooks/mutation/use-new-conversation-command";
import { I18nKey } from "#/i18n/declaration";
import { ArchivedBanner } from "./archived-banner";
import { useModelStore } from "#/stores/model-store";

export function ChatInterface() {
  const { setMessageToSend } = useConversationStore();
  const { errorMessage, removeErrorMessage } = useErrorMessageStore();
  const { isTask, taskStatus, taskDetail } = useTaskPolling();
  const conversationWebSocket = useConversationWebSocket();
  const { send } = useSendMessage();
  const {
    v0Events,
    v1UiEvents,
    v1FullEvents,
    totalEvents,
    hasSubstantiveAgentActions,
    v1UserEventsExist,
    userEventsExist,
  } = useFilteredEvents();
  const { setOptimisticUserMessage, getOptimisticUserMessage } =
    useOptimisticUserMessageStore();
  const [isAgentStudioEnabled, setIsAgentStudioEnabled] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("agent-studio.chat.enabled") === "true",
  );
  const [agentStudioLogs, setAgentStudioLogs] = React.useState<AgentLogEvent[]>(
    [],
  );
  const [agentStudioTask, setAgentStudioTask] =
    React.useState<TaskState | null>(null);
  const [isAgentStudioRunning, setIsAgentStudioRunning] = React.useState(false);
  const agentStudioEventSourceRef = React.useRef<EventSource | null>(null);
  const { t } = useTranslation();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const {
    scrollDomToBottom,
    onChatBodyScroll,
    hitBottom,
    autoScroll,
    setAutoScroll,
    setHitBottom,
  } = useScrollToBottom(scrollRef);
  const {
    mutate: newConversationCommand,
    isPending: isNewConversationPending,
  } = useNewConversationCommand();

  const { curAgentState, isArchived } = useAgentState();
  const { handleBuildPlanClick } = useHandleBuildPlanClick();

  React.useEffect(() => {
    window.localStorage.setItem(
      "agent-studio.chat.enabled",
      String(isAgentStudioEnabled),
    );
  }, [isAgentStudioEnabled]);

  React.useEffect(() => () => agentStudioEventSourceRef.current?.close(), []);

  // Disable Build button while agent is running (streaming)
  const isAgentRunning =
    curAgentState === AgentState.RUNNING ||
    curAgentState === AgentState.LOADING;

  // Global keyboard shortcut for Build button (Cmd+Enter / Ctrl+Enter)
  // This is placed here instead of PlanPreview to avoid duplicate listeners
  // when multiple PlanPreview components exist in the chat
  React.useEffect(() => {
    if (isAgentRunning) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        handleBuildPlanClick(event);
        scrollDomToBottom();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAgentRunning, handleBuildPlanClick, scrollDomToBottom]);

  const params = useParams();
  const { mutateAsync: uploadFiles } = useUnifiedUploadFiles();

  const optimisticUserMessage = getOptimisticUserMessage();
  const modelEntriesByConversation = useModelStore(
    (s) => s.entriesByConversation,
  );
  const modelEntriesCount =
    (params.conversationId &&
      modelEntriesByConversation[params.conversationId]?.length) ||
    0;
  const hasModelEntries = modelEntriesCount > 0;

  // Show V1 messages immediately if events exist in store (e.g., remount),
  // or once loading completes. This replaces the old transition-observation
  // pattern (useState + useEffect watching loading→loaded) which always showed
  // skeleton on remount because local state initialized to false.
  const showV1Messages =
    v1FullEvents.length > 0 || !conversationWebSocket?.isLoadingHistory;

  const isReturningToConversation = !!params.conversationId;
  // Only show loading skeleton when genuinely loading AND no events in store yet.
  // If events exist (e.g., remount after data was already fetched), skip skeleton.
  const isHistoryLoading = !showV1Messages;
  const isChatLoading = isHistoryLoading && !isTask;

  const handleSendMessage = async (
    content: string,
    originalImages: File[],
    originalFiles: File[],
  ) => {
    // Handle /new command for V1 conversations
    if (content.trim() === "/new") {
      if (!params.conversationId) {
        displayErrorToast(t(I18nKey.CONVERSATION$CLEAR_NO_ID));
        return;
      }
      if (totalEvents === 0) {
        displayErrorToast(t(I18nKey.CONVERSATION$CLEAR_EMPTY));
        return;
      }
      if (isNewConversationPending) {
        return;
      }
      newConversationCommand();
      return;
    }

    if (isAgentStudioEnabled) {
      if (originalImages.length > 0 || originalFiles.length > 0) {
        displayErrorToast(
          "Multi-agent mode currently supports text-only tasks.",
        );
        return;
      }
      await runAgentStudioTask(content);
      return;
    }

    // Create mutable copies of the arrays
    const images = [...originalImages];
    const files = [...originalFiles];
    // Validate file sizes before any processing
    const allFiles = [...images, ...files];
    const validation = validateFiles(allFiles);

    if (!validation.isValid) {
      displayErrorToast(`Error: ${validation.errorMessage}`);
      return; // Stop processing if validation fails
    }

    const promises = images.map((image) => convertImageToBase64(image));
    const imageUrls = await Promise.all(promises);

    const timestamp = new Date().toISOString();

    const { skipped_files: skippedFiles, uploaded_files: uploadedFiles } =
      files.length > 0
        ? await uploadFiles({ conversationId: params.conversationId!, files })
        : { skipped_files: [], uploaded_files: [] };

    skippedFiles.forEach((f) => displayErrorToast(f.reason));

    const filePrompt = `${t("CHAT_INTERFACE$AUGMENTED_PROMPT_FILES_TITLE")}: ${uploadedFiles.join("\n\n")}`;
    const prompt =
      uploadedFiles.length > 0 ? `${content}\n\n${filePrompt}` : content;

    const result = await send(
      createChatMessage(prompt, imageUrls, uploadedFiles, timestamp),
    );
    // Only show optimistic UI if message was sent immediately via WebSocket
    // If queued for later delivery, the message will appear when actually delivered
    if (!result.queued) {
      setOptimisticUserMessage(content);
    }
    setMessageToSend("");
  };

  const runAgentStudioTask = async (content: string) => {
    agentStudioEventSourceRef.current?.close();
    setAgentStudioLogs([]);
    setAgentStudioTask(null);
    setIsAgentStudioRunning(true);
    setOptimisticUserMessage(content);
    setMessageToSend("");

    try {
      const config = await AgentStudioService.getConfig();
      const response = await AgentStudioService.run(content, config);
      const initialState = await AgentStudioService.getStatus(response.taskId);
      setAgentStudioTask(initialState);
      agentStudioEventSourceRef.current = AgentStudioService.subscribeToLogs(
        response.taskId,
        {
          onLog: (event) => {
            setAgentStudioLogs((current) => [...current, event]);
            setAgentStudioTask((current) =>
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
            setAgentStudioTask(state);
            setIsAgentStudioRunning(false);
          },
          onError: (caught) => {
            displayErrorToast(caught.message);
            setIsAgentStudioRunning(false);
          },
        },
      );
    } catch (caught) {
      displayErrorToast(
        caught instanceof Error
          ? caught.message
          : "Failed to run multi-agent chain.",
      );
      setIsAgentStudioRunning(false);
    }
  };

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (autoScroll) {
      scrollDomToBottom();
    }
    // Note: We intentionally exclude autoScroll from deps because we only want
    // to scroll when message content changes, not when autoScroll state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    v1UiEvents.length,
    v0Events.length,
    optimisticUserMessage,
    modelEntriesCount,
    scrollDomToBottom,
  ]);

  // Create a ScrollProvider with the scroll hook values
  const scrollProviderValue = {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
    hitBottom,
    setHitBottom,
    onChatBodyScroll,
  };

  // Get server status indicator props
  const isStartingStatus =
    curAgentState === AgentState.LOADING || curAgentState === AgentState.INIT;
  const isStopStatus = curAgentState === AgentState.STOPPED;
  const isPausing = curAgentState === AgentState.PAUSED;
  const serverStatusColor = getStatusColor({
    isPausing,
    isTask,
    taskStatus,
    isStartingStatus,
    isStopStatus,
    curAgentState,
  });
  const serverStatusText = getStatusText({
    isPausing,
    isTask,
    taskStatus,
    taskDetail,
    isStartingStatus,
    isStopStatus,
    curAgentState,
    errorMessage,
    t,
  });

  return (
    <ScrollProvider value={scrollProviderValue}>
      <div className="h-full flex flex-col justify-between pr-0 md:pr-4 relative">
        {!hasSubstantiveAgentActions &&
          !optimisticUserMessage &&
          !userEventsExist &&
          !isChatLoading &&
          !hasModelEntries && (
            <ChatSuggestions
              onSuggestionsClick={(message) => setMessageToSend(message)}
            />
          )}
        {/* Note: We only hide chat suggestions when there's a user message */}

        <div
          ref={scrollRef}
          onScroll={(e) => onChatBodyScroll(e.currentTarget)}
          className="custom-scrollbar-always flex flex-col grow overflow-y-auto overflow-x-hidden px-4 pt-4 gap-2"
        >
          {isChatLoading && isReturningToConversation && (
            <ChatMessagesSkeleton />
          )}

          {isChatLoading && !isReturningToConversation && (
            <div className="flex justify-center" data-testid="loading-spinner">
              <LoadingSpinner size="small" />
            </div>
          )}

          <ModelMessages
            conversationId={params.conversationId}
            anchorEventId={null}
          />
          {showV1Messages && v1UserEventsExist && (
            <V1Messages messages={v1UiEvents} allEvents={v1FullEvents} />
          )}
          {(agentStudioTask || isAgentStudioRunning) && (
            <AgentStudioChatRun
              task={agentStudioTask}
              logs={agentStudioLogs}
              isRunning={isAgentStudioRunning}
            />
          )}
        </div>

        <div className="flex flex-col gap-[6px]">
          <BtwMessages conversationId={params.conversationId} />
          <div className="flex justify-between relative">
            <div className="flex items-end gap-1">
              <ConfirmationModeEnabled />
              <label className="flex h-7 items-center gap-2 rounded-sm border border-[#3D4046] px-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={isAgentStudioEnabled}
                  onChange={(event) =>
                    setIsAgentStudioEnabled(event.target.checked)
                  }
                />
                Multi-agent
              </label>
              {isStartingStatus && (
                <ChatStatusIndicator
                  statusColor={serverStatusColor}
                  status={serverStatusText}
                />
              )}
            </div>

            <div className="absolute left-1/2 transform -translate-x-1/2 bottom-0">
              {curAgentState === AgentState.RUNNING && <TypingIndicator />}
            </div>

            {!hitBottom && <ScrollToBottomButton onClick={scrollDomToBottom} />}
          </div>

          {errorMessage && (
            <ErrorMessageBanner
              message={errorMessage}
              onDismiss={removeErrorMessage}
            />
          )}

          {isArchived && <ArchivedBanner />}

          {!isArchived && (
            <InteractiveChatBox
              onSubmit={handleSendMessage}
              disabled={isNewConversationPending}
            />
          )}
        </div>
      </div>
    </ScrollProvider>
  );
}

function AgentStudioChatRun({
  task,
  logs,
  isRunning,
}: {
  task: TaskState | null;
  logs: AgentLogEvent[];
  isRunning: boolean;
}) {
  return (
    <section className="my-2 rounded-sm border border-[#3D4046] bg-tertiary p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Bot size={16} />
          <span>Multi-agent run</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-tertiary-alt">
          {isRunning && <Loader2 size={14} className="animate-spin" />}
          <span>{task?.status ?? "starting"}</span>
        </div>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#2D3138]">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${task?.progress ?? 0}%` }}
        />
      </div>

      {logs.length > 0 && (
        <div className="mb-3 max-h-48 overflow-auto rounded-sm border border-[#3D4046] bg-base p-2">
          {logs.map((log) => (
            <article key={log.id} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between text-xs text-tertiary-alt">
                <span>{log.agentName ?? log.phase}</span>
                <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-gray-200">{log.message}</p>
            </article>
          ))}
        </div>
      )}

      {task?.result && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-sm border border-[#3D4046] bg-base p-2 text-xs text-gray-200">
          {task.result}
        </pre>
      )}
    </section>
  );
}
