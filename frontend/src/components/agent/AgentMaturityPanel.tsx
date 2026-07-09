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
          Agent 成熟度
        </h3>
        <span className="text-[10px] text-gray-400 dark:text-zinc-500">
          来自当前修订记录
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="目标命中率"
          value={formatRate(summary.targetHitRate)}
          helper={`${summary.targetedHits}/${summary.targetedUpdates || 0} 次目标更新`}
        />
        <MetricCard
          label="失败率"
          value={formatRate(summary.failureRate)}
          helper={`${summary.failedTurns} 次失败 / ${summary.completedTurns + summary.failedTurns} 次结束回合`}
        />
        <MetricCard
          label="平均创建"
          value={formatDuration(summary.averageCreateDurationMs)}
          helper="首稿耗时"
        />
        <MetricCard
          label="平均更新"
          value={formatDuration(summary.averageUpdateDurationMs)}
          helper="后续编辑耗时"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-zinc-400">
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          预览通过 {formatRate(summary.previewPassRate)}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          图片编辑 {formatRate(summary.imageUpdateSuccessRate)}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          回合 {summary.totalTurns}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-zinc-800">
          回退点 {summary.rollbackPoints}
        </span>
      </div>
    </div>
  );
}

export default AgentMaturityPanel;
