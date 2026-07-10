import {
  AgentCandidateMemoryEntry,
  AgentFailureMemoryEntry,
  AgentLongMemoryEntry,
  AgentMemory,
  AgentMemoryConflict,
  AgentShortMemoryEntry,
  DesignSession,
  PreviewSelfCheckResult,
  TurnIntent,
} from "../types";

const MAX_SHORT_MEMORY = 6;
const MAX_LONG_MEMORY = 24;
const MAX_FAILURE_MEMORY = 8;
const MAX_CANDIDATE_MEMORY = 10;

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createEmptyAgentMemory(): AgentMemory {
  return {
    shortTerm: [],
    longTerm: [],
    artifact: {
      summary: "",
      sections: [],
      activeAssets: [],
    },
    failures: [],
    candidates: [],
    conflicts: [],
  };
}

export function normalizeAgentMemory(memory?: AgentMemory | null): AgentMemory {
  const empty = createEmptyAgentMemory();
  if (!memory || typeof memory !== "object") return empty;
  return {
    shortTerm: Array.isArray(memory.shortTerm) ? memory.shortTerm : [],
    longTerm: Array.isArray(memory.longTerm) ? memory.longTerm : [],
    artifact:
      memory.artifact && typeof memory.artifact === "object"
        ? {
            summary:
              typeof memory.artifact.summary === "string"
                ? memory.artifact.summary
                : "",
            sections: Array.isArray(memory.artifact.sections)
              ? memory.artifact.sections.filter(
                  (section): section is string => typeof section === "string"
                )
              : [],
            activeAssets: Array.isArray(memory.artifact.activeAssets)
              ? memory.artifact.activeAssets.filter(
                  (asset): asset is string => typeof asset === "string"
                )
              : [],
            lastUpdatedAt:
              typeof memory.artifact.lastUpdatedAt === "string"
                ? memory.artifact.lastUpdatedAt
                : undefined,
          }
        : empty.artifact,
    failures: Array.isArray(memory.failures) ? memory.failures : [],
    candidates: Array.isArray(memory.candidates) ? memory.candidates : [],
    conflicts: Array.isArray(memory.conflicts) ? memory.conflicts : [],
  };
}

function dedupeByText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = item.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。.!！？\n]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function inferLongMemoryType(text: string): AgentLongMemoryEntry["type"] {
  if (/(不是|而是|语义|场景|含义|评价|评论)/i.test(text)) {
    return "product_semantics";
  }
  if (/(不可能|不能|不要|必须|应该|规则|rule)/i.test(text)) {
    return "business_rule";
  }
  if (/(偏好|喜欢|希望|默认|中文|风格|preference)/i.test(text)) {
    return "user_preference";
  }
  return "design_constraint";
}

function extractConfirmedLongMemories(text: string): AgentLongMemoryEntry[] {
  const now = new Date().toISOString();
  return splitSentences(text)
    .filter((sentence) =>
      /(不是.*而是|不是.*是|不可能|不能|不要|必须|应该|记住|默认|偏好|希望.*中文|规则)/i.test(
        sentence
      )
    )
    .map((sentence) => ({
      id: createId("long"),
      type: inferLongMemoryType(sentence),
      text: sentence,
      confidence: /(不是.*而是|不是.*是|不可能|不能|必须|记住)/i.test(sentence)
        ? 0.95
        : 0.84,
      source: /(不是.*而是|不是.*是)/i.test(sentence)
        ? "user_correction"
        : "user_instruction",
      status: "active",
      appliesTo: inferAppliesTo(sentence),
      createdAt: now,
      lastConfirmedAt: now,
    }));
}

function inferAppliesTo(text: string): string[] {
  const scopes: string[] = [];
  if (/(特殊分享|分享)/i.test(text)) scopes.push("special_share_scene");
  if (/(评论|精选评论|点赞)/i.test(text)) scopes.push("comment_section");
  if (/(中文|英文|展示数据)/i.test(text)) scopes.push("localized_ui_copy");
  return scopes.length > 0 ? scopes : ["current_workspace"];
}

function buildShortMemoryText(params: {
  userText: string;
  generationType: "create" | "update";
  turnIntent?: TurnIntent;
  reviewSummary?: string;
}): string {
  const action = params.generationType === "create" ? "创建" : "更新";
  const intent = params.turnIntent ? `intent=${params.turnIntent}; ` : "";
  const review = params.reviewSummary ? `; review=${params.reviewSummary}` : "";
  return `${action}请求: ${intent}${params.userText.trim() || "(空请求)"}${review}`;
}

function summarizeArtifact(code: string): AgentMemory["artifact"] {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      summary: "",
      sections: [],
      activeAssets: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  const title =
    trimmed.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ||
    trimmed.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ||
    "当前页面";
  const sections = Array.from(
    trimmed.matchAll(/<(section|header|main|footer|nav)\b[^>]*>/gi)
  )
    .map((match) => match[1].toLowerCase())
    .slice(0, 12);
  const buttons = Array.from(trimmed.matchAll(/<button\b/gi)).length;
  const images = Array.from(trimmed.matchAll(/<(img|image)\b/gi)).length;
  const activeAssets = Array.from(
    trimmed.matchAll(/(?:src|href)=["']([^"']+)["']/gi)
  )
    .map((match) => match[1])
    .filter((value) => /^(data:image|blob:|https?:|\/)/i.test(value))
    .slice(0, 12);

  return {
    summary: `${title}; sections=${sections.length}; buttons=${buttons}; images=${images}`,
    sections,
    activeAssets,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function detectMemoryConflicts(
  memory: AgentMemory,
  userText: string
): AgentMemoryConflict[] {
  const text = userText.trim();
  if (!text) return [];

  const conflicts: AgentMemoryConflict[] = [];
  for (const entry of memory.longTerm.filter((item) => item.status === "active")) {
    const rule = entry.text;
    const shareConflict =
      /(不展示分享按钮|不要.*分享按钮|不可能.*分享按钮)/i.test(rule) &&
      /(加|添加|展示|显示|放).*分享按钮/i.test(text);
    const commentConflict =
      /(评论.*分享.*人|评论.*玩得|不是.*卡顿|不是.*游戏卡顿)/i.test(rule) &&
      /(卡顿|性能|延迟|流畅)/i.test(text) &&
      /(评论|精选评论)/i.test(text);

    if (shareConflict || commentConflict) {
      conflicts.push({
        id: createId("conflict"),
        longMemoryId: entry.id,
        text: `本轮请求可能和长期记忆冲突: "${entry.text}" vs "${text}"`,
        severity: "high",
        createdAt: new Date().toISOString(),
      });
    }
  }
  return conflicts.slice(0, 5);
}

export function prepareMemoryForRequest(
  session: DesignSession,
  userText: string
): AgentMemory {
  const memory = normalizeAgentMemory(session.memory);
  return {
    ...memory,
    conflicts: detectMemoryConflicts(memory, userText),
  };
}

export function consolidateAgentMemory(params: {
  previousMemory?: AgentMemory;
  userText: string;
  generationType: "create" | "update";
  turnIntent?: TurnIntent;
  code?: string;
  reviewSummary?: string;
  selfCheck?: PreviewSelfCheckResult;
}): AgentMemory {
  const previous = normalizeAgentMemory(params.previousMemory);
  const now = new Date().toISOString();
  const newShortTerm: AgentShortMemoryEntry = {
    id: createId("short"),
    text: buildShortMemoryText(params),
    source: "user_instruction",
    createdAt: now,
    expiresAfterTurns: MAX_SHORT_MEMORY,
  };

  const longTerm = dedupeByText([
    ...extractConfirmedLongMemories(params.userText),
    ...previous.longTerm,
  ]).slice(0, MAX_LONG_MEMORY);

  const candidates: AgentCandidateMemoryEntry[] = dedupeByText([
    ...previous.candidates,
  ]).slice(-MAX_CANDIDATE_MEMORY);

  const failures: AgentFailureMemoryEntry[] = dedupeByText([
    ...(params.selfCheck?.status === "fail"
      ? [
          {
            id: createId("failure"),
            text: params.selfCheck.summary,
            source: "tool_result" as const,
            createdAt: now,
            status: "active" as const,
          },
        ]
      : []),
    ...previous.failures,
  ]).slice(0, MAX_FAILURE_MEMORY);

  const artifact = params.code?.trim()
    ? summarizeArtifact(params.code)
    : previous.artifact;

  return {
    shortTerm: dedupeByText([newShortTerm, ...previous.shortTerm]).slice(
      0,
      MAX_SHORT_MEMORY
    ),
    longTerm,
    artifact,
    failures,
    candidates,
    conflicts: detectMemoryConflicts(previous, params.userText),
  };
}
