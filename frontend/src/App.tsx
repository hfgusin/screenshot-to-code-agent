import { useCallback, useEffect, useRef, useState } from "react";
import { generateCode } from "./generateCode";
import { AppState, AppTheme, DesignSession, EditorTheme, Settings } from "./types";
import { NEW_DESIGN_SYSTEM_CONTENT } from "./lib/design-systems";
import { IS_RUNNING_ON_CLOUD } from "./config";
import { OnboardingNote } from "./components/messages/OnboardingNote";
import { usePersistedState } from "./hooks/usePersistedState";
import TermsOfServiceDialog from "./components/TermsOfServiceDialog";
import { USER_CLOSE_WEB_SOCKET_CODE } from "./constants";
import toast from "react-hot-toast";
import { nanoid } from "nanoid";
import { Stack } from "./lib/stacks";
import { CodeGenerationModel } from "./lib/models";
import useBrowserTabIndicator from "./hooks/useBrowserTabIndicator";
import { LuChevronLeft } from "react-icons/lu";
import {
  buildAssistantHistoryMessage,
  buildUserHistoryMessage,
  cloneVariantHistory,
  GenerationRequest,
  registerAssetIds,
  toRequestHistory,
} from "./lib/prompt-history";
// import TipLink from "./components/messages/TipLink";
import { useAppStore } from "./store/app-store";
import { useProjectStore } from "./store/project-store";
import { useDesignSystems } from "./hooks/useDesignSystems";
import { createWorkspaceId, useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import {
  buildSelectedElementInstruction,
  describeElementContext,
} from "./components/select-and-edit/utils";
import {
  classifyGenerationFailure,
  evaluateTargetedEdit,
  parseDesignUpdateIntent,
  routeUserTurn,
  resolveIntentDecision,
  runPreviewSelfCheck,
  summarizeReviewState,
  summarizeImageUpdateStatus,
} from "./lib/design-agent";
import { useEscapeToExitSelectMode } from "./components/select-and-edit/useEscapeToExitSelectMode";
import Sidebar from "./components/sidebar/Sidebar";
import IconStrip from "./components/sidebar/IconStrip";
import HistoryDisplay from "./components/history/HistoryDisplay";
import PreviewPane from "./components/preview/PreviewPane";
import StartPane from "./components/start-pane/StartPane";
import SettingsTab from "./components/settings/SettingsTab";
import DesignSystemsModal from "./components/settings/DesignSystemsModal";
import { Commit } from "./components/commits/types";
import { createCommit } from "./components/commits/utils";

function createEmptyDesignSession(): DesignSession {
  return {
    goal: "",
    constraints: "",
    style: "",
    references: "",
    revisionLog: [],
    lastUpdatedAt: null,
  };
}

function buildSeededDesignSession(
  promptText: string,
  existingSession?: DesignSession,
  extras?: Partial<
    Pick<
      DesignSession,
      | "lastIntent"
      | "intentConfidence"
      | "intentReason"
      | "intentSignals"
      | "intentNeedsClarification"
      | "pendingQuestion"
      | "reviewSummary"
    >
  >
): DesignSession {
  const trimmedPrompt = promptText.trim();
  const goal = trimmedPrompt || existingSession?.goal || "";
  return {
    goal,
    constraints: existingSession?.constraints ?? "",
    style: existingSession?.style ?? "",
    references: existingSession?.references ?? "",
    revisionLog: existingSession?.revisionLog ?? [],
    lastIntent: extras?.lastIntent ?? existingSession?.lastIntent ?? "generate",
    intentConfidence:
      extras?.intentConfidence ?? existingSession?.intentConfidence ?? undefined,
    intentReason: extras?.intentReason ?? existingSession?.intentReason ?? "",
    intentSignals: extras?.intentSignals ?? existingSession?.intentSignals ?? [],
    intentNeedsClarification:
      extras?.intentNeedsClarification ??
      existingSession?.intentNeedsClarification ??
      false,
    pendingQuestion:
      extras?.pendingQuestion ?? existingSession?.pendingQuestion ?? "",
    reviewSummary: extras?.reviewSummary ?? existingSession?.reviewSummary ?? "",
    lastUpdatedAt: new Date().toISOString(),
  };
}

function appendRevisionEntry(
  session: DesignSession,
  entry: string
): DesignSession {
  const trimmedEntry = entry.trim();
  if (!trimmedEntry) {
    return {
      ...session,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  return {
    ...session,
    revisionLog: [...(session.revisionLog ?? []), trimmedEntry].slice(-12),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function summarizeDesignRevision(
  generationType: "create" | "update",
  promptText: string
): string {
  const trimmedPrompt = promptText.trim();
  const prefix = generationType === "create" ? "Create" : "Update";
  if (!trimmedPrompt) {
    return prefix;
  }
  const maxLen = 120;
  const clipped =
    trimmedPrompt.length > maxLen
      ? `${trimmedPrompt.slice(0, maxLen - 1)}…`
      : trimmedPrompt;
  return `${prefix}: ${clipped}`;
}

function App() {
  const {
    // Inputs
    inputMode,
    setInputMode,
    referenceImages,
    setReferenceImages,
    initialPrompt,
    setInitialPrompt,
    upsertPromptAssets,
    resetPromptAssets,

    head,
    draftHead,
    commits,
    addCommit,
    removeCommit,
    setHead,
    setDraftHead,
    appendCommitCode,
    setCommitCode,
    resetCommits,
    resetHead,
    resetDraftHead,
    updateVariantStatus,
    resizeVariants,
    setVariantModels,
    patchVariant,
    appendVariantHistoryMessage,
    startAgentEvent,
    appendAgentEventContent,
    finishAgentEvent,

    // Outputs
    appendExecutionConsole,
    resetExecutionConsoles,
  } = useProjectStore();

  const {
    disableInSelectAndEditMode,
    setUpdateInstruction,
    updateImages,
    setUpdateImages,
    appState,
    setAppState,
    selectedElement,
    setSelectedElement,
  } = useAppStore();

  // Settings
  const [settings, setSettings] = usePersistedState<Settings>(
    {
      openAiApiKey: null,
      openAiBaseURL: null,
      anthropicApiKey: null,
      geminiApiKey: null,
      screenshotOneApiKey: null,
      isImageGenerationEnabled: true,
      editorTheme: EditorTheme.COBALT,
      generatedCodeConfig: Stack.HTML_TAILWIND,
      codeGenerationModel: CodeGenerationModel.CLAUDE_OPUS_4_6,
      selectedDesignSystemId: null,
      // Only relevant for hosted version
      isTermOfServiceAccepted: false,
    },
    "setting"
  );
  const [appTheme, setAppTheme] = usePersistedState<AppTheme>(
    AppTheme.SYSTEM,
    "app-theme"
  );
  const [workspaceId, setWorkspaceId] = usePersistedState<string>(
    createWorkspaceId(),
    "workspace-id"
  );
  const [designSession, setDesignSession] = usePersistedState<DesignSession>(
    createEmptyDesignSession(),
    "design-session"
  );

  const wsRef = useRef<WebSocket>(null);
  const lastThinkingEventIdRef = useRef<Record<number, string>>({});
  const lastAssistantEventIdRef = useRef<Record<number, string>>({});
  const lastToolEventIdRef = useRef<Record<number, string>>({});

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"preview" | "chat">("preview");
  const [isDesignSystemsModalOpen, setIsDesignSystemsModalOpen] =
    useState(false);
  const [designSystemsModalInitialId, setDesignSystemsModalInitialId] =
    useState<string | null>(null);
  const {
    designSystems,
    isLoading: areDesignSystemsLoading,
    createDesignSystem,
    updateDesignSystem,
    deleteDesignSystem,
  } = useDesignSystems();

  const {
    recentWorkspaces,
    openWorkspace,
    flushWorkspaceNow,
    beginWorkspaceTransition,
    endWorkspaceTransition,
  } = useWorkspacePersistence({
    workspaceId,
    setWorkspaceId,
    settings,
    setSettings,
    designSession,
    setDesignSession,
  });

  const setSelectedDesignSystemId = useCallback(
    (id: string | null) => {
      setSettings((prev) => ({ ...prev, selectedDesignSystemId: id }));
    },
    [setSettings]
  );

  const openDesignSystemsManager = useCallback((focusedId?: string | null) => {
    setDesignSystemsModalInitialId(focusedId ?? null);
    setIsDesignSystemsModalOpen(true);
  }, []);

  const handleAddNewDesignSystem = useCallback(async () => {
    try {
      const isFirst = designSystems.length === 0;
      const created = await createDesignSystem({
        name: `Design system ${designSystems.length + 1}`,
        content: NEW_DESIGN_SYSTEM_CONTENT,
      });
      if (isFirst) {
        setSelectedDesignSystemId(created.id);
      }
      openDesignSystemsManager(created.id);
    } catch (error) {
      console.error("Failed to create design system", error);
      toast.error("Could not create design system.");
    }
  }, [
    createDesignSystem,
    designSystems.length,
    openDesignSystemsManager,
    setSelectedDesignSystemId,
  ]);
  // Indicate coding state using the browser tab's favicon and title
  useBrowserTabIndicator(appState === AppState.CODING);

  useEscapeToExitSelectMode();

  // When the user already has the settings in local storage, newly added keys
  // do not get added to the settings so if it's falsy, we populate it with the default
  // value
  useEffect(() => {
    if (!settings.generatedCodeConfig) {
      setSettings((prev) => ({
        ...prev,
        generatedCodeConfig: Stack.HTML_TAILWIND,
      }));
    }
  }, [settings.generatedCodeConfig, setSettings]);

  useEffect(() => {
    if (!("selectedDesignSystemId" in settings)) {
      setSettings((prev) => ({
        ...prev,
        selectedDesignSystemId: null,
      }));
    }
  }, [settings, setSettings]);

  useEffect(() => {
    if (
      settings.selectedDesignSystemId &&
      !areDesignSystemsLoading &&
      !designSystems.some(
        (designSystem) => designSystem.id === settings.selectedDesignSystemId
      )
    ) {
      setSettings((prev) => ({
        ...prev,
        selectedDesignSystemId: null,
      }));
    }
  }, [
    areDesignSystemsLoading,
    designSystems,
    settings.selectedDesignSystemId,
    setSettings,
  ]);

  useEffect(() => {
    if (draftHead !== null || !head) {
      return;
    }
    const snapshot = commits[head]?.inputs?.designSessionSnapshot;
    if (snapshot) {
      setDesignSession(snapshot);
    }
  }, [commits, draftHead, head, setDesignSession]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const isDark =
        appTheme === AppTheme.DARK ||
        (appTheme === AppTheme.SYSTEM && mediaQuery.matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.body.classList.toggle("dark", isDark);
    };

    applyTheme();

    if (appTheme !== AppTheme.SYSTEM) {
      return;
    }

    const onChange = () => applyTheme();
    mediaQuery.addEventListener("change", onChange);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, [appTheme]);

  const getAssetsById = () => useProjectStore.getState().assetsById;

  // Used when the user cancels the code generation
  const cancelCodeGeneration = useCallback(() => {
    wsRef.current?.close?.(USER_CLOSE_WEB_SOCKET_CODE);
  }, []);

  // Functions
  const reset = () => {
    // Stop any in-flight generation so late websocket events can't mutate
    // state after the reset (e.g. flipping the app back to CODE_READY).
    cancelCodeGeneration();
    setAppState(AppState.INITIAL);
    setUpdateInstruction("");
    setUpdateImages([]);
    disableInSelectAndEditMode();
    resetExecutionConsoles();

    resetCommits();
    resetHead();
    resetDraftHead();
    resetPromptAssets();
    setDesignSession(createEmptyDesignSession());

    // Inputs
    setInputMode("image");
    setReferenceImages([]);
  };

  const handleOpenWorkspace = useCallback(
    async (id: string) => {
      cancelCodeGeneration();
      const loaded = await openWorkspace(id);
      if (loaded) {
        setIsHistoryOpen(false);
        setIsSettingsOpen(false);
        setMobilePane("preview");
      }
      return loaded;
    },
    [cancelCodeGeneration, openWorkspace]
  );

  const handleNewProject = useCallback(async () => {
    cancelCodeGeneration();

    const nextWorkspaceId = createWorkspaceId();
    try {
      await flushWorkspaceNow();
    } catch (error) {
      console.error("Failed to checkpoint current workspace before creating a new one", error);
      toast.error("Could not save the current workspace before starting a new one.");
    }

    beginWorkspaceTransition(nextWorkspaceId);
    setWorkspaceId(nextWorkspaceId);
    reset();
    setIsHistoryOpen(false);
    setIsSettingsOpen(false);
    setMobilePane("preview");
    window.setTimeout(() => {
      endWorkspaceTransition();
    }, 0);
  }, [
    beginWorkspaceTransition,
    cancelCodeGeneration,
    endWorkspaceTransition,
    flushWorkspaceNow,
    setWorkspaceId,
  ]);

  useEffect(() => {
    const getQaSnapshot = () => {
      const project = useProjectStore.getState();
      const activeCommitHash = project.draftHead ?? project.head;
      const activeCommit = activeCommitHash ? project.commits[activeCommitHash] : null;
      const activeVariant = activeCommit
        ? activeCommit.variants[activeCommit.selectedVariantIndex]
        : null;
      return {
        workspaceId,
        head: project.head,
        draftHead: project.draftHead,
        latestCommitHash: project.latestCommitHash,
        activeCommitHash,
        activeCommit,
        activeVariant,
        designSession,
      };
    };

    type QaWindow = typeof window & {
      __agentQaSnapshot?: () => unknown;
      __agentQaControls?: {
        openEditor: () => void;
        openHistory: () => void;
        openPreview: () => void;
        createNewProject: () => Promise<void>;
        openWorkspace: (id: string) => Promise<boolean>;
        rollbackToVersion: (versionNumber: number) => boolean;
      };
    };

    const qaWindow = window as QaWindow;
    qaWindow.__agentQaSnapshot = getQaSnapshot;
    qaWindow.__agentQaControls = {
      openEditor: () => {
        setIsHistoryOpen(false);
        setIsSettingsOpen(false);
        setMobilePane("preview");
      },
      openHistory: () => {
        setIsHistoryOpen(true);
        setIsSettingsOpen(false);
        setMobilePane("chat");
      },
      openPreview: () => {
        setIsHistoryOpen(false);
        setIsSettingsOpen(false);
        setMobilePane("preview");
      },
      createNewProject: async () => {
        await handleNewProject();
      },
      openWorkspace: async (id: string) => handleOpenWorkspace(id),
      rollbackToVersion: (versionNumber: number) => {
        const sorted = Object.values(useProjectStore.getState().commits).sort(
          (a, b) =>
            new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
        );
        const commit = sorted[versionNumber - 1];
        if (!commit) {
          return false;
        }
        setHead(commit.hash);
        setIsHistoryOpen(false);
        setIsSettingsOpen(false);
        setMobilePane("preview");
        return true;
      },
    };

    return () => {
      delete qaWindow.__agentQaSnapshot;
      delete qaWindow.__agentQaControls;
    };
  }, [designSession, handleNewProject, handleOpenWorkspace, workspaceId]);

  const regenerate = () => {
    if (head === null) {
      toast.error(
        "No current version set. Please contact support via chat or Github."
      );
      throw new Error("Regenerate called with no head");
    }

    // Retrieve the previous command
    const currentCommit = commits[head];
    if (currentCommit.type !== "ai_create") {
      toast.error("Only the first version can be regenerated.");
      return;
    }

    // Re-run the create
    if (inputMode === "image" || inputMode === "video") {
      void doCreate(referenceImages, inputMode);
    } else {
      // TODO: Fix this
      void doCreateFromText(initialPrompt);
    }
  };

  // Used for user-initiated cancellation and failed edit rollbacks
  const cancelCodeGenerationAndReset = (commit: Commit) => {
    // When the current commit is the first version, reset the entire app state
    if (commit.type === "ai_create") {
      reset();
    } else {
      // Otherwise, remove current commit from commits
      removeCommit(commit.hash);
      resetDraftHead();

      // Revert to parent commit
      const parentCommitHash = commit.parentHash;
      if (parentCommitHash) {
        setHead(parentCommitHash);
      } else {
        throw new Error("Parent commit not found");
      }

      setAppState(AppState.CODE_READY);
    }
  };

  function doGenerateCode(params: GenerationRequest) {
    // Reset the execution console
    resetExecutionConsoles();

    // Set the app state to coding during generation
    setAppState(AppState.CODING);

    const { variantHistory, ...requestParams } = params;
    const revisionId = nanoid();
    const runId = nanoid();
    const activeHead = head;
    const activeCommit = activeHead
      ? useProjectStore.getState().commits[activeHead]
      : undefined;
    const activeDraftCode =
      activeCommit?.variants[activeCommit.selectedVariantIndex]?.code || "";
    const intentDecision =
      requestParams.intentDecision ??
      requestParams.prompt.intentDecision ??
      routeUserTurn({
        text: requestParams.prompt.fullText || requestParams.prompt.text,
        generationType: requestParams.generationType,
        selectedElementHtml: requestParams.prompt.selectedElementHtml,
        currentCode: requestParams.generationType === "update" ? activeDraftCode : "",
      });
    const turnIntent = intentDecision.intent;
    const parentCommitHash =
      requestParams.generationType === "create" ? null : head;
    const requestDesignSession =
      requestParams.designSession ?? designSession;

    const selectedDesignSystem = designSystems.find(
      (designSystem) => designSystem.id === settings.selectedDesignSystemId
    );

    // Merge settings with params
    const updatedParams = {
      ...requestParams,
      runId,
      workspaceId,
      revisionId,
      parentCommitHash,
      previewSelfCheckEnabled: true,
      turnIntent,
      intentDecision,
      ...settings,
      designSystem: selectedDesignSystem?.content ?? null,
      designSession: requestDesignSession,
    };
    const promptWithMetadata = {
      ...requestParams.prompt,
      runId,
      workspaceId,
      revisionId,
      parentCommitHash,
      previewSelfCheckEnabled: true,
      turnIntent,
      intentDecision,
      designSessionSnapshot: requestDesignSession,
    };
    // Mirror the backend's default variant counts to avoid UI flashes while
    // still allowing the backend to expand the count via configuration.
    const initialVariantCount = 1;
    const baseCommitObject = {
      variants: Array(initialVariantCount)
        .fill(null)
        .map(() => ({
          code: "",
          history: cloneVariantHistory(variantHistory),
        })),
    };

    const commitInputObject =
      requestParams.generationType === "create"
        ? {
            ...baseCommitObject,
            type: "ai_create" as const,
            parentHash: null,
            inputs: promptWithMetadata,
          }
        : {
            ...baseCommitObject,
            type: "ai_edit" as const,
            parentHash: head,
            inputs: promptWithMetadata,
          };

    // Create a new commit and stage it as the active draft.
    const commit = createCommit(commitInputObject);
    addCommit(commit);
    setDraftHead(commit.hash);

    lastThinkingEventIdRef.current = {};
    lastAssistantEventIdRef.current = {};
    lastToolEventIdRef.current = {};

    const finishThinkingEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastThinkingEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastThinkingEventIdRef.current[variantIndex];
    };

    const finishAssistantEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastAssistantEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastAssistantEventIdRef.current[variantIndex];
    };

    const finishToolEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastToolEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastToolEventIdRef.current[variantIndex];
    };

    const finishInFlightEvents = (status: "complete" | "error") => {
      Object.keys(lastThinkingEventIdRef.current).forEach((key) => {
        finishThinkingEvent(Number(key), status);
      });
      Object.keys(lastAssistantEventIdRef.current).forEach((key) => {
        finishAssistantEvent(Number(key), status);
      });
      Object.keys(lastToolEventIdRef.current).forEach((key) => {
        finishToolEvent(Number(key), status);
      });
    };

    const variantBackendMetrics = new Map<number, any>();

    generateCode(wsRef, updatedParams, {
      onChange: (token, variantIndex) => {
        appendCommitCode(commit.hash, variantIndex, token);
      },
      onSetCode: (code, variantIndex) => {
        setCommitCode(commit.hash, variantIndex, code);
      },
      onStatusUpdate: (line, variantIndex) =>
        appendExecutionConsole(variantIndex, line),
      onVariantComplete: (variantIndex) => {
        console.log(`Variant ${variantIndex} complete event received`);
        const currentCode =
          useProjectStore.getState().commits[commit.hash]?.variants[variantIndex]
            ?.code || "";
        const selfCheckStartedAt = Date.now();
        const selfCheck = runPreviewSelfCheck(currentCode);
        const previewSelfCheckMs = Math.max(0, Date.now() - selfCheckStartedAt);
        const requestStartedAt =
          useProjectStore.getState().commits[commit.hash]?.variants[variantIndex]
            ?.requestStartedAt ?? Date.now();
        const commitSnapshot = useProjectStore.getState().commits[commit.hash];
        const variantSnapshot = commitSnapshot?.variants[variantIndex];
        const backendMetrics = variantBackendMetrics.get(variantIndex) || {};
        const parentCode =
          commit.parentHash &&
          useProjectStore.getState().commits[commit.parentHash]?.variants[
            useProjectStore.getState().commits[commit.parentHash]
              .selectedVariantIndex ?? 0
          ]?.code;
        const computedTargeting =
          commit.type === "ai_edit"
            ? evaluateTargetedEdit({
                previousCode: parentCode || "",
                nextCode: currentCode,
                selectedElementHtml: commit.inputs.selectedElementHtml,
                designUpdateIntent: commit.inputs.designUpdateIntent,
                userInstruction: commit.inputs.text,
              })
            : undefined;
        const targeting = computedTargeting ?? backendMetrics.targeting;
        const computedImageUpdateStatus = summarizeImageUpdateStatus(
          variantSnapshot?.agentEvents ?? []
        );
        const imageUpdateStatus =
          computedImageUpdateStatus ?? backendMetrics.imageUpdateStatus;
        const reviewSummary = summarizeReviewState({
          turnIntent,
          selfCheck,
          targeting,
          imageUpdateStatus,
        });
        patchVariant(commit.hash, variantIndex, {
          diagnostics: {
            selfCheckStatus: selfCheck.status,
            selfCheckSummary: selfCheck.summary,
            selfCheckIssues: selfCheck.issues,
            failureStage: backendMetrics.failureStage,
            targeting,
            imageUpdateStatus,
          },
          metrics: {
            runId,
            durationMs: Math.max(0, Date.now() - requestStartedAt),
            stageTimings: {
              ...backendMetrics.stageTimings,
              previewSelfCheckMs,
            },
          },
        });
        updateVariantStatus(
          commit.hash,
          variantIndex,
          selfCheck.status === "fail" ? "error" : "complete",
          selfCheck.status === "fail" ? selfCheck.summary : undefined
        );
        if (currentCode.trim().length > 0) {
          appendVariantHistoryMessage(
            commit.hash,
            variantIndex,
            buildAssistantHistoryMessage(currentCode)
          );
        }
        setDesignSession((prev) => ({
          ...prev,
          lastIntent: turnIntent,
          intentConfidence: intentDecision.confidence,
          intentReason: intentDecision.reason,
          intentSignals: intentDecision.signals,
          intentNeedsClarification: intentDecision.shouldAskQuestion,
          pendingQuestion:
            intentDecision.shouldAskQuestion
              ? (requestParams.prompt.fullText ||
                  requestParams.prompt.text ||
                  "").trim()
              : "",
          reviewSummary,
          lastUpdatedAt: new Date().toISOString(),
        }));
        finishThinkingEvent(variantIndex, "complete");
        finishAssistantEvent(variantIndex, "complete");
        finishToolEvent(variantIndex, "complete");
        if (commit.type === "ai_edit") {
          const {
            updateInstruction: currentInstruction,
            updateImages: currentImages,
          } = useAppStore.getState();
          const instructionUnchanged =
            currentInstruction === commit.inputs.text;
          const imagesUnchanged =
            currentImages.length === commit.inputs.images.length &&
            currentImages.every(
              (image, index) => image === commit.inputs.images[index]
            );

          // This conditional clear handles three UX scenarios:
          // 1) All variants fail: no completion event, so keep prompt/images for retry.
          // 2) A variant completes and user has typed/changed images: do not clear.
          // 3) A variant completes and user has not changed draft: clear for next edit.
          if (instructionUnchanged && imagesUnchanged) {
            setUpdateInstruction("");
            setUpdateImages([]);
          }
        }
      },
      onVariantError: (variantIndex, error) => {
        console.error(`Error in variant ${variantIndex}:`, error);
        const backendMetrics = variantBackendMetrics.get(variantIndex) || {};
        patchVariant(commit.hash, variantIndex, {
          diagnostics: {
            stage: classifyGenerationFailure(error),
            message: error,
            failureStage:
              backendMetrics.failureStage || classifyGenerationFailure(error),
          },
          metrics: {
            runId,
            stageTimings: backendMetrics.stageTimings,
          },
        });
        updateVariantStatus(commit.hash, variantIndex, "error", error);
        finishThinkingEvent(variantIndex, "error");
        finishAssistantEvent(variantIndex, "error");
        finishToolEvent(variantIndex, "error");
      },
      onVariantCount: (count) => {
        console.log(`Backend is using ${count} variants`);
        resizeVariants(commit.hash, count);
      },
      onVariantModels: (models) => {
        setVariantModels(commit.hash, models);
      },
      onVariantMetrics: (data, variantIndex) => {
        variantBackendMetrics.set(variantIndex, data || {});
      },
      onThinking: (content, variantIndex, eventId) => {
        if (!eventId) return;
        lastThinkingEventIdRef.current[variantIndex] = eventId;
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "thinking",
          status: "running",
          startedAt: Date.now(),
        });
        appendAgentEventContent(commit.hash, variantIndex, eventId, content);
      },
      onAssistant: (content, variantIndex, eventId) => {
        if (!eventId) return;
        lastAssistantEventIdRef.current[variantIndex] = eventId;
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "assistant",
          status: "running",
          startedAt: Date.now(),
        });
        appendAgentEventContent(commit.hash, variantIndex, eventId, content);
      },
      onToolStart: (data, variantIndex, eventId) => {
        if (!eventId) return;
        const lastThinking = lastThinkingEventIdRef.current[variantIndex];
        if (lastThinking && lastThinking !== eventId) {
          finishThinkingEvent(variantIndex, "complete");
        }
        const lastAssistant = lastAssistantEventIdRef.current[variantIndex];
        if (lastAssistant && lastAssistant !== eventId) {
          finishAssistantEvent(variantIndex, "complete");
        }
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "tool",
          status: "running",
          toolName: data?.name,
          input: data?.input,
          startedAt: Date.now(),
        });
        lastToolEventIdRef.current[variantIndex] = eventId;
      },
      onToolResult: (data, variantIndex, eventId) => {
        if (!eventId) return;
        finishAgentEvent(commit.hash, variantIndex, eventId, {
          status: data?.ok === false ? "error" : "complete",
          output: data?.output,
          endedAt: Date.now(),
        });
        if (lastToolEventIdRef.current[variantIndex] === eventId) {
          delete lastToolEventIdRef.current[variantIndex];
        }
      },
      onCancel: (reason, errorMessage) => {
        // The project may have been reset while this generation was still in
        // flight — a stale cancellation must not mutate app state.
        if (!useProjectStore.getState().commits[commit.hash]) return;

        // Close any running agent events when the socket ends without per-event
        // terminal messages, otherwise they remain stuck in "running" state.
        finishInFlightEvents(reason === "request_failed" ? "error" : "complete");

        if (reason === "request_failed" && commit.type === "ai_create") {
          const latestCreateCommit = useProjectStore.getState().commits[commit.hash];
          latestCreateCommit?.variants.forEach((variant, variantIndex) => {
            if (variant.status === "generating") {
              updateVariantStatus(
                commit.hash,
                variantIndex,
                "error",
                errorMessage || "Generation failed. Please retry."
              );
            }
          });
          setDraftHead(null);
          setHead(commit.hash);
          setAppState(AppState.CODE_READY);
          return;
        }

        cancelCodeGenerationAndReset(commit);
      },
    onComplete: () => {
        // Same guard as onCancel: a generation finishing after its project
        // was reset must not pull the app back into the editor.
        if (!useProjectStore.getState().commits[commit.hash]) return;
        finishInFlightEvents("complete");
        const completedCommit = useProjectStore.getState().commits[commit.hash];
        const selectedVariant =
          completedCommit?.variants[completedCommit.selectedVariantIndex];
        const selfCheckStatus = selectedVariant?.diagnostics?.selfCheckStatus;
        if (selfCheckStatus === "fail" && commit.type === "ai_edit") {
          toast.error(
            selectedVariant?.diagnostics?.selfCheckSummary ||
              "The new draft failed preview self-check, so the previous version was kept."
          );
          cancelCodeGenerationAndReset(commit);
          return;
        }
        setDraftHead(null);
        setHead(commit.hash);
        setDesignSession((prev) => ({
          ...prev,
          goal: prev.goal.trim() || requestParams.prompt.text.trim() || prev.goal,
          lastIntent: turnIntent,
          intentConfidence: intentDecision.confidence,
          intentReason: intentDecision.reason,
          intentSignals: intentDecision.signals,
          intentNeedsClarification: intentDecision.shouldAskQuestion,
          lastUpdatedAt: new Date().toISOString(),
        }));
        setAppState(AppState.CODE_READY);
      },
    });
  }

  // Initial version creation
  async function doCreate(
    referenceImages: string[],
    inputMode: "image" | "video",
    textPrompt: string = ""
  ) {
    // Reset any existing state
    reset();

    // Set the input states
    setReferenceImages(referenceImages);
    setInputMode(inputMode);

    const intentDecision = await resolveIntentDecision({
      text: textPrompt,
      generationType: "create",
      currentCode: "",
    });
    const turnIntent = intentDecision.intent;

    const seededDesignSession = appendRevisionEntry(
      buildSeededDesignSession(textPrompt, {
      ...createEmptyDesignSession(),
      goal: textPrompt.trim() || "Create a polished UI from the provided references.",
      }, {
        lastIntent: turnIntent,
        intentConfidence: intentDecision.confidence,
        intentReason: intentDecision.reason,
        intentSignals: intentDecision.signals,
        intentNeedsClarification: intentDecision.shouldAskQuestion,
        pendingQuestion: turnIntent === "question" ? textPrompt.trim() : "",
      }),
      summarizeDesignRevision("create", textPrompt)
    );
    setDesignSession(seededDesignSession);
    const revisionId = nanoid();

    // Kick off the code generation
    if (referenceImages.length > 0) {
      const media =
        inputMode === "video" ? [referenceImages[0]] : referenceImages;
      const imageAssetIds =
        inputMode === "image"
          ? registerAssetIds(
              "image",
              media,
              getAssetsById,
              upsertPromptAssets,
              nanoid
            )
          : [];
      const videoAssetIds =
        inputMode === "video"
          ? registerAssetIds(
              "video",
              media,
              getAssetsById,
              upsertPromptAssets,
              nanoid
            )
          : [];
      const variantHistory = [
        buildUserHistoryMessage(textPrompt, imageAssetIds, videoAssetIds),
      ];
      doGenerateCode({
        generationType: "create",
        inputMode,
        prompt: {
          text: textPrompt,
          images: inputMode === "image" ? media : [],
          videos: inputMode === "video" ? media : [],
          workspaceId,
          revisionId,
          parentCommitHash: null,
          previewSelfCheckEnabled: true,
          designSessionSnapshot: seededDesignSession,
          turnIntent,
          intentDecision,
        },
        revisionId,
        parentCommitHash: null,
        previewSelfCheckEnabled: true,
        designSession: seededDesignSession,
        turnIntent,
        intentDecision,
        variantHistory,
      });
    }
  }

  async function doCreateFromText(text: string) {
    // Reset any existing state
    reset();

    setInputMode("text");
    setInitialPrompt(text);
    const intentDecision = await resolveIntentDecision({
      text,
      generationType: "create",
      currentCode: "",
    });
    const turnIntent = intentDecision.intent;
    const seededDesignSession = appendRevisionEntry(
      buildSeededDesignSession(text, {
      ...createEmptyDesignSession(),
      goal: text.trim() || "Create a polished UI from the provided brief.",
      }, {
        lastIntent: turnIntent,
        intentConfidence: intentDecision.confidence,
        intentReason: intentDecision.reason,
        intentSignals: intentDecision.signals,
        intentNeedsClarification: intentDecision.shouldAskQuestion,
        pendingQuestion: turnIntent === "question" ? text.trim() : "",
      }),
      summarizeDesignRevision("create", text)
    );
    setDesignSession(seededDesignSession);
    const revisionId = nanoid();
    doGenerateCode({
      generationType: "create",
      inputMode: "text",
      prompt: {
        text,
        images: [],
        videos: [],
        workspaceId,
        revisionId,
        parentCommitHash: null,
        previewSelfCheckEnabled: true,
        designSessionSnapshot: seededDesignSession,
        turnIntent,
        intentDecision,
      },
      revisionId,
      parentCommitHash: null,
      previewSelfCheckEnabled: true,
      designSession: seededDesignSession,
      turnIntent,
      intentDecision,
      variantHistory: [buildUserHistoryMessage(text)],
    });
  }

  // Subsequent updates
  async function doUpdate(updateInstruction: string) {
    if (updateInstruction.trim() === "") {
      toast.error("Please include some instructions for AI on what to update.");
      return;
    }

    if (head === null) {
      toast.error(
        "No current version set. Contact support or open a Github issue."
      );
      throw new Error("Update called with no head");
    }

    const currentCommit = commits[head];
    const currentCode =
      currentCommit?.variants[currentCommit.selectedVariantIndex]?.code || "";
    const optionCodes = currentCommit?.variants.map(
      (variant) => variant.code || ""
    );

    let modifiedUpdateInstruction = updateInstruction;
    let selectedElementHtml: string | undefined;
    let selectedElementContext: string | undefined;

    // Send in a reference to the selected element if it exists. Selection
    // visuals are overlays, so the element's outerHTML is already clean.
    if (selectedElement) {
      const elementHtml = selectedElement.outerHTML;
      selectedElementHtml = elementHtml;
      selectedElementContext = selectedElement.isConnected
        ? describeElementContext(selectedElement)
        : undefined;
      modifiedUpdateInstruction = buildSelectedElementInstruction(
        updateInstruction,
        elementHtml,
        selectedElementContext
      );
      setSelectedElement(null);
    }

    const selectedVariant = currentCommit.variants[currentCommit.selectedVariantIndex];
    const baseVariantHistory = selectedVariant.history;
    const updateImageAssetIds = registerAssetIds(
      "image",
      updateImages,
      getAssetsById,
      upsertPromptAssets,
      nanoid
    );
    const updatedVariantHistory = [
      ...cloneVariantHistory(baseVariantHistory),
      buildUserHistoryMessage(modifiedUpdateInstruction, updateImageAssetIds),
    ];
    const shouldBootstrapFromFileState =
      baseVariantHistory.length === 0 && currentCode.trim().length > 0;
    const updatedHistory = shouldBootstrapFromFileState
      ? []
      : toRequestHistory(updatedVariantHistory, getAssetsById);
    const intentDecision = await resolveIntentDecision({
      text: modifiedUpdateInstruction,
      generationType: "update",
      selectedElementHtml,
      currentCode,
      selectedElementContext,
      designSession,
      fullText: modifiedUpdateInstruction,
    });
    const turnIntent = intentDecision.intent;
    const seededUpdateSession = appendRevisionEntry(
      {
        ...designSession,
        goal:
          designSession.goal.trim() ||
          initialPrompt.trim() ||
          modifiedUpdateInstruction.trim() ||
          designSession.goal,
        lastIntent: turnIntent,
        intentConfidence: intentDecision.confidence,
        intentReason: intentDecision.reason,
        intentSignals: intentDecision.signals,
        intentNeedsClarification: intentDecision.shouldAskQuestion,
        pendingQuestion:
          intentDecision.shouldAskQuestion
            ? modifiedUpdateInstruction.trim()
            : "",
      },
      summarizeDesignRevision("update", modifiedUpdateInstruction)
    );
    setDesignSession(seededUpdateSession);
    const revisionId = nanoid();
    const designUpdateIntent = parseDesignUpdateIntent(
      modifiedUpdateInstruction,
      selectedElement?.tagName?.toLowerCase() ?? null
    );

    doGenerateCode({
      generationType: "update",
      inputMode,
      prompt: {
        text: updateInstruction,
        fullText: modifiedUpdateInstruction,
        images: updateImages,
        videos: [],
        selectedElementHtml,
        selectedElementContext,
        designUpdateIntent,
        workspaceId,
        revisionId,
        parentCommitHash: head,
        previewSelfCheckEnabled: true,
        designSessionSnapshot: seededUpdateSession,
        turnIntent,
        intentDecision,
      },
      revisionId,
      parentCommitHash: head,
      previewSelfCheckEnabled: true,
      designSession: seededUpdateSession,
      turnIntent,
      intentDecision,
      history: updatedHistory,
      optionCodes,
      variantHistory: updatedVariantHistory,
      fileState: currentCode
        ? {
            path: "index.html",
            content: currentCode,
          }
        : undefined,
    });
  }

  const handleTermDialogOpenChange = (open: boolean) => {
    setSettings((s) => ({
      ...s,
      isTermOfServiceAccepted: !open,
    }));
  };

  function setStack(stack: Stack) {
    setSettings((prev) => ({
      ...prev,
      generatedCodeConfig: stack,
    }));
  }

  function importFromCode(code: string, stack: Stack) {
    // Reset any existing state
    reset();

    // Set up this project
    setStack(stack);

    // Create a new commit and set it as the head
    const commit = createCommit({
      type: "code_create",
      parentHash: null,
      variants: [{ code, history: [] }],
      inputs: null,
    });
    addCommit(commit);
    setHead(commit.hash);

    // Set the app state
    setAppState(AppState.CODE_READY);
  }

  const showContentPanel =
    appState === AppState.CODING ||
    appState === AppState.CODE_READY ||
    isHistoryOpen;
  const isCodingOrReady =
    appState === AppState.CODING || appState === AppState.CODE_READY;
  const showMobileChatPane = showContentPanel && mobilePane === "chat";

  return (
    <div
      className={`dark:bg-black dark:text-white ${
        appState === AppState.CODING || appState === AppState.CODE_READY
          ? "flex h-dvh flex-col overflow-hidden lg:block lg:h-screen"
          : "min-h-screen"
      }`}
    >
      {IS_RUNNING_ON_CLOUD && (
        <TermsOfServiceDialog
          open={!settings.isTermOfServiceAccepted}
          onOpenChange={handleTermDialogOpenChange}
        />
      )}

      {/* Icon strip - always visible */}
      <div
        className="sticky top-0 z-50 lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-16 lg:flex-col"
      >
        <IconStrip
          isHistoryOpen={isHistoryOpen}
          isEditorOpen={!isHistoryOpen && !isSettingsOpen}
          isSettingsOpen={isSettingsOpen}
          showHistory={isCodingOrReady}
          showEditor={isCodingOrReady}
          onToggleHistory={() => {
            setIsHistoryOpen((prev) => !prev);
            setIsSettingsOpen(false);
            setMobilePane("chat");
          }}
          onToggleEditor={() => {
            setIsHistoryOpen(false);
            setIsSettingsOpen(false);
            setMobilePane("preview");
          }}
          onLogoClick={() => {
            setIsHistoryOpen(false);
            setIsSettingsOpen(false);
            setMobilePane("preview");
          }}
          onNewProject={() => {
            void handleNewProject();
          }}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
            setIsHistoryOpen(false);
          }}
        />
      </div>

      {isCodingOrReady && !isSettingsOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950 lg:hidden">
          <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1 dark:bg-zinc-800">
            <button
              onClick={() => {
                setIsHistoryOpen(false);
                setMobilePane("preview");
              }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mobilePane === "preview"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-gray-500 dark:text-zinc-400"
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setMobilePane("chat")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mobilePane === "chat"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-gray-500 dark:text-zinc-400"
              }`}
            >
              Chat
            </button>
          </div>
        </div>
      )}

      {/* Content panel - shows sidebar, history, or editor */}
      {showContentPanel && !isSettingsOpen && (
        <div
          className={`border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark:text-white lg:fixed lg:inset-y-0 lg:left-16 lg:z-40 lg:flex lg:w-[calc(28rem-4rem)] lg:flex-col lg:border-b-0 lg:border-r ${
            showMobileChatPane ? "block" : "hidden lg:flex"
          }`}
        >
            {isHistoryOpen ? (
              <div className="flex-1 overflow-y-auto sidebar-scrollbar-stable px-4">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Versions</h2>
                    <button
                      onClick={() => setIsHistoryOpen(false)}
                      className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      <LuChevronLeft className="w-3.5 h-3.5" />
                      Back to editor
                    </button>
                  </div>
                  <HistoryDisplay />
                </div>
              </div>
            ) : (
              <>
                {IS_RUNNING_ON_CLOUD && !settings.openAiApiKey && (
                  <div className="px-6 mt-4">
                    <OnboardingNote />
                  </div>
                )}

                {(appState === AppState.CODING ||
                  appState === AppState.CODE_READY) && (
                  <Sidebar
                    doUpdate={doUpdate}
                    regenerate={regenerate}
                    cancelCodeGeneration={cancelCodeGeneration}
                    designSession={designSession}
                    setDesignSession={setDesignSession}
                    workspaceId={workspaceId}
                    recentWorkspaces={recentWorkspaces}
                    onOpenWorkspace={handleOpenWorkspace}
                    designSystem={{
                      designSystems,
                      selectedDesignSystemId: settings.selectedDesignSystemId,
                      setSelectedDesignSystemId,
                      onAddNew: handleAddNewDesignSystem,
                      onManage: () => openDesignSystemsManager(),
                    }}
                    onOpenVersions={() => {
                      setIsHistoryOpen(true);
                      setMobilePane("chat");
                    }}
                  />
                )}
              </>
            )}
        </div>
      )}

      <main
        className={`${
          isSettingsOpen
            ? "flex flex-1 min-h-0 flex-col lg:h-full lg:pl-16"
            : showContentPanel
              ? "flex flex-1 min-h-0 flex-col lg:h-full lg:pl-[28rem]"
              : "lg:pl-16"
        } ${isCodingOrReady && !isSettingsOpen && mobilePane === "chat" ? "hidden lg:flex" : ""}`}
      >
        {isSettingsOpen ? (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            appTheme={appTheme}
            setAppTheme={setAppTheme}
          />
        ) : (
          <>
            {appState === AppState.INITIAL && (
                <StartPane
                  doCreate={doCreate}
                  doCreateFromText={doCreateFromText}
                  importFromCode={importFromCode}
                  settings={settings}
                  setSettings={setSettings}
                  designSession={designSession}
                  setDesignSession={setDesignSession}
                  designSystems={designSystems}
                  onAddNewDesignSystem={handleAddNewDesignSystem}
                  onManageDesignSystems={() => openDesignSystemsManager()}
                  workspaceId={workspaceId}
                  recentWorkspaces={recentWorkspaces}
                  onOpenWorkspace={handleOpenWorkspace}
                />
            )}

            {isCodingOrReady && (
              <PreviewPane
                settings={settings}
                onOpenVersions={() => {
                  setIsHistoryOpen(true);
                  setMobilePane("chat");
                }}
              />
            )}
          </>
        )}
      </main>

      <DesignSystemsModal
        open={isDesignSystemsModalOpen}
        onOpenChange={setIsDesignSystemsModalOpen}
        designSystems={designSystems}
        selectedDesignSystemId={settings.selectedDesignSystemId}
        setSelectedDesignSystemId={setSelectedDesignSystemId}
        initialEditingId={designSystemsModalInitialId}
        createDesignSystem={createDesignSystem}
        updateDesignSystem={updateDesignSystem}
        deleteDesignSystem={deleteDesignSystem}
      />
    </div>
  );
}

export default App;
