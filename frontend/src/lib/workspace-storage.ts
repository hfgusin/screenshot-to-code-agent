import { AppState, DesignSession, PromptAsset, Settings } from "../types";
import {
  Commit,
} from "../components/commits/types";
import { Stack } from "./stacks";
import { CodeGenerationModel } from "./models";

const WORKSPACE_DB_NAME = "screenshot-to-code-workspaces";
const WORKSPACE_DB_VERSION = 1;
const WORKSPACE_STORE_NAME = "snapshots";
const WORKSPACE_INDEX_KEY = "workspace-recent-v1";
const ACTIVE_WORKSPACE_ID_KEY = "workspace-active-id-v1";
export const MAX_WORKSPACES = 5;

export interface WorkspaceSummary {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
}

export interface WorkspaceSettingsSnapshot {
  editorTheme: Settings["editorTheme"];
  generatedCodeConfig: Stack;
  codeGenerationModel: CodeGenerationModel;
  selectedDesignSystemId: string | null;
  isImageGenerationEnabled: boolean;
}

export interface WorkspaceAppSnapshot {
  appState: AppState;
  updateInstruction: string;
  updateImages: string[];
  inSelectAndEditMode: boolean;
  selectedElementHtml: string | null;
}

export interface WorkspaceProjectSnapshot {
  commits: Commit[];
  head: string | null;
  draftHead: string | null;
  latestCommitHash: string | null;
  assetsById: Record<string, PromptAsset>;
  executionConsoles: Record<string, string[]>;
}

export interface WorkspaceData {
  inputMode: "image" | "video" | "text";
  referenceImages: string[];
  initialPrompt: string;
  designSession: DesignSession;
  settings: WorkspaceSettingsSnapshot;
  app: WorkspaceAppSnapshot;
  project: WorkspaceProjectSnapshot;
}

export interface WorkspaceSnapshot extends WorkspaceSummary {
  version: 1;
  data: WorkspaceData;
}

type WorkspaceStorageResult = {
  snapshot: WorkspaceSnapshot | null;
  recentWorkspaces: WorkspaceSummary[];
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readWorkspaceSummaries(): WorkspaceSummary[] {
  if (!isBrowser()) return [];
  const parsed = safeJsonParse<WorkspaceSummary[]>(
    window.localStorage.getItem(WORKSPACE_INDEX_KEY)
  );
  return Array.isArray(parsed) ? parsed.slice(0, MAX_WORKSPACES) : [];
}

function writeWorkspaceSummaries(summaries: WorkspaceSummary[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(
    WORKSPACE_INDEX_KEY,
    JSON.stringify(summaries.slice(0, MAX_WORKSPACES))
  );
}

function readActiveWorkspaceId(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(ACTIVE_WORKSPACE_ID_KEY);
}

function writeActiveWorkspaceId(id: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(ACTIVE_WORKSPACE_ID_KEY, id);
}

function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("Workspace storage is only available in the browser"));
      return;
    }

    const request = window.indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open workspace database"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        db.createObjectStore(WORKSPACE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getWorkspaceSnapshot(id: string): Promise<WorkspaceSnapshot | null> {
  if (!isBrowser()) return null;
  const db = await openWorkspaceDatabase();
  try {
    return await new Promise<WorkspaceSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE_NAME, "readonly");
      const store = tx.objectStore(WORKSPACE_STORE_NAME);
      const request = store.get(id);
      request.onerror = () => reject(request.error ?? new Error("Failed to read workspace snapshot"));
      request.onsuccess = () => {
        resolve((request.result as WorkspaceSnapshot | undefined) ?? null);
      };
    });
  } finally {
    db.close();
  }
}

async function putWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openWorkspaceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE_NAME, "readwrite");
      const store = tx.objectStore(WORKSPACE_STORE_NAME);
      const request = store.put(snapshot);
      request.onerror = () => reject(request.error ?? new Error("Failed to save workspace snapshot"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Workspace save transaction failed"));
    });
  } finally {
    db.close();
  }
}

async function deleteWorkspaceSnapshot(id: string): Promise<void> {
  const db = await openWorkspaceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORKSPACE_STORE_NAME, "readwrite");
      const store = tx.objectStore(WORKSPACE_STORE_NAME);
      const request = store.delete(id);
      request.onerror = () => reject(request.error ?? new Error("Failed to delete workspace snapshot"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Workspace delete transaction failed"));
    });
  } finally {
    db.close();
  }
}

function normalizeWorkspaceTitle(data: WorkspaceData): string {
  const goal = data.designSession.goal.trim();
  if (goal) return goal;
  const prompt = data.initialPrompt.trim();
  if (prompt) return prompt;
  const latestCommit = data.project.latestCommitHash
    ? data.project.commits.find((commit) => commit.hash === data.project.latestCommitHash)
    : null;
  if (latestCommit?.type === "code_create") {
    return "Imported code";
  }
  const latestText = latestCommit ? latestCommit.inputs.text?.trim() : "";
  return latestText || "Untitled workspace";
}

function normalizeWorkspaceSummary(data: WorkspaceData): string {
  const revision = data.designSession.revisionLog.at(-1)?.trim();
  if (revision) return revision;
  const prompt = data.initialPrompt.trim();
  if (prompt) return prompt;
  const latestCommit = data.project.latestCommitHash
    ? data.project.commits.find((commit) => commit.hash === data.project.latestCommitHash)
    : null;
  if (!latestCommit) return "Fresh workspace";
  if (latestCommit.type === "code_create") {
    return "Imported existing code";
  }
  const latestText = latestCommit.inputs.text.trim();
  return latestText || "Editing workspace";
}

function makeSummary(
  snapshot: WorkspaceSnapshot,
  overrideLastActiveAt = snapshot.lastActiveAt
): WorkspaceSummary {
  return {
    id: snapshot.id,
    title: normalizeWorkspaceTitle(snapshot.data),
    summary: normalizeWorkspaceSummary(snapshot.data),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lastActiveAt: overrideLastActiveAt,
  };
}

function upsertRecentSummaries(
  summaries: WorkspaceSummary[],
  summary: WorkspaceSummary
): WorkspaceSummary[] {
  const next = [summary, ...summaries.filter((item) => item.id !== summary.id)];
  next.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  return next.slice(0, MAX_WORKSPACES);
}

export function readRecentWorkspaces(): WorkspaceSummary[] {
  return readWorkspaceSummaries();
}

export async function loadWorkspaceSnapshotById(
  id: string
): Promise<WorkspaceSnapshot | null> {
  const snapshot = await getWorkspaceSnapshot(id);
  return snapshot;
}

export async function loadLatestWorkspaceSnapshot(): Promise<WorkspaceStorageResult> {
  const recentWorkspaces = readWorkspaceSummaries();
  const activeId = readActiveWorkspaceId() || recentWorkspaces[0]?.id || null;
  if (!activeId) {
    return { snapshot: null, recentWorkspaces };
  }
  const snapshot = await getWorkspaceSnapshot(activeId);
  return { snapshot, recentWorkspaces };
}

export async function saveWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot
): Promise<WorkspaceStorageResult> {
  const now = new Date().toISOString();
  const normalizedSnapshot: WorkspaceSnapshot = {
    ...snapshot,
    title: normalizeWorkspaceTitle(snapshot.data),
    summary: normalizeWorkspaceSummary(snapshot.data),
    lastActiveAt: now,
    updatedAt: now,
    data: {
      ...snapshot.data,
      project: {
        ...snapshot.data.project,
        commits: snapshot.data.project.commits.map((commit) => ({
          ...commit,
          dateCreated:
            commit.dateCreated instanceof Date
              ? new Date(commit.dateCreated.getTime())
              : new Date(commit.dateCreated),
          variants: commit.variants.map((variant) => ({
            ...variant,
            history: variant.history.map((message) => ({
              ...message,
              imageAssetIds: [...message.imageAssetIds],
              videoAssetIds: [...message.videoAssetIds],
            })),
            agentEvents: variant.agentEvents
              ? variant.agentEvents.map((event) => ({ ...event }))
              : undefined,
          })),
        })),
        executionConsoles: Object.fromEntries(
          Object.entries(snapshot.data.project.executionConsoles).map(
            ([key, value]) => [key, [...value]]
          )
        ),
      },
      referenceImages: [...snapshot.data.referenceImages],
      initialPrompt: snapshot.data.initialPrompt,
      designSession: {
        ...snapshot.data.designSession,
        revisionLog: [...snapshot.data.designSession.revisionLog],
      },
      app: {
        ...snapshot.data.app,
        updateImages: [...snapshot.data.app.updateImages],
      },
    },
  };

  await putWorkspaceSnapshot(normalizedSnapshot);
  writeActiveWorkspaceId(normalizedSnapshot.id);

  const previousSummaries = readWorkspaceSummaries();
  const summaries = upsertRecentSummaries(
    previousSummaries,
    makeSummary(normalizedSnapshot)
  );
  writeWorkspaceSummaries(summaries);

  const removeIds = previousSummaries
    .map((item) => item.id)
    .filter((id) => !summaries.some((item) => item.id === id));
  await Promise.all(removeIds.map((id) => deleteWorkspaceSnapshot(id)));

  return { snapshot: normalizedSnapshot, recentWorkspaces: summaries };
}

export async function deleteWorkspaceById(id: string): Promise<void> {
  const summaries = readWorkspaceSummaries().filter((item) => item.id !== id);
  writeWorkspaceSummaries(summaries);
  if (readActiveWorkspaceId() === id) {
    if (summaries[0]?.id) {
      writeActiveWorkspaceId(summaries[0].id);
    } else if (isBrowser()) {
      window.localStorage.removeItem(ACTIVE_WORKSPACE_ID_KEY);
    }
  }
  await deleteWorkspaceSnapshot(id);
}

export function deserializeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot
): WorkspaceSnapshot {
  return {
    ...snapshot,
    data: {
      ...snapshot.data,
      project: {
        ...snapshot.data.project,
        commits: snapshot.data.project.commits.map((commit) => ({
          ...commit,
          dateCreated:
            commit.dateCreated instanceof Date
              ? new Date(commit.dateCreated.getTime())
              : new Date(commit.dateCreated),
          variants: commit.variants.map((variant) => ({
            ...variant,
            history: variant.history.map((message) => ({
              ...message,
              imageAssetIds: [...message.imageAssetIds],
              videoAssetIds: [...message.videoAssetIds],
            })),
            agentEvents: variant.agentEvents
              ? variant.agentEvents.map((event) => ({ ...event }))
              : undefined,
          })),
        })),
        executionConsoles: Object.fromEntries(
          Object.entries(snapshot.data.project.executionConsoles).map(
            ([key, value]) => [key, [...value]]
          )
        ),
      },
      referenceImages: [...snapshot.data.referenceImages],
      initialPrompt: snapshot.data.initialPrompt,
      designSession: {
        ...snapshot.data.designSession,
        revisionLog: [...snapshot.data.designSession.revisionLog],
      },
      app: {
        ...snapshot.data.app,
        updateImages: [...snapshot.data.app.updateImages],
      },
    },
  };
}

export function createEmptyRecentWorkspaces(): WorkspaceSummary[] {
  return [];
}
