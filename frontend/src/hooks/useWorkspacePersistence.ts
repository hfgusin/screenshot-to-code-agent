import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useAppStore } from "../store/app-store";
import { useProjectStore } from "../store/project-store";
import {
  AppState,
  DesignSession,
  PromptAsset,
  Settings,
} from "../types";
import {
  WorkspaceData,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceSettingsSnapshot,
  deserializeWorkspaceSnapshot,
  loadLatestWorkspaceSnapshot,
  loadWorkspaceSnapshotById,
  readRecentWorkspaces,
  saveWorkspaceSnapshot,
} from "../lib/workspace-storage";
import {
  Commit,
  VariantHistoryMessage,
} from "../components/commits/types";

interface UseWorkspacePersistenceParams {
  workspaceId: string;
  setWorkspaceId: Dispatch<SetStateAction<string>>;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  designSession: DesignSession;
  setDesignSession: Dispatch<SetStateAction<DesignSession>>;
}

interface UseWorkspacePersistenceResult {
  recentWorkspaces: WorkspaceSummary[];
  isHydrated: boolean;
  openWorkspace: (id: string) => Promise<boolean>;
  flushWorkspaceNow: () => Promise<void>;
  beginWorkspaceTransition: (targetWorkspaceId: string) => void;
  endWorkspaceTransition: () => void;
}

function cloneHistory(history: VariantHistoryMessage[]): VariantHistoryMessage[] {
  return history.map((message) => ({
    ...message,
    imageAssetIds: [...message.imageAssetIds],
    videoAssetIds: [...message.videoAssetIds],
  }));
}

function cloneCommit(commit: Commit): Commit {
  return {
    ...commit,
    dateCreated:
      commit.dateCreated instanceof Date
        ? new Date(commit.dateCreated.getTime())
        : new Date(commit.dateCreated),
    variants: commit.variants.map((variant) => ({
      ...variant,
      history: cloneHistory(variant.history || []),
      agentEvents: variant.agentEvents
        ? variant.agentEvents.map((event) => ({ ...event }))
        : undefined,
    })),
  };
}

function buildSettingsSnapshot(settings: Settings): WorkspaceSettingsSnapshot {
  return {
    editorTheme: settings.editorTheme,
    generatedCodeConfig: settings.generatedCodeConfig,
    codeGenerationModel: settings.codeGenerationModel,
    selectedDesignSystemId: settings.selectedDesignSystemId,
    isImageGenerationEnabled: settings.isImageGenerationEnabled,
    openAiImageApiKey: settings.openAiImageApiKey ?? null,
    openAiImageBaseURL: settings.openAiImageBaseURL ?? null,
  };
}

function buildWorkspaceData(
  settings: Settings,
  designSession: DesignSession
): WorkspaceData | null {
  const project = useProjectStore.getState();
  const app = useAppStore.getState();
  const hasCommittedContent =
    Object.keys(project.commits).length > 0 ||
    project.head !== null ||
    project.draftHead !== null ||
    project.latestCommitHash !== null;
  const hasPromptContent =
    project.initialPrompt.trim().length > 0 ||
    project.referenceImages.length > 0 ||
    designSession.goal.trim().length > 0 ||
    designSession.constraints.trim().length > 0 ||
    designSession.style.trim().length > 0 ||
    designSession.references.trim().length > 0 ||
    designSession.revisionLog.length > 0 ||
    app.updateInstruction.trim().length > 0 ||
    app.updateImages.length > 0 ||
    Object.keys(project.assetsById).length > 0;

  if (!hasCommittedContent && !hasPromptContent) {
    return null;
  }

  const recentCommit = project.latestCommitHash
    ? project.commits[project.latestCommitHash]
    : null;
  const initialPrompt =
    project.initialPrompt.trim() ||
    recentCommit?.inputs?.text?.trim() ||
    designSession.goal.trim();

  return {
    inputMode: project.inputMode,
    referenceImages: [...project.referenceImages],
    initialPrompt,
    designSession: {
      ...designSession,
      revisionLog: [...designSession.revisionLog],
    },
    settings: buildSettingsSnapshot(settings),
    app: {
      appState: app.appState,
      updateInstruction: app.updateInstruction,
      updateImages: [...app.updateImages],
      inSelectAndEditMode: app.inSelectAndEditMode,
      selectedElementHtml: null,
    },
    project: {
      commits: Object.values(project.commits).map(cloneCommit),
      head: project.head,
      draftHead: project.draftHead,
      latestCommitHash: project.latestCommitHash,
      assetsById: Object.fromEntries(
        Object.entries(project.assetsById).map(([id, asset]) => [
          id,
          { ...asset, dataUrl: asset.dataUrl },
        ])
      ) as Record<string, PromptAsset>,
      executionConsoles: Object.fromEntries(
        Object.entries(project.executionConsoles).map(([key, value]) => [
          key,
          [...value],
        ])
      ),
    },
  };
}

function workspaceSignature(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    title: snapshot.title,
    summary: snapshot.summary,
    data: snapshot.data,
  });
}

function applyWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  setWorkspaceId: Dispatch<SetStateAction<string>>,
  setSettings: Dispatch<SetStateAction<Settings>>,
  setDesignSession: Dispatch<SetStateAction<DesignSession>>
): void {
  const restored = deserializeWorkspaceSnapshot(snapshot);
  const hasCommits = restored.data.project.commits.length > 0;
  const projectState = useProjectStore.getState();

  useProjectStore.setState({
    ...projectState,
    inputMode: restored.data.inputMode,
    referenceImages: [...restored.data.referenceImages],
    initialPrompt: restored.data.initialPrompt,
    assetsById: restored.data.project.assetsById,
    commits: Object.fromEntries(
      restored.data.project.commits.map((commit) => [commit.hash, commit])
    ),
    head: restored.data.project.head,
    draftHead: restored.data.project.draftHead,
    latestCommitHash: restored.data.project.latestCommitHash,
    executionConsoles: Object.fromEntries(
      Object.entries(restored.data.project.executionConsoles).map(
        ([key, value]) => [Number(key), [...value]]
      )
    ),
  });

  useAppStore.setState((current) => ({
    ...current,
    appState: hasCommits ? AppState.CODE_READY : restored.data.app.appState,
    updateInstruction: restored.data.app.updateInstruction,
    updateImages: [...restored.data.app.updateImages],
    inSelectAndEditMode: restored.data.app.inSelectAndEditMode,
    selectedElement: null,
  }));

  setSettings((current) => ({
    ...current,
    editorTheme: restored.data.settings.editorTheme,
    generatedCodeConfig: restored.data.settings.generatedCodeConfig,
    codeGenerationModel: restored.data.settings.codeGenerationModel,
    selectedDesignSystemId: restored.data.settings.selectedDesignSystemId,
    isImageGenerationEnabled: restored.data.settings.isImageGenerationEnabled,
    openAiImageApiKey: restored.data.settings.openAiImageApiKey ?? null,
    openAiImageBaseURL: restored.data.settings.openAiImageBaseURL ?? null,
  }));

  setDesignSession({
    ...restored.data.designSession,
    revisionLog: [...restored.data.designSession.revisionLog],
  });

  setWorkspaceId(restored.id);
}

export function useWorkspacePersistence({
  workspaceId,
  setWorkspaceId,
  settings,
  setSettings,
  designSession,
  setDesignSession,
}: UseWorkspacePersistenceParams): UseWorkspacePersistenceResult {
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceSummary[]>(
    () => readRecentWorkspaces()
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const workspaceTransitionRef = useRef<{
    active: boolean;
    targetWorkspaceId: string | null;
  }>({
    active: false,
    targetWorkspaceId: null,
  });

  const flushWorkspace = useCallback(async (force = false) => {
    if (!initializedRef.current) {
      return;
    }
    if (workspaceTransitionRef.current.active && !force) {
      return;
    }

    const data = buildWorkspaceData(settings, designSession);
    if (!data) {
      return;
    }

    const existing = recentWorkspaces.find((item) => item.id === workspaceId);
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      id: workspaceId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      lastActiveAt: existing?.lastActiveAt ?? new Date().toISOString(),
      title: existing?.title ?? "",
      summary: existing?.summary ?? "",
      data,
    };

    const signature = workspaceSignature(snapshot);
    if (signature === lastSavedSignatureRef.current) {
      return;
    }

    const result = await saveWorkspaceSnapshot(snapshot);
    lastSavedSignatureRef.current = workspaceSignature(result.snapshot!);
    setRecentWorkspaces(result.recentWorkspaces);
  }, [designSession, recentWorkspaces, settings, workspaceId]);

  const flushWorkspaceNow = useCallback(async () => {
    await flushWorkspace(true);
  }, [flushWorkspace]);

  const beginWorkspaceTransition = useCallback((targetWorkspaceId: string) => {
    workspaceTransitionRef.current = {
      active: true,
      targetWorkspaceId,
    };
  }, []);

  const endWorkspaceTransition = useCallback(() => {
    workspaceTransitionRef.current = {
      active: false,
      targetWorkspaceId: null,
    };
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!initializedRef.current) return;
    if (workspaceTransitionRef.current.active) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushWorkspace();
    }, 600);
  }, [flushWorkspace]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const { snapshot, recentWorkspaces: loadedRecent } =
          await loadLatestWorkspaceSnapshot();
        if (cancelled) return;

        setRecentWorkspaces(loadedRecent);
        if (snapshot) {
          applyWorkspaceSnapshot(snapshot, setWorkspaceId, setSettings, setDesignSession);
          lastSavedSignatureRef.current = workspaceSignature(snapshot);
        }
      } catch (error) {
        console.error("Failed to restore workspace snapshot", error);
      } finally {
        if (!cancelled) {
          initializedRef.current = true;
          setIsHydrated(true);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [setDesignSession, setSettings, setWorkspaceId]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const unsubscribeProject = useProjectStore.subscribe(() => {
      scheduleFlush();
    });
    const unsubscribeApp = useAppStore.subscribe(() => {
      scheduleFlush();
    });

    const flushNow = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushWorkspace(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushNow();
      }
    };

    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribeProject();
      unsubscribeApp();
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushWorkspace, isHydrated, scheduleFlush]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    scheduleFlush();
  }, [designSession, isHydrated, scheduleFlush, settings, workspaceId]);

  const openWorkspace = useCallback(
    async (id: string) => {
      await flushWorkspace(true);
      beginWorkspaceTransition(id);
      try {
        const snapshot = await loadWorkspaceSnapshotById(id);
        if (!snapshot) return false;
        applyWorkspaceSnapshot(
          snapshot,
          setWorkspaceId,
          setSettings,
          setDesignSession
        );
        const hydratedSnapshot = {
          ...snapshot,
          lastActiveAt: new Date().toISOString(),
        };
        const result = await saveWorkspaceSnapshot(hydratedSnapshot);
        setRecentWorkspaces(result.recentWorkspaces);
        lastSavedSignatureRef.current = workspaceSignature(result.snapshot!);
        return true;
      } finally {
        endWorkspaceTransition();
      }
    },
    [
      beginWorkspaceTransition,
      endWorkspaceTransition,
      flushWorkspace,
      setDesignSession,
      setSettings,
      setWorkspaceId,
    ]
  );

  const memoizedRecent = useMemo(() => recentWorkspaces, [recentWorkspaces]);

  return {
    recentWorkspaces: memoizedRecent,
    isHydrated,
    openWorkspace,
    flushWorkspaceNow,
    beginWorkspaceTransition,
    endWorkspaceTransition,
  };
}

export function createWorkspaceId(): string {
  return nanoid();
}
