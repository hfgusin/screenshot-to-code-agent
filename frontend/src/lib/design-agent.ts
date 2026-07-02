import {
  AgentImageUpdateStatus,
  AgentTargetingDiagnostics,
  DesignUpdateIntent,
  IntentDecision,
  PreviewSelfCheckResult,
  TurnIntent,
} from "../types";

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
  let reason = "Default router fallback.";
  let shouldAskQuestion = false;

  if (!text && params.generationType === "update") {
    intent = "modify";
    confidence = 0.82;
    reason = "Empty update text with an existing draft usually means a localized edit.";
  } else if (
    !hasExistingDraft &&
    params.generationType === "update" &&
    hasAnyMatch(text, QUESTION_KEYWORDS)
  ) {
    intent = "question";
    confidence = 0.88;
    reason = "The request looks like a clarification without an active draft.";
    shouldAskQuestion = true;
  } else if (hasAnyMatch(text, REPAIR_KEYWORDS)) {
    intent = "repair";
    confidence = 0.9;
    reason = "Repair keywords were detected.";
  } else if (
    hasSelection &&
    (params.generationType === "update" || hasAnyMatch(text, MODIFY_KEYWORDS))
  ) {
    intent = "modify";
    confidence = 0.92;
    reason = "A selected element strongly indicates a localized update.";
  } else if (hasAnyMatch(text, QUESTION_KEYWORDS) && !hasAnyMatch(text, MODIFY_KEYWORDS)) {
    intent =
      params.generationType === "create" && hasAnyMatch(text, CREATE_KEYWORDS)
        ? "generate"
        : "question";
    confidence = intent === "generate" ? 0.64 : 0.72;
    reason =
      intent === "generate"
        ? "The text contains a question mark but also a clear create intent."
        : "The text looks like a clarification request.";
    shouldAskQuestion = intent === "question";
  } else if (params.generationType === "create") {
    intent = "generate";
    confidence = 0.84;
    reason = "Create mode defaults to a fresh draft.";
  } else if (hasAnyMatch(text, MODIFY_KEYWORDS)) {
    intent = "modify";
    confidence = 0.76;
    reason = "Modification keywords were detected.";
  } else if (hasAnyMatch(text, CREATE_KEYWORDS)) {
    intent = "generate";
    confidence = 0.7;
    reason = "Create keywords were detected.";
  } else {
    intent = params.generationType === "update" ? "modify" : "generate";
    confidence = 0.58;
    reason = "No strong routing signal was found, so the router used the default path.";
    shouldAskQuestion = params.generationType === "update" && !hasSelection && text.length < 24;
  }

  if (params.generationType === "update" && !hasSelection && intent === "modify") {
    confidence = Math.min(confidence, 0.68);
    if (text.length < 16) {
      shouldAskQuestion = true;
      reason = "The update is short and ungrounded, so the router is asking for clarification.";
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
        : ["Preserve the rest of the page outside the targeted container."],
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
  const trimmed = stripCodeFences(code);
  return /<!DOCTYPE\s+html\b/i.test(trimmed) || /<html\b/i.test(trimmed);
}

export function runPreviewSelfCheck(code: string): PreviewSelfCheckResult {
  const trimmed = stripCodeFences(code);
  const issues: string[] = [];

  if (!trimmed) {
    return {
      status: "fail",
      summary: "The agent returned an empty draft.",
      issues: ["No code was produced."],
      isRenderable: false,
    };
  }

  const renderable = isRenderableHtmlDocument(trimmed);
  if (!renderable) {
    issues.push("The result is not a full HTML document.");
  }
  if (/^(here('|’)s|i('|’)ve|updated|summary:|explanation:)/i.test(trimmed)) {
    issues.push("The result looks like assistant prose instead of previewable code.");
  }
  if (!/<body\b/i.test(trimmed)) {
    issues.push("The result does not include a <body> tag.");
  }

  if (issues.length === 0) {
    return {
      status: "pass",
      summary: "Preview self-check passed.",
      issues: [],
      isRenderable: true,
    };
  }

  return {
    status: renderable ? "warn" : "fail",
    summary: renderable
      ? "Preview is renderable, but the draft needs attention."
      : "Preview self-check failed before the draft could be trusted.",
    issues,
    isRenderable: renderable,
  };
}

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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractTextTokens(value: string, limit = 6): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean)
    .slice(0, limit);
}

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
        ? ["HTML changed while keeping the selected target in scope."]
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
    changedSignals.push(`Target changed from "${previousSummary}" to "${nextSummary}".`);
  }
  if (normalizedIntent.includes("center") || normalizedIntent.includes("居中")) {
    intentMatched = looksCentered(nextTarget);
    if (intentMatched) {
      changedSignals.push("Centered alignment markers were found in the updated target.");
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
      changedSignals.push("The target image source changed while the target container remained stable.");
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
