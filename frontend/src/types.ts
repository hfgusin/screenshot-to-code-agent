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
  openAiImageApiKey: string | null;
  openAiImageBaseURL: string | null;
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
  latestDelta?: string;
  sessionSummary?: string;
  revisionLog: string[];
  lastIntent?: TurnIntent;
  intentConfidence?: number;
  intentReason?: string;
  intentSignals?: string[];
  intentNeedsClarification?: boolean;
  pendingQuestion?: string;
  reviewSummary?: string;
  memory?: AgentMemory;
  lastUpdatedAt: string | null;
}

export type AgentMemorySource =
  | "user_correction"
  | "user_instruction"
  | "repeated_pattern"
  | "model_inference"
  | "code_state"
  | "tool_result";

export type AgentMemoryStatus =
  | "active"
  | "tentative"
  | "superseded"
  | "rejected";

export type AgentLongMemoryType =
  | "business_rule"
  | "user_preference"
  | "design_constraint"
  | "product_semantics";

export interface AgentLongMemoryEntry {
  id: string;
  type: AgentLongMemoryType;
  text: string;
  confidence: number;
  source: AgentMemorySource;
  status: AgentMemoryStatus;
  appliesTo: string[];
  createdAt: string;
  lastConfirmedAt?: string;
}

export interface AgentShortMemoryEntry {
  id: string;
  text: string;
  source: AgentMemorySource;
  createdAt: string;
  expiresAfterTurns?: number;
}

export interface AgentArtifactMemory {
  summary: string;
  sections: string[];
  activeAssets: string[];
  lastUpdatedAt?: string;
}

export interface AgentFailureMemoryEntry {
  id: string;
  text: string;
  toolName?: string;
  source: AgentMemorySource;
  createdAt: string;
  status: "active" | "resolved";
}

export interface AgentCandidateMemoryEntry {
  id: string;
  text: string;
  reason: string;
  confidence: number;
  source: AgentMemorySource;
  createdAt: string;
}

export interface AgentMemoryConflict {
  id: string;
  longMemoryId: string;
  text: string;
  severity: "low" | "medium" | "high";
  createdAt: string;
}

export interface AgentMemory {
  shortTerm: AgentShortMemoryEntry[];
  longTerm: AgentLongMemoryEntry[];
  artifact: AgentArtifactMemory;
  failures: AgentFailureMemoryEntry[];
  candidates: AgentCandidateMemoryEntry[];
  conflicts: AgentMemoryConflict[];
}

export type TurnIntent = "generate" | "modify" | "repair" | "question";

export interface IntentDecision {
  intent: TurnIntent;
  confidence: number;
  reason: string;
  shouldAskQuestion: boolean;
  signals: string[];
  structuredUpdateIntent?: DesignUpdateIntent;
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

export interface AgentRenderingDiagnostics {
  primaryDocumentType: "html" | "none";
  hasRenderableDocument: boolean;
  discardedContentPreview?: string;
  discardedContentLength?: number;
}

export interface AgentPromptMetrics {
  promptChars?: number;
  promptMessages?: number;
  estimatedTokens?: number;
  promptBudgetChars?: number;
  promptOverBudgetChars?: number;
  fileSnapshotChars?: number;
  compressedFileSnapshotChars?: number;
  fileSnapshotOmittedChars?: number;
  designSessionChars?: number;
  memoryChars?: number;
  memoryPromptChars?: number;
  memoryBudgetChars?: number;
  memoryOmittedChars?: number;
  longMemoryCount?: number;
  shortMemoryCount?: number;
  memoryConflictCount?: number;
  historyMessageCount?: number;
  historyChars?: number;
  imageAssetCount?: number;
  selectedElementChars?: number;
}

export interface AgentChangeReport {
  addedNodes: number;
  removedNodes: number;
  changedNodes: number;
  totalNodesBefore: number;
  totalNodesAfter: number;
  impact: "low" | "medium" | "high";
  changedRegions: string[];
  summary: string;
}

export type PreviewSelfCheckStatus = "pass" | "warn" | "fail";

export interface PreviewSelfCheckResult {
  status: PreviewSelfCheckStatus;
  summary: string;
  issues: string[];
  isRenderable: boolean;
  localCheckOnly?: boolean;
  escalatedPreviewCheck?: boolean;
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
  editReview?: {
    beforeText: string;
    afterText?: string;
    source: "direct" | "ai";
  };
  revisionId?: string;
  parentCommitHash?: string | null;
  previewSelfCheckEnabled?: boolean;
  turnIntent?: TurnIntent;
  intentDecision?: IntentDecision;
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
  turnIntent?: TurnIntent;
  intentDecision?: IntentDecision;
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
