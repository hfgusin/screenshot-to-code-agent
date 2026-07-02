import { useMemo } from "react";
import { useProjectStore } from "../../store/project-store";
import {
  buildAgentMaturitySummary,
  formatDuration,
  formatRate,
} from "../../lib/agent-maturity";

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-gray-950 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-zinc-400">{helper}</div>
    </div>
  );
}

function AgentMaturityPanel() {
  const { commits } = useProjectStore();
  const summary = useMemo(() => buildAgentMaturitySummary(commits), [commits]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
          Agent maturity
        </h3>
        <span className="text-[10px] text-gray-400 dark:text-zinc-500">
          live from revisions
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Target hit rate"
          value={formatRate(summary.targetHitRate)}
          helper={`${summary.targetedHits}/${summary.targetedUpdates || 0} targeted updates`}
        />
        <MetricCard
          label="Failure rate"
          value={formatRate(summary.failureRate)}
          helper={`${summary.failedTurns} failed / ${summary.completedTurns + summary.failedTurns} terminal turns`}
        />
        <MetricCard
          label="Avg create"
          value={formatDuration(summary.averageCreateDurationMs)}
          helper="first-draft duration"
        />
        <MetricCard
          label="Avg update"
          value={formatDuration(summary.averageUpdateDurationMs)}
          helper="follow-up edit duration"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-zinc-400">
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          Preview pass {formatRate(summary.previewPassRate)}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          Image edits {formatRate(summary.imageUpdateSuccessRate)}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          Turns {summary.totalTurns}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          Rollback points {summary.rollbackPoints}
        </span>
      </div>
    </div>
  );
}

export default AgentMaturityPanel;
