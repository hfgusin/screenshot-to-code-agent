import { Commit, Variant } from "../components/commits/types";

export interface AgentMaturitySummary {
  totalTurns: number;
  completedTurns: number;
  failedTurns: number;
  failureRate: number;
  targetedUpdates: number;
  targetedHits: number;
  targetHitRate: number;
  previewPassRate: number;
  imageUpdateSuccessRate: number;
  imageUpdates: number;
  successfulImageUpdates: number;
  averageCreateDurationMs: number | null;
  averageUpdateDurationMs: number | null;
  averageCreatePromptChars: number | null;
  averageUpdatePromptChars: number | null;
  rollbackPoints: number;
  fileSnapshotStrategyRate: number;
  historyStrategyRate: number;
  localCheckOnlyRate: number;
  escalatedPreviewRate: number;
}

// 统一拿到 commit 当前正在看的 variant，便于做 workspace 级统计。
function getActiveVariant(commit: Commit): Variant | null {
  const variant = commit.variants[commit.selectedVariantIndex];
  return variant ?? commit.variants[0] ?? null;
}

// 只保留 AI 生成/修改类 commit，跳过纯手工导入代码的记录。
function isAgentCommit(
  commit: Commit
): commit is Exclude<Commit, { type: "code_create" }> {
  return commit.type !== "code_create";
}

// 过滤掉没有有效 variant 的条目，缩小后续统计分支。
function hasVariant(
  entry: { commit: Exclude<Commit, { type: "code_create" }>; variant: Variant | null }
): entry is {
  commit: Exclude<Commit, { type: "code_create" }>;
  variant: Variant;
} {
  return entry.variant !== null;
}

// 计算平均值；没有样本时返回 null，避免 UI 误读成 0。
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// 基于最近 commit 历史汇总 maturity 指标，用于 QA 面板横向比较。
export function buildAgentMaturitySummary(
  commitsByHash: Record<string, Commit>
): AgentMaturitySummary {
  const commits = Object.values(commitsByHash).filter(isAgentCommit);
  const variants = commits
    .map((commit) => ({
      commit,
      variant: getActiveVariant(commit),
    }))
    .filter(hasVariant);

  const terminalVariants = variants.filter(
    ({ variant }) => variant.status === "complete" || variant.status === "error"
  );
  const failedTurns = terminalVariants.filter(
    ({ variant }) => variant.status === "error"
  ).length;
  const completedTurns = terminalVariants.filter(
    ({ variant }) => variant.status === "complete"
  ).length;

  const targetedUpdates = variants.filter(
    ({ commit }) =>
      commit.type === "ai_edit" && Boolean(commit.inputs.selectedElementHtml?.trim())
  );
  const targetedHits = targetedUpdates.filter(
    ({ variant }) =>
      variant.status === "complete" &&
      variant.diagnostics?.selfCheckStatus !== "fail"
  ).length;

  const previewPasses = terminalVariants.filter(
    ({ variant }) => variant.diagnostics?.selfCheckStatus === "pass"
  ).length;
  const imageUpdates = variants.filter(
    ({ variant }) => variant.diagnostics?.imageUpdateStatus
  );
  const successfulImageUpdates = imageUpdates.filter(
    ({ variant }) => variant.diagnostics?.imageUpdateStatus?.status === "ok"
  ).length;

  const createDurations = variants
    .filter(
      ({ commit, variant }) =>
        commit.type === "ai_create" &&
        variant.status === "complete" &&
        typeof variant.metrics?.durationMs === "number"
    )
    .map(({ variant }) => variant.metrics?.durationMs as number);

  const updateDurations = variants
    .filter(
      ({ commit, variant }) =>
        commit.type === "ai_edit" &&
        variant.status === "complete" &&
        typeof variant.metrics?.durationMs === "number"
    )
    .map(({ variant }) => variant.metrics?.durationMs as number);
  const createPromptChars = variants
    .filter(
      ({ commit, variant }) =>
        commit.type === "ai_create" &&
        typeof variant.metrics?.promptMetrics?.promptChars === "number"
    )
    .map(({ variant }) => variant.metrics?.promptMetrics?.promptChars as number);
  const updatePromptChars = variants
    .filter(
      ({ commit, variant }) =>
        commit.type === "ai_edit" &&
        typeof variant.metrics?.promptMetrics?.promptChars === "number"
    )
    .map(({ variant }) => variant.metrics?.promptMetrics?.promptChars as number);

  const promptStrategyTurns = terminalVariants.filter(
    ({ variant }) => variant.metrics?.promptStrategy || variant.diagnostics?.promptStrategy
  );
  const fileSnapshotTurns = promptStrategyTurns.filter(
    ({ variant }) =>
      (variant.metrics?.promptStrategy || variant.diagnostics?.promptStrategy) ===
      "file_snapshot"
  ).length;
  const historyTurns = promptStrategyTurns.filter(
    ({ variant }) =>
      (variant.metrics?.promptStrategy || variant.diagnostics?.promptStrategy) ===
      "history"
  ).length;
  const selfCheckTurns = terminalVariants.filter(
    ({ variant }) =>
      typeof variant.diagnostics?.localCheckOnly === "boolean" ||
      typeof variant.diagnostics?.escalatedPreviewCheck === "boolean"
  );
  const localCheckOnlyTurns = selfCheckTurns.filter(
    ({ variant }) => variant.diagnostics?.localCheckOnly
  ).length;
  const escalatedPreviewTurns = selfCheckTurns.filter(
    ({ variant }) => variant.diagnostics?.escalatedPreviewCheck
  ).length;

  return {
    totalTurns: commits.length,
    completedTurns,
    failedTurns,
    failureRate:
      terminalVariants.length > 0 ? failedTurns / terminalVariants.length : 0,
    targetedUpdates: targetedUpdates.length,
    targetedHits,
    targetHitRate:
      targetedUpdates.length > 0 ? targetedHits / targetedUpdates.length : 0,
    previewPassRate:
      terminalVariants.length > 0 ? previewPasses / terminalVariants.length : 0,
    imageUpdates: imageUpdates.length,
    successfulImageUpdates,
    imageUpdateSuccessRate:
      imageUpdates.length > 0 ? successfulImageUpdates / imageUpdates.length : 0,
    averageCreateDurationMs: average(createDurations),
    averageUpdateDurationMs: average(updateDurations),
    averageCreatePromptChars: average(createPromptChars),
    averageUpdatePromptChars: average(updatePromptChars),
    rollbackPoints: Math.max(0, commits.length - 1),
    fileSnapshotStrategyRate:
      promptStrategyTurns.length > 0 ? fileSnapshotTurns / promptStrategyTurns.length : 0,
    historyStrategyRate:
      promptStrategyTurns.length > 0 ? historyTurns / promptStrategyTurns.length : 0,
    localCheckOnlyRate:
      selfCheckTurns.length > 0 ? localCheckOnlyTurns / selfCheckTurns.length : 0,
    escalatedPreviewRate:
      selfCheckTurns.length > 0 ? escalatedPreviewTurns / selfCheckTurns.length : 0,
  };
}

// 把 0-1 比例转成适合 dashboard 展示的百分比文本。
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// 把毫秒格式化成秒级展示，避免 QA 面板数字太吵。
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "--";
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}
