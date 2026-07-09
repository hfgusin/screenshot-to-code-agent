import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAppStore } from "../../store/app-store";
import { useProjectStore } from "../../store/project-store";
import { AppState, DesignSession } from "../../types";
import { formatDuration } from "../../lib/agent-maturity";
import { summarizeReviewState } from "../../lib/design-agent";
import { Commit, Variant } from "../commits/types";

// 截断长文本，避免 debug 面板被大段 HTML 或日志撑爆。
function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

// 把数组字段格式化成适合面板阅读的一行文本。
function formatMaybeList(items?: string[] | null): string {
  if (!items || items.length === 0) return "无";
  return items.join(" · ");
}

function formatIntentLabel(value?: string | null): string {
  switch (value) {
    case "generate":
      return "生成";
    case "modify":
      return "修改";
    case "repair":
      return "修复";
    case "question":
      return "提问";
    default:
      return value || "未知";
  }
}

function formatPromptStrategy(value?: string | null): string {
  switch (value) {
    case "file_snapshot":
      return "文件快照";
    case "history":
      return "历史上下文";
    default:
      return value || "未知";
  }
}

function formatPromptStrategyReason(value?: string | null): string {
  switch (value) {
    case "file_state_available":
      return "已有文件快照";
    case "snapshot_requested":
      return "明确要求走快照";
    case "prompt_mentions_prior_revision":
      return "提到了上一版或历史版本";
    case "history_only_context_available":
      return "只有历史上下文可用";
    case "history_requested":
      return "明确要求走历史";
    case "fresh_create_request":
      return "全新创建请求";
    default:
      return value || "未知";
  }
}

function formatEscalationReason(value?: string | null): string {
  switch (value) {
    case "create_requires_full_review":
      return "首稿默认完整审查";
    case "repair_turn":
      return "本轮是修复请求";
    case "intent_replace":
      return "意图是替换";
    case "intent_image_update":
      return "意图是图片更新";
    case "intent_restyle":
      return "意图是整体换风格";
    case "intent_resize":
      return "意图是尺寸调整";
    case "intent_reposition":
      return "意图是重排位置";
    case "layout_or_image_keyword":
      return "命中了布局或图片关键词";
    default:
      return value || "未知";
  }
}

function formatImpact(value?: string | null): string {
  switch (value) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    default:
      return value || "未知";
  }
}

// 给当前 commit 生成短标签，方便在 debug 面板定位版本。
function formatCommitLabel(commit: Commit | null): string {
  if (!commit) return "当前没有激活版本";
  return `${commit.type} · ${commit.hash.slice(0, 8)}`;
}

// 统一取“当前激活 variant”，避免各处重复兜底逻辑。
function getActiveVariant(commit: Commit | null): Variant | null {
  if (!commit) return null;
  return commit.variants[commit.selectedVariantIndex] ?? commit.variants[0] ?? null;
}

// 组装一份可复制的调试包，方便把当前现场直接发给别人排查。
function buildCopyableBundle(params: {
  workspaceId: string;
  appState: AppState;
  designSession: DesignSession;
  currentCommit: Commit | null;
  activeVariant: Variant | null;
  currentVersionNumber: number | null;
}) {
  const { currentCommit, activeVariant } = params;
  return {
    workspaceId: params.workspaceId,
    appState: params.appState,
    version: params.currentVersionNumber,
    designSession: {
      goal: params.designSession.goal,
      style: params.designSession.style,
      constraints: params.designSession.constraints,
      references: params.designSession.references,
      lastIntent: params.designSession.lastIntent,
      intentConfidence: params.designSession.intentConfidence,
      intentReason: params.designSession.intentReason,
      intentSignals: params.designSession.intentSignals,
      intentNeedsClarification: params.designSession.intentNeedsClarification,
      pendingQuestion: params.designSession.pendingQuestion,
      reviewSummary: params.designSession.reviewSummary,
      revisionLog: params.designSession.revisionLog.slice(-5),
      latestDelta: params.designSession.latestDelta,
      sessionSummary: params.designSession.sessionSummary,
    },
    currentCommit: currentCommit
      ? {
          hash: currentCommit.hash,
          parentHash: currentCommit.parentHash,
          type: currentCommit.type,
          dateCreated: currentCommit.dateCreated,
          selectedVariantIndex: currentCommit.selectedVariantIndex,
          inputs:
            currentCommit.type === "code_create"
              ? null
              : {
                  text: currentCommit.inputs.text,
                  selectedElementHtml: currentCommit.inputs.selectedElementHtml,
                  selectedElementContext: currentCommit.inputs.selectedElementContext,
                  designUpdateIntent: currentCommit.inputs.designUpdateIntent,
                  revisionId: currentCommit.inputs.revisionId,
                  parentCommitHash: currentCommit.inputs.parentCommitHash,
                  runId: currentCommit.inputs.runId,
                },
        }
      : null,
    activeVariant: activeVariant
      ? {
          status: activeVariant.status,
          model: activeVariant.model,
          diagnostics: activeVariant.diagnostics,
          metrics: activeVariant.metrics,
          previewSelfCheck: activeVariant.diagnostics?.selfCheckStatus,
        }
      : null,
    reviewSummary: activeVariant
      ? summarizeReviewState({
          turnIntent: params.designSession.lastIntent ?? "generate",
          selfCheck: {
            status: activeVariant.diagnostics?.selfCheckStatus ?? "warn",
            summary:
              activeVariant.diagnostics?.selfCheckSummary ||
              "预览自检尚未执行。",
            issues: activeVariant.diagnostics?.selfCheckIssues ?? [],
            isRenderable:
              activeVariant.diagnostics?.selfCheckStatus !== "fail",
          },
          targeting: activeVariant.diagnostics?.targeting,
          imageUpdateStatus: activeVariant.diagnostics?.imageUpdateStatus,
        })
      : null,
  };
}

// 用统一卡片壳子展示每一步诊断，保证 debug 面板结构稳定。
function StepCard({
  index,
  title,
  subtitle,
  body,
}: {
  index: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
              {subtitle}
            </div>
          )}
          <div className="mt-2 space-y-2 text-xs text-gray-700 dark:text-zinc-300">
            {body}
          </div>
        </div>
      </div>
    </section>
  );
}

// 把当前版本的关键信号串成一条可读的调试时间线。
function AgentDebugPanel({
  designSession,
  workspaceId,
}: {
  designSession: DesignSession;
  workspaceId: string;
}) {
  const { appState } = useAppStore();
  const { head, draftHead, commits, latestCommitHash } = useProjectStore();
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const activeCommitHash = draftHead ?? head;
  const currentCommit = activeCommitHash ? commits[activeCommitHash] : null;
  const activeVariant = getActiveVariant(currentCommit);
  const parentVariant =
    currentCommit?.parentHash && commits[currentCommit.parentHash]
      ? getActiveVariant(commits[currentCommit.parentHash])
      : null;
  const currentVersionNumber = useMemo(() => {
    if (!activeCommitHash) return null;
    const sorted = Object.values(commits).sort(
      (a, b) => new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    );
    const index = sorted.findIndex((commit) => commit.hash === activeCommitHash);
    return index === -1 ? null : index + 1;
  }, [activeCommitHash, commits]);

  const debugBundle = useMemo(
    () =>
      buildCopyableBundle({
        workspaceId,
        appState,
        designSession,
        currentCommit,
        activeVariant,
        currentVersionNumber,
      }),
    [workspaceId, appState, designSession, currentCommit, activeVariant, currentVersionNumber]
  );

  const promptState = designSession.pendingQuestion
    ? "等待补充说明"
    : designSession.intentNeedsClarification
      ? "需要澄清"
      : designSession.lastIntent
        ? formatIntentLabel(designSession.lastIntent)
        : "尚未路由";

  const reviewState = activeVariant?.diagnostics?.selfCheckStatus
    ? `${activeVariant.diagnostics.selfCheckStatus} · ${
        activeVariant.diagnostics.selfCheckSummary || "暂无摘要"
      }`
    : "尚未自检";

  const targetState = activeVariant?.diagnostics?.targeting
    ? `${Math.round(activeVariant.diagnostics.targeting.score * 100)}% 命中 · ${
        activeVariant.diagnostics.targeting.collateralDamage
          ? "非目标区域有变化"
          : "非目标区域已保留"
      }`
    : "暂无目标命中诊断";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugBundle, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const renderingState = activeVariant?.diagnostics?.rendering
    ? activeVariant.diagnostics.rendering.hasRenderableDocument
      ? `保留 ${activeVariant.diagnostics.rendering.primaryDocumentType} · 裁掉 ${
          activeVariant.diagnostics.rendering.discardedContentLength ?? 0
        } 个字符`
      : "没有找到可渲染文档"
    : "暂无渲染清理记录";

  const changeState = activeVariant?.diagnostics?.changeReport
    ? `${activeVariant.diagnostics.changeReport.summary} · 影响 ${formatImpact(activeVariant.diagnostics.changeReport.impact)}`
    : "暂无变更报告";

  const promptMetrics = activeVariant?.metrics?.promptMetrics;
  const promptDelta =
    typeof promptMetrics?.promptChars === "number" &&
    typeof parentVariant?.metrics?.promptMetrics?.promptChars === "number"
      ? promptMetrics.promptChars - parentVariant.metrics.promptMetrics.promptChars
      : null;
  const durationDelta =
    typeof activeVariant?.metrics?.durationMs === "number" &&
    typeof parentVariant?.metrics?.durationMs === "number"
      ? activeVariant.metrics.durationMs - parentVariant.metrics.durationMs
      : null;
  const promptStateDetail = [
    formatPromptStrategy(activeVariant?.diagnostics?.promptStrategy),
    formatPromptStrategyReason(activeVariant?.diagnostics?.promptStrategyReason),
    promptMetrics?.promptChars ? `${promptMetrics.promptChars} 字符` : null,
    promptMetrics?.estimatedTokens
      ? `约 ${promptMetrics.estimatedTokens} token`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            调试分步看板
          </h3>
          <p className="mt-1 text-xs text-violet-900/80 dark:text-violet-100/80">
            按步骤查看：意图 → 目标 → 预览 → 修订。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/50"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      {!expanded ? (
        <div className="mt-3 rounded-xl border border-violet-200 bg-white/80 px-3 py-2 text-xs text-violet-900 dark:border-violet-900/40 dark:bg-zinc-950/60 dark:text-violet-100">
          {promptState} · {reviewState}
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          <StepCard
            index="1"
            title="意图路由"
            subtitle={formatCommitLabel(currentCommit)}
            body={
              <>
                <div>状态：{promptState}</div>
                <div>
                  置信度：
                  {typeof designSession.intentConfidence === "number"
                    ? `${Math.round(designSession.intentConfidence * 100)}%`
                    : "--"}
                </div>
                <div>原因：{designSession.intentReason || "暂无记录。"}</div>
                <div>信号：{formatMaybeList(designSession.intentSignals)}</div>
              </>
            }
          />

          <StepCard
            index="2"
            title="结构化目标"
            subtitle="这次更新允许触碰的范围"
            body={
              currentCommit && currentCommit.type !== "code_create" ? (
                <>
                  <div>
                    选中元素：
                    {currentCommit.inputs.selectedElementHtml
                      ? truncate(currentCommit.inputs.selectedElementHtml, 120)
                      : "无"}
                  </div>
                  <div>
                    上下文：
                    {currentCommit.inputs.selectedElementContext
                      ? truncate(currentCommit.inputs.selectedElementContext, 120)
                      : "无"}
                  </div>
                  <div>
                    更新意图：
                    {currentCommit.inputs.designUpdateIntent
                      ? `${currentCommit.inputs.designUpdateIntent.target} / ${currentCommit.inputs.designUpdateIntent.intent} / ${currentCommit.inputs.designUpdateIntent.alignment}`
                      : "无"}
                  </div>
                </>
              ) : (
                <div>当前还没有激活的选区或编辑意图。</div>
              )
            }
          />

          <StepCard
            index="3"
            title="运行轨迹"
            subtitle="这一轮实际发生了什么"
            body={
              activeVariant ? (
                <>
                  <div>模型：{activeVariant.model || "未知"}</div>
                  <div>
                    状态：
                    {activeVariant.status === "complete"
                      ? "完成"
                      : activeVariant.status === "error"
                        ? "失败"
                        : activeVariant.status === "generating"
                          ? "生成中"
                          : activeVariant.status || "未知"}
                  </div>
                  <div>耗时：{formatDuration(activeVariant.metrics?.durationMs ?? null)}</div>
                  <div>Prompt 路径：{promptStateDetail || "暂无 prompt 诊断"}</div>
                  <div>
                    相比上一版：
                    {promptDelta === null
                      ? "没有 prompt 基线"
                      : `${promptDelta > 0 ? "+" : ""}${promptDelta} 字符`}
                    {" · "}
                    {durationDelta === null
                      ? "没有耗时基线"
                      : `${durationDelta > 0 ? "+" : ""}${Math.round(durationDelta / 1000)}s`}
                  </div>
                  <div>失败阶段：{activeVariant.diagnostics?.failureStage || "无"}</div>
                  <div>
                    分阶段耗时：
                    {activeVariant.metrics?.stageTimings
                      ? [
                          activeVariant.metrics.stageTimings.requestParseMs,
                          activeVariant.metrics.stageTimings.promptBuildMs,
                          activeVariant.metrics.stageTimings.modelGenerationMs,
                          activeVariant.metrics.stageTimings.toolRuntimeMs,
                          activeVariant.metrics.stageTimings.imageGenerationMs,
                          activeVariant.metrics.stageTimings.previewSelfCheckMs,
                        ]
                          .filter((value) => typeof value === "number")
                          .map((value) => `${Math.round((value as number) / 1000)}s`)
                          .join(" · ")
                      : "无"}
                  </div>
                  <div>渲染清理：{renderingState}</div>
                </>
              ) : (
                <div>当前还没有激活的 variant。</div>
              )
            }
          />

          <StepCard
            index="4"
            title="变更报告"
            subtitle="这一版相对上一版到底改了哪里"
            body={
              <>
                <div>{changeState}</div>
                {activeVariant?.diagnostics?.changeReport && (
                  <>
                    <div>
                      节点变化：+{activeVariant.diagnostics.changeReport.addedNodes} / -
                      {activeVariant.diagnostics.changeReport.removedNodes} / ~
                      {activeVariant.diagnostics.changeReport.changedNodes}
                    </div>
                    <div>
                      区域：
                      {activeVariant.diagnostics.changeReport.changedRegions.length > 0
                        ? activeVariant.diagnostics.changeReport.changedRegions.join(" · ")
                        : "没有抓到明显的局部区域。"}
                    </div>
                  </>
                )}
              </>
            }
          />

          <StepCard
            index="5"
            title="预览自检"
            subtitle="这次结果能不能放心保留"
            body={
              <>
                <div>{reviewState}</div>
                <div>目标得分：{targetState}</div>
                <div>
                  审查路径：
                  {activeVariant?.diagnostics?.localCheckOnly
                    ? "仅本地检查"
                    : activeVariant?.diagnostics?.escalatedPreviewCheck
                      ? `升级审查 · ${formatEscalationReason(activeVariant.diagnostics.previewEscalationReason)}`
                      : "暂无记录"}
                </div>
                <div>
                  摘要：{activeVariant?.diagnostics?.selfCheckSummary || "暂无摘要。"}
                </div>
                {activeVariant?.diagnostics?.rendering?.discardedContentPreview && (
                  <div>
                    剔除内容：
                    {truncate(activeVariant.diagnostics.rendering.discardedContentPreview, 140)}
                  </div>
                )}
                {!!activeVariant?.diagnostics?.selfCheckIssues?.length && (
                  <div>
                    问题：{activeVariant.diagnostics.selfCheckIssues.join(" · ")}
                  </div>
                )}
              </>
            }
          />

          <StepCard
            index="6"
            title="修订与回退"
            subtitle="一边继续推进，一边保留完整轨迹"
            body={
              <>
                <div>Workspace：{workspaceId}</div>
                <div>
                  版本：
                  {currentVersionNumber ? `#${currentVersionNumber}` : "未知"} ·{" "}
                  最新：{activeCommitHash === latestCommitHash ? "是" : "否"}
                </div>
                <div>修订轨迹：{designSession.revisionLog.length} 条</div>
                {designSession.revisionLog.length > 0 && (
                  <div>
                    最新备注：{truncate(designSession.revisionLog[designSession.revisionLog.length - 1], 140)}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    to="/evals/prompt-reports"
                    className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/50"
                  >
                    Prompt 报告
                  </Link>
                  <Link
                    to="/evals/agent-qa"
                    className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/50"
                  >
                    Agent 质检
                  </Link>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/50"
                  >
                    {copied ? "已复制" : "复制调试包"}
                  </button>
                </div>
              </>
            }
          />
        </div>
      )}
    </section>
  );
}

export default AgentDebugPanel;
