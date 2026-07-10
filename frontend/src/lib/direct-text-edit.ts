export interface DirectTextEditResult {
  code: string;
  oldText: string;
  newText: string;
  strategy: "selected-source" | "unique-text";
}

interface TextReplacement {
  oldText: string;
  newText: string;
}

const REPLACEMENT_VERBS = "改成|改为|修改为|替换为|换成";
const QUOTE_CHARS = `[“”‘’"']`;

function trimReplacementValue(value: string): string {
  return value
    .trim()
    .replace(new RegExp(`^${QUOTE_CHARS}|${QUOTE_CHARS}[。！!？?]?$`, "g"), "")
    .replace(/[。！!]$/, "")
    .trim();
}

export function parseExplicitTextReplacement(
  instruction: string,
  selectedText: string
): TextReplacement | null {
  const normalizedInstruction = instruction.replace(/\s+/g, " ").trim();
  const normalizedSelectedText = selectedText.replace(/\s+/g, " ").trim();
  if (!normalizedInstruction || !normalizedSelectedText) return null;

  const oldAndNewMatch = normalizedInstruction.match(
    new RegExp(
      `^(?:把|将)${QUOTE_CHARS}?(.+?)${QUOTE_CHARS}?(?:${REPLACEMENT_VERBS})[:：]?${QUOTE_CHARS}?(.+?)${QUOTE_CHARS}?[。！!]?$`
    )
  );
  if (oldAndNewMatch) {
    const oldText = trimReplacementValue(oldAndNewMatch[1]);
    const newText = trimReplacementValue(oldAndNewMatch[2]);
    if (
      oldText &&
      newText &&
      oldText.length <= 120 &&
      newText.length <= 500 &&
      normalizedSelectedText.includes(oldText)
    ) {
      return { oldText, newText };
    }
  }

  const selectedTextMatch = normalizedInstruction.match(
    new RegExp(
      `^(?:${REPLACEMENT_VERBS})[:：]?${QUOTE_CHARS}?(.+?)${QUOTE_CHARS}?[。！!]?$`
    )
  );
  if (!selectedTextMatch || normalizedSelectedText.length > 500) return null;
  const newText = trimReplacementValue(selectedTextMatch[1]);
  if (!newText) return null;
  return { oldText: normalizedSelectedText, newText };
}

function countOccurrences(source: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= source.length) {
    const index = source.indexOf(search, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + search.length;
  }
  return count;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function applySafeDirectTextEdit({
  code,
  instruction,
  selectedText,
  selectedOuterHTML,
}: {
  code: string;
  instruction: string;
  selectedText: string;
  selectedOuterHTML: string;
}): DirectTextEditResult | null {
  const replacement = parseExplicitTextReplacement(instruction, selectedText);
  if (!replacement) return null;

  const escapedNewText = escapeHtmlText(replacement.newText);
  if (
    selectedOuterHTML &&
    countOccurrences(code, selectedOuterHTML) === 1 &&
    countOccurrences(selectedOuterHTML, replacement.oldText) === 1
  ) {
    const updatedScope = selectedOuterHTML.replace(
      replacement.oldText,
      escapedNewText
    );
    return {
      code: code.replace(selectedOuterHTML, updatedScope),
      ...replacement,
      strategy: "selected-source",
    };
  }

  if (
    selectedText.includes(replacement.oldText) &&
    countOccurrences(code, replacement.oldText) === 1
  ) {
    return {
      code: code.replace(replacement.oldText, escapedNewText),
      ...replacement,
      strategy: "unique-text",
    };
  }

  return null;
}
