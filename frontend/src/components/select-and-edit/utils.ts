// Cap the element HTML included in the prompt. The model already receives the
// full current code, so the snippet only needs to identify the element.
const MAX_ELEMENT_HTML_LENGTH = 12000;

const MAX_PATH_DEPTH = 6;
const INLINE_DECORATIVE_TAGS = new Set([
  "b",
  "em",
  "i",
  "path",
  "small",
  "span",
  "strong",
  "svg",
]);
const INLINE_TEXT_TAGS = new Set([
  "b",
  "em",
  "p",
  "small",
  "span",
  "strong",
]);
const CONTAINER_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figure",
  "footer",
  "form",
  "header",
  "li",
  "main",
  "nav",
  "section",
  "ul",
]);
const MEDIA_TAGS = new Set(["canvas", "img", "picture", "svg", "video"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_BOUNDARY_TAGS = new Set([
  ...HEADING_TAGS,
  "a",
  "button",
  "label",
  "li",
  "p",
  "td",
  "th",
]);

export interface EditableElementDescription {
  kind: string;
  preview: string;
  accessibleLabel: string;
}

function getTagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function getChildren(el: Element): Element[] {
  return Array.from(el.children ?? []);
}

function getRole(el: Element): string {
  return (el.getAttribute("role") || "").toLowerCase();
}

function isInteractive(el: Element): boolean {
  const tag = getTagName(el);
  return (
    tag === "a" ||
    tag === "button" ||
    tag === "input" ||
    tag === "label" ||
    tag === "option" ||
    tag === "select" ||
    tag === "summary" ||
    tag === "textarea" ||
    ["button", "link", "menuitem", "option", "switch", "tab"].includes(
      getRole(el)
    )
  );
}

function countDirectInteractiveChildren(el: Element): number {
  return getChildren(el).filter(isInteractive).length;
}

function isContentBearingChild(el: Element): boolean {
  const tag = getTagName(el);
  if (isInteractive(el) || MEDIA_TAGS.has(tag) || HEADING_TAGS.has(tag)) {
    return true;
  }
  if (CONTAINER_TAGS.has(tag)) {
    return true;
  }
  if (INLINE_TEXT_TAGS.has(tag)) {
    const text = el.textContent?.trim() || "";
    return text.length > 0;
  }
  return false;
}

function looksLikeEditableContainer(el: Element): boolean {
  const tag = getTagName(el);
  if (!CONTAINER_TAGS.has(tag)) {
    return false;
  }

  if (countDirectInteractiveChildren(el) >= 2) {
    return true;
  }

  const meaningfulChildren = getChildren(el).filter(isContentBearingChild);
  return meaningfulChildren.length >= 2;
}

function promoteInlineOrDecorativeTarget(el: HTMLElement): HTMLElement {
  let current: HTMLElement = el;

  while (
    current.parentElement &&
    (INLINE_DECORATIVE_TAGS.has(getTagName(current)) ||
      INLINE_TEXT_TAGS.has(getTagName(current)))
  ) {
    const parent = current.parentElement;
    if (isInteractive(parent)) {
      return parent as HTMLElement;
    }
    current = parent as HTMLElement;
  }

  return current;
}

function promoteToEditableContainer(el: HTMLElement): HTMLElement {
  let current: HTMLElement | null = el;
  let depth = 0;

  while (current?.parentElement && depth < 4) {
    const parent = current.parentElement as HTMLElement;
    if (looksLikeEditableContainer(parent)) {
      return parent;
    }
    current = parent;
    depth += 1;
  }

  return el;
}

export function resolveEditableTarget(el: HTMLElement): HTMLElement {
  let textBoundary: HTMLElement | null = el;
  while (textBoundary && !TEXT_BOUNDARY_TAGS.has(getTagName(textBoundary))) {
    textBoundary = textBoundary.parentElement;
  }
  if (textBoundary) {
    if (isInteractive(textBoundary)) {
      const parent = textBoundary.parentElement;
      if (parent && countDirectInteractiveChildren(parent) >= 2) {
        return parent as HTMLElement;
      }
    }
    return textBoundary;
  }

  let candidate = promoteInlineOrDecorativeTarget(el);

  if (MEDIA_TAGS.has(getTagName(candidate))) {
    const interactiveParent = candidate.parentElement;
    if (interactiveParent && isInteractive(interactiveParent)) {
      candidate = interactiveParent as HTMLElement;
    } else {
      return candidate;
    }
  }

  if (isInteractive(candidate)) {
    const parent = candidate.parentElement;
    if (parent && countDirectInteractiveChildren(parent) >= 2) {
      return parent as HTMLElement;
    }
    return candidate;
  }

  if (
    INLINE_TEXT_TAGS.has(getTagName(candidate)) ||
    INLINE_DECORATIVE_TAGS.has(getTagName(candidate))
  ) {
    return promoteToEditableContainer(candidate);
  }

  if (looksLikeEditableContainer(candidate)) {
    return candidate;
  }

  return candidate;
}

export function getParentEditableTarget(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const tag = getTagName(current);
    if (tag === "body" || tag === "html") return null;
    if (CONTAINER_TAGS.has(tag) || TEXT_BOUNDARY_TAGS.has(tag)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxLength = 42): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function describeEditableElement(
  el: HTMLElement
): EditableElementDescription {
  const tag = getTagName(el);
  const rawText = normalizeVisibleText(el.textContent || "");
  const fallbackText = normalizeVisibleText(
    el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      ""
  );
  const preview = clipText(rawText || fallbackText || "无可见文字");

  let kind = "内容";
  if (HEADING_TAGS.has(tag)) kind = "标题";
  else if (tag === "p") kind = "段落";
  else if (tag === "li") kind = "列表项";
  else if (tag === "td" || tag === "th") kind = "表格内容";
  else if (tag === "button") kind = "按钮";
  else if (tag === "a") kind = "链接";
  else if (tag === "img" || tag === "picture") kind = "图片";
  else if (CONTAINER_TAGS.has(tag)) kind = "区域";

  if (
    rawText &&
    rawText.length <= 24 &&
    /^[\s￥$€£¥+\-.,，%％\d万千百亿]+$/.test(rawText)
  ) {
    kind = "数据";
  }

  return {
    kind,
    preview,
    accessibleLabel:
      preview === "无可见文字" ? `已选择${kind}` : `已选择${kind}：${preview}`,
  };
}

function describeNode(el: Element): string {
  const tag = getTagName(el);
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean).slice(0, 3);
  return tag + classes.map((c) => `.${c}`).join("");
}

// The outerHTML alone can't identify the element when siblings share identical
// markup (e.g. three "Choose plan" buttons styled by a parent class), so also
// describe where it sits in the DOM.
export function describeElementContext(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < MAX_PATH_DEPTH) {
    if (current.tagName.toLowerCase() === "html") break;
    parts.unshift(describeNode(current));
    current = current.parentElement;
  }
  const lines = [`Element location: ${parts.join(" > ")}`];
  const directInteractiveChildren = countDirectInteractiveChildren(el);
  if (directInteractiveChildren >= 2) {
    lines.push(
      `Edit scope: this selected container owns ${directInteractiveChildren} direct interactive children. Treat them as a coordinated control group and keep surrounding sections unchanged.`
    );
  }

  const identical = Array.from(
    el.ownerDocument.getElementsByTagName(el.tagName)
  ).filter((other) => other.outerHTML === el.outerHTML);
  if (identical.length > 1) {
    const position = identical.indexOf(el) + 1;
    lines.push(
      `${identical.length} elements on the page share this exact markup; the user selected number ${position} of ${identical.length} in document order. Edit only that one and leave the other copies exactly as they are. Because the markup repeats, do not locate the element by its own markup alone — anchor the edit with unique surrounding context (its parent element or a distinguishing ancestor class from the location path above), or scope a style change through that ancestor. Any search/replace whose search text matches more than one place will hit the wrong copy.`
    );
  }
  return lines.join("\n");
}

export function buildSelectedElementInstruction(
  instruction: string,
  elementHtml: string,
  elementContext?: string
): string {
  const truncated =
    elementHtml.length > MAX_ELEMENT_HTML_LENGTH
      ? elementHtml.slice(0, MAX_ELEMENT_HTML_LENGTH) +
        "\n<!-- truncated; locate the element in the current code -->"
      : elementHtml;

  return `${instruction}

Apply the change to this specific element that the user selected in the preview:

\`\`\`html
${truncated}
\`\`\`
${elementContext ? `\n${elementContext}\n` : ""}
This snippet is the element's outerHTML captured from the rendered page, so it can differ from the source code (for example JSX uses className, Vue templates use directives and interpolations, and frameworks like Ionic or Bootstrap may inject classes or attributes at runtime). Find the code that produces this element and apply the change there, leaving unrelated code untouched.

This snippet is the edit boundary. Prefer editing this element or its descendants only. Do not move or rewrite siblings, ancestor layout, or unrelated sections unless the user explicitly asks for a broader redesign.

Before you finish, self-check:
- The requested change is clearly visible inside this selected scope.
- The change is aligned relative to this scope, not just one child inside it.
- Content outside this selected scope remains visually unchanged.`;
}
