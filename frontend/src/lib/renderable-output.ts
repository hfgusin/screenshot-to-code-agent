export type RenderableDocumentType = "html" | "none";

export interface RenderableOutputSplit {
  renderableCode: string;
  discardedContent: string;
  hasRenderableDocument: boolean;
  primaryDocumentType: RenderableDocumentType;
}

function unwrapFileWrapper(code: string): string {
  const fileMatch = code.match(
    /<file\s+path="[^"]+">\s*([\s\S]*?)\s*<\/file>/i
  );
  if (!fileMatch) return code;
  return unwrapFileWrapper(fileMatch[1].trim());
}

function stripFences(code: string): string {
  return code
    .trim()
    .replace(/^```(?:html|xml)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function findHtmlBounds(code: string): { start: number; end: number } | null {
  const lower = code.toLowerCase();
  const doctypeIndex = lower.indexOf("<!doctype html");
  const htmlIndex = lower.indexOf("<html");
  const start =
    doctypeIndex >= 0 && (htmlIndex < 0 || doctypeIndex < htmlIndex)
      ? doctypeIndex
      : htmlIndex;
  if (start < 0) return null;

  const endIndex = lower.indexOf("</html>", start);
  if (endIndex < 0) return null;

  return { start, end: endIndex + "</html>".length };
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function splitRenderableOutput(code: string): RenderableOutputSplit {
  const unwrapped = stripFences(unwrapFileWrapper(code));
  if (!unwrapped) {
    return {
      renderableCode: "",
      discardedContent: "",
      hasRenderableDocument: false,
      primaryDocumentType: "none",
    };
  }

  const bounds = findHtmlBounds(unwrapped);
  if (!bounds) {
    return {
      renderableCode: "",
      discardedContent: unwrapped,
      hasRenderableDocument: false,
      primaryDocumentType: "none",
    };
  }

  const renderableCode = unwrapped.slice(bounds.start, bounds.end).trim();
  const discardedContent = compactText(
    `${unwrapped.slice(0, bounds.start)} ${unwrapped.slice(bounds.end)}`
  );

  return {
    renderableCode,
    discardedContent,
    hasRenderableDocument: Boolean(renderableCode),
    primaryDocumentType: "html",
  };
}

export function extractRenderableOutput(code: string): string {
  return splitRenderableOutput(code).renderableCode;
}
