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
  rollbackPoints: number;
}

function getActiveVariant(commit: Commit): Variant | null {
  const variant = commit.variants[commit.selectedVariantIndex];
  return variant ?? commit.variants[0] ?? null;
}

function isAgentCommit(
  commit: Commit
): commit is Exclude<Commit, { type: "code_create" }> {
  return commit.type !== "code_create";
}

function hasVariant(
  entry: { commit: Exclude<Commit, { type: "code_create" }>; variant: Variant | null }
): entry is {
  commit: Exclude<Commit, { type: "code_create" }>;
  variant: Variant;
} {
  return entry.variant !== null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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
    rollbackPoints: Math.max(0, commits.length - 1),
  };
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "--";
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}
