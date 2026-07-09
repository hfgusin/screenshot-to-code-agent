import {
  AgentChangeReport,
  AgentImageUpdateStatus,
  AgentRenderingDiagnostics,
  AgentTargetingDiagnostics,
  DesignUpdateIntent,
  DesignSession,
  IntentDecision,
  PreviewSelfCheckResult,
  TurnIntent,
} from "../types";
import { HTTP_BACKEND_URL } from "../config";
import { splitRenderableOutput } from "./renderable-output";

const LAYOUT_KEYWORDS: Array<[RegExp, Partial<DesignUpdateIntent>]> = [
  [/(居中|center|centered|置中)/i, { alignment: "center" }],
  [/(左对齐|left aligned?|align left)/i, { alignment: "left" }],
  [/(右对齐|right aligned?|align right)/i, { alignment: "right" }],
  [/(第一行|first row|top row)/i, { placement: "first row" }],
  [/(顶部|top|header)/i, { placement: "top section" }],
  [/(底部|bottom|footer)/i, { placement: "bottom section" }],
  [/(左侧|left side|sidebar)/i, { placement: "left side" }],
  [/(右侧|right side)/i, { placement: "right side" }],
];

const INTENT_KEYWORDS: Array<[RegExp, string]> = [
  [/(居中|对齐|align|move|移动|调整到)/i, "reposition"],
  [/(换成|replace|替换)/i, "replace"],
  [/(粉红|pink|蓝色|blue|颜色|color)/i, "recolor"],
  [/(图片|image|照片|photo|hero image)/i, "image update"],
  [/(间距|spacing|padding|margin)/i, "spacing"],
  [/(大小|bigger|smaller|resize|放大|缩小)/i, "resize"],
  [/(风格|style|高级|premium|minimal|杂志)/i, "restyle"],
];

const TARGET_KEYWORDS: Array<[RegExp, string]> = [
  [/(按钮|button|cta)/i, "button group"],
  [/(导航|nav|navbar|header)/i, "navigation"],
  [/(图片|image|hero|封面|海报)/i, "image block"],
  [/(卡片|card|tile)/i, "content card"],
  [/(标题|title|headline)/i, "title block"],
  [/(播放|前进|后退|player|controls|control)/i, "media controls"],
  [/(表格|table)/i, "table"],
  [/(图表|chart|graph)/i, "chart block"],
];

const QUESTION_KEYWORDS = [
  /(\?|？)/,
  /(怎么|如何|为什么|能不能|可不可以|是不是|what|why|how|should|could|can you)/i,
];

const REPAIR_KEYWORDS = [
  /(修复|修一下|修正|报错|错误|失败|坏了|崩了|bug|fix|restore|恢复)/i,
  /(preview|预览).*(空白|失败|报错|不显示)/i,
];

const MODIFY_KEYWORDS = [
  /(改|调整|修改|优化|重排|替换|保留|居中|移动|缩小|放大|换成|不要|别动)/i,
  /(update|modify|refine|reposition|restyle|align|center)/i,
];

const REFERENCE_KEYWORDS = [
  /(参考|仿照|借鉴|类似|看齐|像.*一样|风格参考|参考图|reference)/i,
];

const CREATE_KEYWORDS = [
  /(做|生成|创建|设计|画|build|create|make|generate|design)/i,
];

function hasAnyMatch(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function extractTagName(html: string): string | null {
  const match = html.trim().match(/^<\s*([a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function collectMatchedSignals(params: {
  text: string;
  selectedElementHtml?: string | null;
  currentCode?: string;
}): string[] {
  const signals: string[] = [];
  const text = params.text.trim();
  if (hasAnyMatch(text, QUESTION_KEYWORDS)) signals.push("question");
  if (hasAnyMatch(text, REPAIR_KEYWORDS)) signals.push("repair");
  if (hasAnyMatch(text, MODIFY_KEYWORDS)) signals.push("modify");
  if (hasAnyMatch(text, REFERENCE_KEYWORDS)) signals.push("reference");
  if (hasAnyMatch(text, CREATE_KEYWORDS)) signals.push("create");
  if (params.selectedElementHtml?.trim()) signals.push("selection");
  if (params.currentCode?.trim()) signals.push("draft");
  return signals;
}

function buildStructuredUpdateIntent(params: {
  text: string;
  selectedElementHtml?: string | null;
  generationType: "create" | "update";
}): DesignUpdateIntent | undefined {
  if (params.generationType !== "update" && !params.selectedElementHtml?.trim()) {
    return undefined;
  }
  return parseDesignUpdateIntent(
    params.text,
    params.selectedElementHtml ? extractTagName(params.selectedElementHtml) : null
  );
}

export function routeUserTurn(params: {
  text: string;
  generationType: "create" | "update";
  selectedElementHtml?: string | null;
  currentCode?: string;
}): IntentDecision {
  const text = params.text.trim();
  const hasSelection = Boolean(params.selectedElementHtml?.trim());
  const hasExistingDraft = Boolean(params.currentCode?.trim());
  const signals = collectMatchedSignals(params);
  const structuredUpdateIntent = buildStructuredUpdateIntent(params);
  let intent: TurnIntent = params.generationType === "create" ? "generate" : "modify";
  let confidence = 0.5;
  let reason = "使用默认路由兜底。";
  let shouldAskQuestion = false;

  if (!text && params.generationType === "update") {
    intent = "modify";
    confidence = 0.82;
    reason = "已有草稿但更新文本为空，通常表示一次局部编辑。";
  } else if (
    !hasExistingDraft &&
    params.generationType === "update" &&
    hasAnyMatch(text, QUESTION_KEYWORDS)
  ) {
    intent = "question";
    confidence = 0.88;
    reason = "当前请求更像在澄清问题，而不是直接改稿。";
    shouldAskQuestion = true;
  } else if (hasAnyMatch(text, REPAIR_KEYWORDS)) {
    intent = "repair";
    confidence = 0.9;
    reason = "命中了修复类关键词。";
  } else if (hasAnyMatch(text, REFERENCE_KEYWORDS)) {
    intent = params.generationType === "create" ? "generate" : "modify";
    confidence = 0.81;
    reason = "提到了参考风格，后端会先补充上下文再生成。";
  } else if (
    hasSelection &&
    (params.generationType === "update" || hasAnyMatch(text, MODIFY_KEYWORDS))
  ) {
    intent = "modify";
    confidence = 0.92;
    reason = "存在选区，强烈说明这是一次局部更新。";
  } else if (hasAnyMatch(text, QUESTION_KEYWORDS) && !hasAnyMatch(text, MODIFY_KEYWORDS)) {
    intent =
      params.generationType === "create" && hasAnyMatch(text, CREATE_KEYWORDS)
        ? "generate"
        : "question";
    confidence = intent === "generate" ? 0.64 : 0.72;
    reason =
      intent === "generate"
        ? "文本里虽然有问句，但整体仍然是明确的创建请求。"
        : "文本整体更像是在请求澄清。";
    shouldAskQuestion = intent === "question";
  } else if (params.generationType === "create") {
    intent = "generate";
    confidence = 0.84;
    reason = "create 模式默认生成一份新草稿。";
  } else if (hasAnyMatch(text, MODIFY_KEYWORDS)) {
    intent = "modify";
    confidence = 0.76;
    reason = "命中了修改类关键词。";
  } else if (hasAnyMatch(text, CREATE_KEYWORDS)) {
    intent = "generate";
    confidence = 0.7;
    reason = "命中了创建类关键词。";
  } else {
    intent = params.generationType === "update" ? "modify" : "generate";
    confidence = 0.58;
    reason = "没有发现特别强的路由信号，因此走默认路径。";
    shouldAskQuestion = params.generationType === "update" && !hasSelection && text.length < 24;
  }

  if (params.generationType === "update" && !hasSelection && intent === "modify") {
    confidence = Math.min(confidence, 0.68);
    if (text.length < 16) {
      shouldAskQuestion = true;
      reason = "这次更新描述太短且缺少锚点，因此路由器会先要求补充说明。";
    }
  }

  if (intent === "question") {
    shouldAskQuestion = true;
  }

  return {
    intent,
    confidence: Number(confidence.toFixed(2)),
    reason,
    shouldAskQuestion,
    signals,
    structuredUpdateIntent,
  };
}

interface IntentRouterResponsePayload extends IntentDecision {
  source?: "llm" | "rules";
  model?: string | null;
}

function normalizeIntentRouterDecision(raw: unknown): IntentDecision | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<IntentRouterResponsePayload> & {
    decision?: Partial<IntentRouterResponsePayload>;
  };
  const payload = candidate.decision ?? candidate;
  const intent = payload.intent;
  if (
    intent !== "generate" &&
    intent !== "modify" &&
    intent !== "repair" &&
    intent !== "question"
  ) {
    return null;
  }

  const confidence =
    typeof payload.confidence === "number" ? payload.confidence : Number.NaN;
  if (!Number.isFinite(confidence)) {
    return null;
  }

  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const shouldAskQuestion =
    typeof payload.shouldAskQuestion === "boolean"
      ? payload.shouldAskQuestion
      : typeof (payload as { should_ask_question?: unknown }).should_ask_question === "boolean"
        ? Boolean((payload as { should_ask_question: boolean }).should_ask_question)
        : false;

  const signals = Array.isArray(payload.signals)
    ? payload.signals.filter((signal): signal is string => typeof signal === "string")
    : [];

  const structuredUpdateIntent = payload.structuredUpdateIntent;
  const normalizedUpdateIntent =
    structuredUpdateIntent && typeof structuredUpdateIntent === "object"
      ? {
          target:
            typeof structuredUpdateIntent.target === "string"
              ? structuredUpdateIntent.target
              : "",
          intent:
            typeof structuredUpdateIntent.intent === "string"
              ? structuredUpdateIntent.intent
              : "",
          placement:
            typeof structuredUpdateIntent.placement === "string"
              ? structuredUpdateIntent.placement
              : "",
          alignment:
            typeof structuredUpdateIntent.alignment === "string"
              ? structuredUpdateIntent.alignment
              : "",
          preserve: Array.isArray(structuredUpdateIntent.preserve)
            ? structuredUpdateIntent.preserve.filter(
                (item): item is string => typeof item === "string"
              )
            : [],
        }
      : undefined;

  return {
    intent,
    confidence: Number(confidence.toFixed(2)),
    reason,
    shouldAskQuestion,
    signals,
    structuredUpdateIntent: normalizedUpdateIntent,
  };
}

export async function resolveIntentDecision(params: {
  text: string;
  generationType: "create" | "update";
  selectedElementHtml?: string | null;
  selectedElementContext?: string | null;
  currentCode?: string;
  designSession?: DesignSession;
  fullText?: string;
}): Promise<IntentDecision> {
  const fallback = routeUserTurn({
    text: params.fullText ?? params.text,
    generationType: params.generationType,
    selectedElementHtml: params.selectedElementHtml,
    currentCode: params.currentCode,
  });

  try {
    const response = await fetch(`${HTTP_BACKEND_URL}/api/intent-router`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: params.text,
        fullText: params.fullText,
        generationType: params.generationType,
        selectedElementHtml: params.selectedElementHtml ?? null,
        selectedElementContext: params.selectedElementContext ?? null,
        currentCode: params.currentCode ?? null,
        designSession: params.designSession ?? null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Intent router request failed: ${response.status}`);
    }

    const raw = (await response.json()) as unknown;
    const decision = normalizeIntentRouterDecision(raw);
    if (decision) {
      return decision;
    }
  } catch (error) {
    console.warn("Falling back to local intent router.", error);
  }

  return fallback;
}

export function classifyUserTurnIntent(params: {
  text: string;
  generationType: "create" | "update";
  selectedElementHtml?: string | null;
  currentCode?: string;
}): TurnIntent {
  return routeUserTurn(params).intent;
}

export function summarizeReviewState(params: {
  turnIntent: TurnIntent;
  selfCheck: PreviewSelfCheckResult;
  targeting?: AgentTargetingDiagnostics;
  imageUpdateStatus?: AgentImageUpdateStatus | null;
}): string {
  const intentLabel = params.turnIntent;
  const previewLabel = `${params.selfCheck.status}: ${params.selfCheck.summary}`;
  const targetLabel = params.targeting
    ? params.targeting.collateralDamage
      ? `target=${params.targeting.targetSummary || "selected area"}; hit=partial`
      : `target=${params.targeting.targetSummary || "selected area"}; hit=${
          params.targeting.intentMatched ? "yes" : "no"
        }`
    : "target=n/a";
  const imageLabel = params.imageUpdateStatus
    ? `image=${params.imageUpdateStatus.operation}/${params.imageUpdateStatus.status}`
    : "image=n/a";

  return [
    `intent=${intentLabel}`,
    `preview=${previewLabel}`,
    targetLabel,
    imageLabel,
  ].join("; ");
}

function normalizePreserveClauses(instruction: string): string[] {
  const clauses = instruction
    .split(/[。.!！？\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses
    .filter((clause) =>
      /(保留|保持|不要|别动|不要改|别改|不改|preserve|keep|don't change|leave)/i.test(
        clause
      )
    )
    .map((clause) => {
      const match = clause.match(
        /(保留.*|保持.*|不要.*|别动.*|不要改.*|别改.*|不改.*|preserve.*|keep.*|don't change.*|leave.*)$/i
      );
      return (match?.[1] || clause).trim();
    })
    .slice(0, 4);
}

export function parseDesignUpdateIntent(
  instruction: string,
  selectedTagName?: string | null
): DesignUpdateIntent {
  const normalizedInstruction = instruction.trim();
  const preserve = normalizePreserveClauses(normalizedInstruction);

  const target =
    TARGET_KEYWORDS.find(([pattern]) => pattern.test(normalizedInstruction))?.[1] ??
    (selectedTagName ? `${selectedTagName} container` : "selected section");
  const intent =
    INTENT_KEYWORDS.find(([pattern]) => pattern.test(normalizedInstruction))?.[1] ??
    "refine";

  const layoutFields = LAYOUT_KEYWORDS.reduce<Partial<DesignUpdateIntent>>(
    (acc, [pattern, fields]) =>
      pattern.test(normalizedInstruction) ? { ...acc, ...fields } : acc,
    {}
  );

  return {
    target,
    intent,
    placement: layoutFields.placement ?? "preserve current section flow",
    alignment: layoutFields.alignment ?? "preserve current alignment",
    preserve:
      preserve.length > 0
        ? preserve
        : ["保留目标容器之外的其他页面内容不变。"],
  };
}

function stripCodeFences(code: string): string {
  return code
    .trim()
    .replace(/^```html?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function isRenderableHtmlDocument(code: string): boolean {
  return splitRenderableOutput(code).hasRenderableDocument;
}

// 提取首个可渲染文档的诊断信息，供 preview 和 debug 面板复用。
export function extractRenderableDiagnostics(
  code: string
): AgentRenderingDiagnostics {
  const split = splitRenderableOutput(code);
  return {
    primaryDocumentType: split.primaryDocumentType,
    hasRenderableDocument: split.hasRenderableDocument,
    discardedContentPreview:
      split.discardedContent.length > 0
        ? split.discardedContent.slice(0, 240)
        : undefined,
    discardedContentLength: split.discardedContent.length || undefined,
  };
}

interface PreviewSelfCheckOptions {
  generationType?: "create" | "update";
  turnIntent?: TurnIntent;
  selectedElementHtml?: string | null;
  previousCode?: string;
  designUpdateIntent?: DesignUpdateIntent;
  userInstruction?: string;
}

// 根据本轮请求的类型和内容，判断是否需要升级到更重的 preview 审查。
export function getPreviewEscalationReason(
  options?: PreviewSelfCheckOptions
): string | null {
  if (!options) return null;
  if (options.generationType === "create") return "create_requires_full_review";
  if (options.turnIntent === "repair") return "repair_turn";

  const intent = options.designUpdateIntent?.intent?.toLowerCase() || "";
  if (
    ["replace", "image update", "restyle", "resize", "reposition"].includes(intent)
  ) {
    return `intent_${intent.replace(/\s+/g, "_")}`;
  }

  const text = (options.userInstruction || "").toLowerCase();
  if (
    /(layout|重排|间距|spacing|图片|image|hero|responsive|移动端|mobile)/i.test(text)
  ) {
    return "layout_or_image_keyword";
  }
  return null;
}

// 先用本地硬规则做一层低成本自检，尽早拦住明显坏稿。
export function runPreviewSelfCheck(
  code: string,
  options?: PreviewSelfCheckOptions
): PreviewSelfCheckResult {
  const trimmed = stripCodeFences(code);
  const split = splitRenderableOutput(trimmed);
  const issues: string[] = [];
  const hardFailures: string[] = [];
  const previewEscalationReason = getPreviewEscalationReason(options);
  const escalatedPreviewCheck = previewEscalationReason !== null;
  const localCheckOnly = !escalatedPreviewCheck;

  if (!trimmed) {
    return {
      status: "fail",
      summary: "Agent 返回了空草稿。",
      issues: ["没有产出任何代码。"],
      isRenderable: false,
      localCheckOnly,
      escalatedPreviewCheck,
    };
  }

  const renderable = split.hasRenderableDocument;
  if (!renderable) {
    hardFailures.push("结果不是一份完整的 HTML 文档。");
  }
  if (split.discardedContent.trim().length > 0) {
    issues.push(
      "结果里混入了首个文档之外的非渲染内容。"
    );
  }
  if (/^(here('|’)s|i('|’)ve|updated|summary:|explanation:)/i.test(trimmed)) {
    hardFailures.push(
      "结果更像是说明文字，而不是可预览的代码。"
    );
  }
  if (!/<body\b/i.test(trimmed)) {
    issues.push("结果里没有包含 <body> 标签。");
  }
  if (
    /(cannot read properties|referenceerror|syntaxerror|unexpected token|typeerror)/i.test(
      trimmed
    )
  ) {
    hardFailures.push("结果里疑似包含运行时错误或语法错误。");
  }

  if (options?.selectedElementHtml?.trim() && options.previousCode?.trim()) {
    const targeting = evaluateTargetedEdit({
      previousCode: options.previousCode,
      nextCode: split.renderableCode || trimmed,
      selectedElementHtml: options.selectedElementHtml,
      designUpdateIntent: options.designUpdateIntent,
      userInstruction: options.userInstruction || "",
    });

    if (!targeting) {
      issues.push("无法高置信度匹配到目标元素。");
    } else {
      if (!targeting.changedInsideTarget) {
        hardFailures.push("目标区域看起来并没有发生变化。");
      }
      if (targeting.collateralDamage) {
        hardFailures.push("这次更新误伤了过多非目标区域。");
      }
      if (!targeting.intentMatched) {
        issues.push("目标区域的变化只部分符合你的修改意图。");
      }
    }
  }

  const allIssues = [...hardFailures, ...issues];
  if (allIssues.length === 0) {
    return {
      status: "pass",
      summary: "预览自检通过。",
      issues: [],
      isRenderable: true,
      localCheckOnly,
      escalatedPreviewCheck,
    };
  }

  return {
    status: hardFailures.length > 0 || !renderable ? "fail" : "warn",
    summary:
      hardFailures.length > 0 || !renderable
        ? "预览自检失败，这份草稿暂时不能直接信任。"
        : renderable
      ? "预览虽然可以渲染，但这份草稿还需要人工关注。"
      : "预览自检失败，这份草稿暂时不能直接信任。",
    issues: allIssues,
    isRenderable: renderable,
    localCheckOnly,
    escalatedPreviewCheck,
  };
}

// 给 DOM 节点生成稳定路径，便于前后版本做轻量结构 diff。
function buildElementPath(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;
  while (current && current.tagName.toLowerCase() !== "html") {
    const parent: Element | null = current.parentElement;
    const tag = current.tagName.toLowerCase();
    const siblings = parent
      ? Array.from(parent.children).filter(
          (child): child is Element => child instanceof Element
        ).filter(
          (child) => child.tagName.toLowerCase() === tag
        )
      : [current];
    const position = siblings.indexOf(current) + 1;
    segments.unshift(`${tag}:${position}`);
    current = parent;
  }
  return segments.join(">");
}

// 把文档压成“路径 -> 摘要”的快照结构，方便比较改动范围。
function buildElementSnapshot(doc: Document): Map<
  string,
  { summary: string; text: string; classes: string }
> {
  const elements = Array.from(doc.body?.querySelectorAll("*") || []);
  return new Map(
    elements.map((el) => {
      const path = buildElementPath(el);
      const summary = elementSummary(el);
      const text = normalizeText(el.textContent || "").slice(0, 120);
      const classes = (el.getAttribute("class") || "").trim();
      return [path, { summary, text, classes }];
    })
  );
}

// 生成一份前后版本的变更摘要，让 UI 能直接展示“这次改了哪”。
export function buildChangeReport(params: {
  previousCode?: string;
  nextCode: string;
}): AgentChangeReport | null {
  const previousRenderable = params.previousCode
    ? splitRenderableOutput(params.previousCode).renderableCode
    : "";
  const nextRenderable = splitRenderableOutput(params.nextCode).renderableCode;
  if (!nextRenderable.trim()) return null;

  const previousDoc = parseHtmlDocument(previousRenderable);
  const nextDoc = parseHtmlDocument(nextRenderable);
  if (!nextDoc) {
    const beforeText = normalizeText(previousRenderable);
    const afterText = normalizeText(nextRenderable);
    if (!afterText) return null;
    const changed = beforeText !== afterText;
    return {
      addedNodes: changed && beforeText.length < afterText.length ? 1 : 0,
      removedNodes: changed && beforeText.length > afterText.length ? 1 : 0,
      changedNodes: changed ? 1 : 0,
      totalNodesBefore: beforeText ? 1 : 0,
      totalNodesAfter: 1,
      impact: changed ? "medium" : "low",
      changedRegions: [afterText.slice(0, 120)],
      summary: changed
        ? "可渲染结果发生了变化，但 DOM diff 已降级成文本比较。"
        : "没有检测到明显的结构变化。",
    };
  }

  if (!previousDoc) {
    const totalNodesAfter = nextDoc.body?.querySelectorAll("*").length || 0;
    return {
      addedNodes: totalNodesAfter,
      removedNodes: 0,
      changedNodes: totalNodesAfter,
      totalNodesBefore: 0,
      totalNodesAfter,
      impact: "high",
      changedRegions: Array.from(nextDoc.body?.querySelectorAll("*") || [])
        .slice(0, 5)
        .map((el) => elementSummary(el))
        .filter(Boolean),
      summary: `首次渲染创建了 ${totalNodesAfter} 个节点。`,
    };
  }

  const beforeMap = buildElementSnapshot(previousDoc);
  const afterMap = buildElementSnapshot(nextDoc);
  const addedPaths = [...afterMap.keys()].filter((path) => !beforeMap.has(path));
  const removedPaths = [...beforeMap.keys()].filter((path) => !afterMap.has(path));
  const changedPaths = [...afterMap.keys()].filter((path) => {
    const before = beforeMap.get(path);
    const after = afterMap.get(path);
    return (
      before &&
      after &&
      (before.summary !== after.summary ||
        before.text !== after.text ||
        before.classes !== after.classes)
    );
  });
  const totalChanges = addedPaths.length + removedPaths.length + changedPaths.length;
  const baseline = Math.max(beforeMap.size, afterMap.size, 1);
  const ratio = totalChanges / baseline;
  const impact = ratio >= 0.4 ? "high" : ratio >= 0.18 ? "medium" : "low";
  const changedRegions = [
    ...changedPaths.map((path) => afterMap.get(path)?.summary || beforeMap.get(path)?.summary || ""),
    ...addedPaths.map((path) => afterMap.get(path)?.summary || ""),
    ...removedPaths.map((path) => beforeMap.get(path)?.summary || ""),
  ]
    .filter(Boolean)
    .slice(0, 6);

  return {
    addedNodes: addedPaths.length,
    removedNodes: removedPaths.length,
    changedNodes: changedPaths.length,
    totalNodesBefore: beforeMap.size,
    totalNodesAfter: afterMap.size,
    impact,
    changedRegions,
    summary:
      totalChanges === 0
        ? "没有检测到明显的结构变化。"
        : `变更 ${changedPaths.length} 条路径，新增 ${addedPaths.length} 条，删除 ${removedPaths.length} 条。`,
  };
}

// 把原始报错文本压缩成稳定分类，便于统计失败分布。
export function classifyGenerationFailure(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("timeout") || lower.includes("readtimeout")) {
    return "timeout";
  }
  if (lower.includes("image")) {
    return "image_generation";
  }
  if (lower.includes("model") || lower.includes("unsupported")) {
    return "model_selection";
  }
  if (lower.includes("preview") || lower.includes("html")) {
    return "preview";
  }
  if (lower.includes("workspace")) {
    return "workspace";
  }
  return "generation";
}

// 统一文本归一化规则，减少比较时被空白和大小写干扰。
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

// 从文本里提取少量关键词，用于低成本相似度和命中判断。
function extractTextTokens(value: string, limit = 6): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean)
    .slice(0, limit);
}

// 尽量把字符串解析成 HTML 文档，失败时返回 null 走降级逻辑。
function parseHtmlDocument(code: string): Document | null {
  if (!code.trim()) return null;
  try {
    const html = stripCodeFences(code);
    if (typeof DOMParser !== "undefined") {
      return new DOMParser().parseFromString(html, "text/html");
    }
    if (typeof document !== "undefined" && document.implementation) {
      const nextDocument = document.implementation.createHTMLDocument("");
      nextDocument.documentElement.innerHTML = html;
      return nextDocument;
    }
    return null;
  } catch {
    return null;
  }
}

// 把元素压成短摘要，方便日志和变更面板展示。
function elementSummary(el: Element | null): string {
  if (!el) return "";
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  const classes = (el.getAttribute("class") || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(".");
  const text = normalizeText(el.textContent || "").slice(0, 80);
  return [tag, id ? `#${id}` : "", classes ? `.${classes}` : "", text]
    .filter(Boolean)
    .join(" ");
}

function findBestMatchingElement(doc: Document, selectedElementHtml: string): Element | null {
  const wrapper = doc.createElement("div");
  wrapper.innerHTML = selectedElementHtml.trim();
  const target = wrapper.firstElementChild;
  if (!target) return null;

  const tagName = target.tagName.toLowerCase();
  const targetClasses = new Set(
    (target.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
  );
  const targetTokens = extractTextTokens(target.textContent || "", 8);
  const id = target.getAttribute("id");
  if (id) {
    const exact = doc.getElementById(id);
    if (exact) return exact;
  }

  const candidates = Array.from(doc.getElementsByTagName(tagName));
  let best: { score: number; element: Element | null } = {
    score: -1,
    element: null,
  };

  for (const candidate of candidates) {
    let score = 0;
    const candidateClasses = new Set(
      (candidate.getAttribute("class") || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5)
    );
    targetClasses.forEach((className) => {
      if (candidateClasses.has(className)) score += 2;
    });
    const candidateTokens = extractTextTokens(candidate.textContent || "", 8);
    targetTokens.forEach((token) => {
      if (candidateTokens.includes(token)) score += 3;
    });
    if ((candidate.textContent || "").trim() === (target.textContent || "").trim()) {
      score += 4;
    }
    if (candidate.outerHTML === target.outerHTML) {
      score += 10;
    }
    if (score > best.score) {
      best = { score, element: candidate };
    }
  }

  return best.element;
}

function looksCentered(el: Element | null): boolean {
  if (!el) return false;
  const text = [
    el.getAttribute("class") || "",
    el.getAttribute("style") || "",
    el.outerHTML,
  ]
    .join(" ")
    .toLowerCase();
  return (
    text.includes("justify-center") ||
    text.includes("items-center") ||
    text.includes("text-center") ||
    text.includes("mx-auto") ||
    text.includes("margin: 0 auto") ||
    text.includes("align-items:center") ||
    text.includes("justify-content:center")
  );
}

function outsideSummary(doc: Document, target: Element | null): string {
  const bodyText = normalizeText(doc.body?.innerText || doc.body?.textContent || "");
  if (!target) return bodyText;
  const targetText = normalizeText(target.textContent || "");
  if (!targetText) return bodyText;
  return bodyText.replace(targetText, "").trim();
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const aTokens = extractTextTokens(a, 80);
  const bTokens = extractTextTokens(b, 80);
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const intersection = [...aSet].filter((token) => bSet.has(token)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 1 : intersection / union;
}

export function evaluateTargetedEdit(params: {
  previousCode: string;
  nextCode: string;
  selectedElementHtml?: string;
  designUpdateIntent?: DesignUpdateIntent;
  userInstruction?: string;
}): AgentTargetingDiagnostics | undefined {
  if (!params.selectedElementHtml?.trim()) {
    return undefined;
  }

  const previousDoc = parseHtmlDocument(params.previousCode);
  const nextDoc = parseHtmlDocument(params.nextCode);
  if (!previousDoc || !nextDoc) {
    const normalizedPrevious = normalizeText(params.previousCode);
    const normalizedNext = normalizeText(params.nextCode);
    const normalizedTarget = normalizeText(params.selectedElementHtml);
    const changedInsideTarget = normalizedPrevious !== normalizedNext;
    const preservedOutsideTarget = similarity(normalizedPrevious, normalizedNext) >= 0.65;
    const intentText = normalizeText(
      [
        params.designUpdateIntent?.intent || "",
        params.designUpdateIntent?.alignment || "",
        params.userInstruction || "",
      ].join(" ")
    );
    const intentMatched =
      changedInsideTarget &&
      (!intentText.includes("center")
        ? true
        : /justify-center|text-center|mx-auto|margin:\s*0 auto/.test(
            normalizedNext
          ));
    return {
      score: Number(
        (
          (changedInsideTarget ? 0.5 : 0) +
          (preservedOutsideTarget ? 0.2 : 0) +
          (intentMatched ? 0.2 : 0) +
          0.1
        ).toFixed(2)
      ),
      changedInsideTarget,
      preservedOutsideTarget,
      intentMatched,
      collateralDamage: !preservedOutsideTarget,
      targetSummary: normalizedTarget.slice(0, 80),
      preserveViolations: preservedOutsideTarget ? [] : params.designUpdateIntent?.preserve,
      changedSignals: changedInsideTarget
        ? ["HTML 已变化，同时仍保持在目标区域范围内。"]
        : [],
    };
  }

  const previousTarget = findBestMatchingElement(previousDoc, params.selectedElementHtml);
  const nextTarget = findBestMatchingElement(nextDoc, params.selectedElementHtml);
  const previousSummary = elementSummary(previousTarget);
  const nextSummary = elementSummary(nextTarget);
  const changedInsideTarget = previousSummary !== nextSummary;
  const outsideBefore = outsideSummary(previousDoc, previousTarget);
  const outsideAfter = outsideSummary(nextDoc, nextTarget);
  const outsideSimilarity = similarity(outsideBefore, outsideAfter);
  const preservedOutsideTarget = outsideSimilarity >= 0.82;

  const preserveViolations =
    params.designUpdateIntent?.preserve
      ?.filter((rule) => /不变|preserve|keep|leave|保持/i.test(rule))
      .filter(() => !preservedOutsideTarget) ?? [];

  const normalizedIntent = normalizeText(
    [
      params.designUpdateIntent?.intent || "",
      params.designUpdateIntent?.alignment || "",
      params.userInstruction || "",
    ].join(" ")
  );

  let intentMatched = changedInsideTarget;
  const changedSignals: string[] = [];
  if (changedInsideTarget) {
    changedSignals.push(`目标区域已从「${previousSummary}」变为「${nextSummary}」。`);
  }
  if (normalizedIntent.includes("center") || normalizedIntent.includes("居中")) {
    intentMatched = looksCentered(nextTarget);
    if (intentMatched) {
      changedSignals.push("更新后的目标区域里找到了居中对齐信号。");
    }
  } else if (
    normalizedIntent.includes("image") ||
    normalizedIntent.includes("图片") ||
    normalizedIntent.includes("hero")
  ) {
    const previousImage = previousTarget?.querySelector("img")?.getAttribute("src") || "";
    const nextImage = nextTarget?.querySelector("img")?.getAttribute("src") || "";
    intentMatched = Boolean(nextImage) && previousImage !== nextImage;
    if (intentMatched) {
      changedSignals.push("目标图片源已变化，同时目标容器本身保持稳定。");
    }
  }

  const collateralDamage = !preservedOutsideTarget;
  const scoreParts = [
    changedInsideTarget ? 0.4 : 0,
    preservedOutsideTarget ? 0.3 : 0,
    intentMatched ? 0.2 : 0,
    collateralDamage ? 0 : 0.1,
  ];

  return {
    score: Number(scoreParts.reduce((sum, part) => sum + part, 0).toFixed(2)),
    changedInsideTarget,
    preservedOutsideTarget,
    intentMatched,
    collateralDamage,
    targetSummary: nextSummary || previousSummary,
    preserveViolations,
    changedSignals,
  };
}

export function summarizeImageUpdateStatus(
  events: Array<{ toolName?: string; output?: unknown }>
): AgentImageUpdateStatus | null {
  const imageEvent = [...events]
    .reverse()
    .find((event) => event.toolName === "edit_image" || event.toolName === "generate_images");
  if (!imageEvent?.toolName) return null;

  if (imageEvent.toolName === "edit_image") {
    const output = imageEvent.output as
      | {
          image?: {
            status?: string;
            imageOperation?: "create" | "edit" | "fallback";
            persistedAssetUrl?: string | null;
            assetLineage?: {
              assetId?: string | null;
              parentAssetId?: string | null;
              sourceImageUrl?: string | null;
            };
            error?: string;
          };
        }
      | undefined;
    const image = output?.image;
    if (!image) return null;
    return {
      operation: image.imageOperation || "edit",
      status: image.status === "ok" ? "ok" : "error",
      persistedAssetUrl: image.persistedAssetUrl || null,
      sourceImageUrl: image.assetLineage?.sourceImageUrl || null,
      assetId: image.assetLineage?.assetId || null,
      parentAssetId: image.assetLineage?.parentAssetId || null,
      message: image.error,
    };
  }

  const output = imageEvent.output as
    | {
        images?: Array<{
          status?: string;
          persistedAssetUrl?: string | null;
          assetId?: string | null;
        }>;
      }
    | undefined;
  const firstOk = output?.images?.find((item) => item.status === "ok");
  if (!firstOk) return null;
  return {
    operation: "create",
    status: "ok",
    persistedAssetUrl: firstOk.persistedAssetUrl || null,
    assetId: firstOk.assetId || null,
  };
}
