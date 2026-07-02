import { useEffect, useMemo, useState } from "react";

import { HTTP_BACKEND_URL } from "../../config";
import EvalNavigation from "./EvalNavigation";
import {
  buildAgentMaturitySummary,
  formatDuration,
  formatRate,
} from "../../lib/agent-maturity";
import {
  loadWorkspaceSnapshotById,
  readRecentWorkspaces,
} from "../../lib/workspace-storage";
import { Commit } from "../commits/types";

interface AgentQaRunSummary {
  filename: string;
  run_id: string;
  mode: string;
  created_at: string;
  duration_ms: number | null;
  passed_cases: number;
  failed_cases: number;
  total_cases: number;
  success_rate: number;
}

interface AgentQaRunListResponse {
  runs: AgentQaRunSummary[];
  artifacts_directory: string;
}

interface AgentQaCaseResult {
  id: string;
  title: string;
  pass: boolean;
  durationMs: number;
  screenshots: string[];
  notes: string[];
  error?: string;
}

interface AgentQaRunContent {
  run_id: string;
  mode: string;
  created_at: string;
  duration_ms: number;
  summary?: {
    total_cases: number;
    passed_cases: number;
    failed_cases: number;
    success_rate: number;
    p50_duration_ms?: number | null;
    p95_duration_ms?: number | null;
  };
  case_results?: AgentQaCaseResult[];
  prompt_reports?: Array<{ filename: string; created_at?: string }>;
}

interface WorkspaceMetricsSnapshot {
  id: string;
  title: string;
  summary: ReturnType<typeof buildAgentMaturitySummary>;
}

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
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="mt-1 text-xs text-zinc-400">{helper}</div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function aggregateWorkspaceMetrics(workspaces: WorkspaceMetricsSnapshot[]) {
  if (workspaces.length === 0) {
    return {
      targetHitRate: 0,
      previewPassRate: 0,
      imageUpdateSuccessRate: 0,
      avgCreate: null as number | null,
      avgUpdate: null as number | null,
      totalTurns: 0,
    };
  }

  const totals = workspaces.reduce(
    (acc, workspace) => {
      acc.targetHitRate += workspace.summary.targetHitRate;
      acc.previewPassRate += workspace.summary.previewPassRate;
      acc.imageUpdateSuccessRate += workspace.summary.imageUpdateSuccessRate;
      acc.totalTurns += workspace.summary.totalTurns;
      if (workspace.summary.averageCreateDurationMs !== null) {
        acc.createDurations.push(workspace.summary.averageCreateDurationMs);
      }
      if (workspace.summary.averageUpdateDurationMs !== null) {
        acc.updateDurations.push(workspace.summary.averageUpdateDurationMs);
      }
      return acc;
    },
    {
      targetHitRate: 0,
      previewPassRate: 0,
      imageUpdateSuccessRate: 0,
      totalTurns: 0,
      createDurations: [] as number[],
      updateDurations: [] as number[],
    }
  );

  const average = (values: number[]) =>
    values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

  return {
    targetHitRate: totals.targetHitRate / workspaces.length,
    previewPassRate: totals.previewPassRate / workspaces.length,
    imageUpdateSuccessRate: totals.imageUpdateSuccessRate / workspaces.length,
    avgCreate: average(totals.createDurations),
    avgUpdate: average(totals.updateDurations),
    totalTurns: totals.totalTurns,
  };
}

function AgentQaPage() {
  const [runs, setRuns] = useState<AgentQaRunSummary[]>([]);
  const [artifactsDirectory, setArtifactsDirectory] = useState("");
  const [selectedRun, setSelectedRun] = useState<AgentQaRunContent | null>(null);
  const [workspaceMetrics, setWorkspaceMetrics] = useState<WorkspaceMetricsSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRuns() {
      try {
        const response = await fetch(`${HTTP_BACKEND_URL}/agent-qa/runs`);
        if (!response.ok) {
          throw new Error("Failed to load Agent QA runs.");
        }
        const payload = (await response.json()) as AgentQaRunListResponse;
        setRuns(payload.runs);
        setArtifactsDirectory(payload.artifacts_directory);
        if (payload.runs[0]) {
          const first = payload.runs[0];
          const detailResponse = await fetch(
            `${HTTP_BACKEND_URL}/agent-qa/runs/content?filename=${encodeURIComponent(first.filename)}`
          );
          if (detailResponse.ok) {
            setSelectedRun((await detailResponse.json()) as AgentQaRunContent);
          }
        }
      } catch (nextError) {
        console.error(nextError);
        setError("Could not load Agent QA artifacts.");
      }
    }

    async function loadWorkspaces() {
      const summaries = readRecentWorkspaces();
      const loaded = await Promise.all(
        summaries.slice(0, 5).map(async (summary) => {
          const snapshot = await loadWorkspaceSnapshotById(summary.id);
          if (!snapshot) return null;
          const commits = Object.fromEntries(
            snapshot.data.project.commits.map((commit: Commit) => [commit.hash, commit])
          );
          return {
            id: summary.id,
            title: summary.title,
            summary: buildAgentMaturitySummary(commits),
          };
        })
      );
      setWorkspaceMetrics(
        loaded.filter((item): item is WorkspaceMetricsSnapshot => item !== null)
      );
    }

    void loadRuns();
    void loadWorkspaces();
  }, []);

  const workspaceSummary = useMemo(
    () => aggregateWorkspaceMetrics(workspaceMetrics),
    [workspaceMetrics]
  );

  const latestRunSummary = selectedRun?.summary;

  return (
    <div className="min-h-screen bg-black text-white">
      <EvalNavigation />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Latest live run"
            value={
              latestRunSummary
                ? `${latestRunSummary.passed_cases}/${latestRunSummary.total_cases}`
                : "--"
            }
            helper={selectedRun ? `${selectedRun.mode} · ${formatTimestamp(selectedRun.created_at)}` : "No runs yet"}
          />
          <MetricCard
            label="Workspace hit rate"
            value={formatRate(workspaceSummary.targetHitRate)}
            helper={`${workspaceMetrics.length} recent workspaces`}
          />
          <MetricCard
            label="Preview pass"
            value={formatRate(workspaceSummary.previewPassRate)}
            helper={`Across ${workspaceSummary.totalTurns} turns`}
          />
          <MetricCard
            label="Image edit success"
            value={formatRate(workspaceSummary.imageUpdateSuccessRate)}
            helper="Recent workspace revisions"
          />
          <MetricCard
            label="P95 update"
            value={formatDuration(latestRunSummary?.p95_duration_ms ?? workspaceSummary.avgUpdate)}
            helper="From latest QA run or recent workspaces"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-rose-800 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Agent QA Runs
              </div>
              <div className="mt-1 text-sm text-zinc-400">
                {artifactsDirectory || "No artifacts directory found."}
              </div>
            </div>
            <div className="space-y-2">
              {runs.map((run) => (
                <button
                  key={run.filename}
                  type="button"
                  onClick={async () => {
                    const response = await fetch(
                      `${HTTP_BACKEND_URL}/agent-qa/runs/content?filename=${encodeURIComponent(run.filename)}`
                    );
                    if (!response.ok) return;
                    setSelectedRun((await response.json()) as AgentQaRunContent);
                  }}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedRun?.run_id === run.run_id
                      ? "border-violet-500 bg-violet-950/40"
                      : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-100">{run.run_id}</div>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
                      {run.mode}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {formatTimestamp(run.created_at)}
                  </div>
                  <div className="mt-2 text-xs text-zinc-300">
                    {run.passed_cases}/{run.total_cases} passed · {formatDuration(run.duration_ms)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Latest Run Detail
                  </div>
                  <div className="mt-1 text-sm text-zinc-300">
                    {selectedRun ? `${selectedRun.run_id} · ${formatTimestamp(selectedRun.created_at)}` : "No run selected"}
                  </div>
                </div>
                {latestRunSummary && (
                  <div className="text-right text-xs text-zinc-400">
                    <div>P50 {formatDuration(latestRunSummary.p50_duration_ms ?? null)}</div>
                    <div>P95 {formatDuration(latestRunSummary.p95_duration_ms ?? null)}</div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {selectedRun?.case_results?.map((result) => (
                  <div
                    key={result.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-zinc-100">{result.title}</div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          result.pass
                            ? "bg-emerald-950 text-emerald-300"
                            : "bg-rose-950 text-rose-300"
                        }`}
                      >
                        {result.pass ? "pass" : "fail"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {formatDuration(result.durationMs)}
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-300">
                      {result.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                      {result.error && <li className="text-rose-300">{result.error}</li>}
                    </ul>
                    {result.screenshots.length > 0 && (
                      <div className="mt-2 text-xs text-zinc-500">
                        {result.screenshots.join(" · ")}
                      </div>
                    )}
                  </div>
                )) || <div className="text-sm text-zinc-400">No run details yet.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Recent Workspace Metrics
              </div>
              <div className="space-y-2">
                {workspaceMetrics.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3"
                  >
                    <div className="text-sm font-medium text-zinc-100">{workspace.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
                      <span>Hit {formatRate(workspace.summary.targetHitRate)}</span>
                      <span>Preview {formatRate(workspace.summary.previewPassRate)}</span>
                      <span>Image {formatRate(workspace.summary.imageUpdateSuccessRate)}</span>
                      <span>Turns {workspace.summary.totalTurns}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Prompt Reports
              </div>
              <div className="space-y-2 text-sm text-zinc-300">
                {selectedRun?.prompt_reports?.length ? (
                  selectedRun.prompt_reports.map((report) => (
                    <div
                      key={report.filename}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                    >
                      <div>{report.filename}</div>
                      {report.created_at && (
                        <div className="text-xs text-zinc-500">
                          {formatTimestamp(report.created_at)}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500">No prompt reports captured for the selected run.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentQaPage;
