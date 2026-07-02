import { Stack } from "./lib/stacks";
import { CodeGenerationModel } from "./lib/models";

export enum EditorTheme {
  ESPRESSO = "espresso",
  COBALT = "cobalt",
}

export enum AppTheme {
  SYSTEM = "system",
  LIGHT = "light",
  DARK = "dark",
}

export interface Settings {
  openAiApiKey: string | null;
  openAiBaseURL: string | null;
  screenshotOneApiKey: string | null;
  isImageGenerationEnabled: boolean;
  editorTheme: EditorTheme;
  generatedCodeConfig: Stack;
  codeGenerationModel: CodeGenerationModel;
  selectedDesignSystemId: string | null;
  // Only relevant for hosted version
  isTermOfServiceAccepted: boolean;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
}

export interface DesignSystem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSession {
  goal: string;
  constraints: string;
  style: string;
  references: string;
  revisionLog: string[];
  lastUpdatedAt: string | null;
}

export interface DesignUpdateIntent {
  target: string;
  intent: string;
  placement: string;
  alignment: string;
  preserve: string[];
}

export interface AgentStageTimings {
  requestParseMs?: number;
  promptBuildMs?: number;
  modelGenerationMs?: number;
  toolRuntimeMs?: number;
  imageGenerationMs?: number;
  previewSelfCheckMs?: number;
  workspacePersistMs?: number;
}

export interface AgentTargetingDiagnostics {
  score: number;
  changedInsideTarget: boolean;
  preservedOutsideTarget: boolean;
  intentMatched: boolean;
  collateralDamage: boolean;
  targetSummary?: string;
  preserveViolations?: string[];
  changedSignals?: string[];
}

export interface AgentImageUpdateStatus {
  operation: "create" | "edit" | "fallback";
  status: "ok" | "error";
  sourceImageUrl?: string | null;
  persistedAssetUrl?: string | null;
  assetId?: string | null;
  parentAssetId?: string | null;
  message?: string;
}

export type PreviewSelfCheckStatus = "pass" | "warn" | "fail";

export interface PreviewSelfCheckResult {
  status: PreviewSelfCheckStatus;
  summary: string;
  issues: string[];
  isRenderable: boolean;
}

export enum AppState {
  INITIAL = "INITIAL",
  CODING = "CODING",
  CODE_READY = "CODE_READY",
}

export enum ScreenRecorderState {
  INITIAL = "initial",
  RECORDING = "recording",
  FINISHED = "finished",
}

export type PromptMessageRole = "user" | "assistant";
export type PromptAssetType = "image" | "video";

export interface PromptAsset {
  id: string;
  type: PromptAssetType;
  dataUrl: string;
}

export interface PromptContent {
  text: string; // What the user typed (displayed in the UI)
  // Full instruction for the model when it differs from `text`
  // (e.g. includes the selected-element reference)
  fullText?: string;
  workspaceId?: string;
  selectedElementHtml?: string; // Raw HTML of selected element (for display only)
  selectedElementContext?: string;
  revisionId?: string;
  parentCommitHash?: string | null;
  previewSelfCheckEnabled?: boolean;
  designUpdateIntent?: DesignUpdateIntent;
  designSessionSnapshot?: DesignSession;
  runId?: string;
  images: string[]; // Array of data URLs
  videos?: string[]; // Array of data URLs
}

export interface PromptHistoryMessage {
  role: PromptMessageRole;
  text: string;
  images: string[];
  videos: string[];
}

export interface CodeGenerationParams {
  generationType: "create" | "update";
  inputMode: "image" | "video" | "text";
  prompt: PromptContent;
  runId?: string;
  workspaceId?: string;
  revisionId?: string;
  parentCommitHash?: string | null;
  previewSelfCheckEnabled?: boolean;
  history?: PromptHistoryMessage[];
  designSession?: DesignSession;
  fileState?: {
    path: string;
    content: string;
  };
  optionCodes?: string[];
}

export type FullGenerationSettings = CodeGenerationParams &
  Settings & {
    designSystem?: string | null;
  };
