import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import useThrottle from "../../hooks/useThrottle";
import { useAppStore } from "../../store/app-store";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import { isRenderableHtmlDocument } from "../../lib/design-agent";
import {
  applySelectModeCursor,
  hideHoverOverlay,
  hideSelectionOverlay,
  removeHoverOverlay,
  removeSelectModeCursor,
  removeSelectionOverlay,
  showHoverOverlay,
  showSelectionOverlay,
} from "../select-and-edit/overlays";
import { resolveEditableTarget } from "../select-and-edit/utils";

interface Props {
  code: string;
  device: "mobile" | "desktop";
  onScaleChange?: (scale: number) => void;
  viewMode?: "fit" | "actual";
  isGenerating?: boolean;
}

const MOBILE_VIEWPORT_WIDTH = 375;
export const DESKTOP_VIEWPORT_WIDTH = 1366;

function PreviewComponent({
  code,
  device,
  onScaleChange,
  viewMode,
  isGenerating = false,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastRenderableCodeRef = useRef("");

  // Don't update code more often than every 200ms.
  const throttledCode = useThrottle(code, 200);
  const normalizedCode = useMemo(
    () => normalizeBabelCdn(throttledCode),
    [throttledCode]
  );
  const hasRenderableCode = isRenderableHtmlDocument(normalizedCode);
  const hasEverRenderedCode = lastRenderableCodeRef.current.trim().length > 0;

  // Select and edit functionality
  const [clickEvent, setClickEvent] = useState<MouseEvent | null>(null);
  const activeMode = viewMode ?? "fit";

  useEffect(() => {
    if (hasRenderableCode) {
      lastRenderableCodeRef.current = normalizedCode;
    }
  }, [hasRenderableCode, normalizedCode]);

  // In select-and-edit mode, intercept clicks in the capture phase so the
  // generated app's own handlers (React/Vue listeners, Bootstrap/Ionic
  // behaviors, link navigation, form submits) never fire while selecting.
  const handleIframeClick = useCallback((event: MouseEvent) => {
    if (!inSelectAndEditModeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setClickEvent(event);
  }, []);

  // Suppress the rest of the pointer sequence (and form submits) while
  // selecting, since app handlers can be bound to those events too.
  const handleIframeInteraction = useCallback((event: Event) => {
    if (!inSelectAndEditModeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleIframeLinkClick = useCallback((event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest?.("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (href && href.startsWith("#")) {
      event.preventDefault();
    }
  }, []);

  // Devtools-style hover ring while selecting
  const hoveredElementRef = useRef<HTMLElement | null>(null);

  const handleIframeMouseOver = useCallback((event: MouseEvent) => {
    if (!inSelectAndEditModeRef.current) return;
    const target = event.target as HTMLElement;
    if (!target || !target.getBoundingClientRect) return;
    hoveredElementRef.current = target;
    showHoverOverlay(target);
  }, []);

  const handleIframeMouseOut = useCallback((event: MouseEvent) => {
    if (!inSelectAndEditModeRef.current) return;
    // Only when the pointer leaves the iframe viewport entirely
    if (event.relatedTarget) return;
    hoveredElementRef.current = null;
    hideHoverOverlay((event.target as HTMLElement)?.ownerDocument);
  }, []);

  // Keep the rings glued to their elements while the page scrolls or
  // resizes under a stationary cursor.
  const handleIframeReposition = useCallback(() => {
    if (!inSelectAndEditModeRef.current) return;
    const hovered = hoveredElementRef.current;
    if (hovered && hovered.isConnected) {
      showHoverOverlay(hovered);
    }
    const selected = useAppStore.getState().selectedElement;
    if (selected && selected.isConnected) {
      showSelectionOverlay(selected);
    }
  }, []);

  // Escape exits select mode even when focus is inside the iframe.
  const handleIframeKeyDown = useCallback((event: KeyboardEvent) => {
    if (!inSelectAndEditModeRef.current) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    useAppStore.getState().disableInSelectAndEditMode();
  }, []);

  const {
    inSelectAndEditMode,
    selectedElement,
    setSelectedElement,
  } = useAppStore();

  const inSelectAndEditModeRef = useRef(inSelectAndEditMode);
  useEffect(() => {
    inSelectAndEditModeRef.current = inSelectAndEditMode;
  }, [inSelectAndEditMode]);

  // Handle click events to select elements
  useEffect(() => {
    if (!inSelectAndEditModeRef.current || !clickEvent) {
      return;
    }

    const targetElement = clickEvent.target as HTMLElement;
    if (!targetElement) return;

    setSelectedElement(resolveEditableTarget(targetElement));
  }, [clickEvent, setSelectedElement]);

  // Render the selection ring for whatever element is currently selected
  // (clearing it when the selection is cleared from anywhere, e.g. the
  // sidebar's X button or after submitting an edit).
  useEffect(() => {
    if (selectedElement && selectedElement.isConnected) {
      showSelectionOverlay(selectedElement);
      return;
    }
    hideSelectionOverlay(iframeRef.current?.contentWindow?.document);
  }, [selectedElement]);

  // Apply/remove select-mode side effects (cursor, hover and selection
  // rings) when the mode toggles.
  useEffect(() => {
    const doc = iframeRef.current?.contentWindow?.document;
    if (inSelectAndEditMode) {
      applySelectModeCursor(doc);
      return;
    }
    if (selectedElement) {
      setSelectedElement(null);
    }
    hoveredElementRef.current = null;
    removeHoverOverlay(doc);
    removeSelectionOverlay(doc);
    removeSelectModeCursor(doc);
  }, [inSelectAndEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply a fixed viewport per device and scale to fit the available pane.
  useEffect(() => {
    const updateScale = () => {
      const wrapper = wrapperRef.current;
      const iframe = iframeRef.current;
      if (!wrapper || !iframe) return;

      const viewportWidth = wrapper.clientWidth;
      const viewportHeight = wrapper.clientHeight;

      if (device === "desktop") {
        const scaleValue =
          activeMode === "fit"
            ? Math.min(1, viewportWidth / DESKTOP_VIEWPORT_WIDTH)
            : 1;
        const iframeHeight = scaleValue > 0 ? viewportHeight / scaleValue : viewportHeight;

        onScaleChange?.(scaleValue);
        iframe.style.width = `${DESKTOP_VIEWPORT_WIDTH}px`;
        iframe.style.height = `${iframeHeight}px`;
        iframe.style.transform = `scale(${scaleValue})`;
        iframe.style.transformOrigin = "top left";
        return;
      }

      onScaleChange?.(1);
      iframe.style.width = `${MOBILE_VIEWPORT_WIDTH}px`;
      iframe.style.height = `${viewportHeight}px`;
      iframe.style.transform = "scale(1)";
      iframe.style.transformOrigin = "top left";
    };

    updateScale();

    window.addEventListener("resize", updateScale);
    const resizeObserver = new ResizeObserver(updateScale);
    if (wrapperRef.current) {
      resizeObserver.observe(wrapperRef.current);
    }
    return () => {
      window.removeEventListener("resize", updateScale);
      resizeObserver.disconnect();
    };
  }, [activeMode, device, onScaleChange]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const suppressedEvents = ["pointerdown", "mousedown", "mouseup", "submit"];

    const handleLoad = () => {
      const win = iframe.contentWindow;
      if (!win) return;
      // Intercept on the window in the capture phase: the window is the
      // first node in the propagation path, so this runs before any handler
      // the generated app registered, including capture-phase delegated
      // handlers on document (e.g. Bootstrap's data API).
      win.addEventListener("click", handleIframeClick, true);
      for (const type of suppressedEvents) {
        win.addEventListener(type, handleIframeInteraction, true);
      }
      win.addEventListener("mouseover", handleIframeMouseOver, true);
      win.addEventListener("mouseout", handleIframeMouseOut, true);
      win.addEventListener("scroll", handleIframeReposition, true);
      win.addEventListener("resize", handleIframeReposition);
      win.addEventListener("keydown", handleIframeKeyDown, true);
      win.document.addEventListener("click", handleIframeLinkClick);
      // A reload replaces the document, so re-apply mode side effects.
      if (inSelectAndEditModeRef.current) {
        applySelectModeCursor(win.document);
      }
    };

    iframe.addEventListener("load", handleLoad);
    // The current document may already be loaded (e.g. the component
    // re-rendered after the iframe's load event); attach to it directly.
    // addEventListener dedupes identical handlers, so this is safe.
    if (iframe.contentWindow?.document.readyState === "complete") {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
      const win = iframe.contentWindow;
      if (win) {
        win.removeEventListener("click", handleIframeClick, true);
        for (const type of suppressedEvents) {
          win.removeEventListener(type, handleIframeInteraction, true);
        }
        win.removeEventListener("mouseover", handleIframeMouseOver, true);
        win.removeEventListener("mouseout", handleIframeMouseOut, true);
        win.removeEventListener("scroll", handleIframeReposition, true);
        win.removeEventListener("resize", handleIframeReposition);
        win.removeEventListener("keydown", handleIframeKeyDown, true);
        win.document.removeEventListener("click", handleIframeLinkClick);
      }
    };
  }, [
    handleIframeClick,
    handleIframeLinkClick,
    handleIframeInteraction,
    handleIframeMouseOver,
    handleIframeMouseOut,
    handleIframeReposition,
    handleIframeKeyDown,
  ]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #fafafa 0%, #f3f4f6 100%);
        color: #111827;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
      }
      .shell {
        width: min(560px, 100%);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.82);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
        padding: 28px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6366f1;
        margin-bottom: 16px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0;
        font-size: 15px;
        line-height: 1.7;
        color: #4b5563;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="badge"><span class="dot"></span>预览待生成</div>
      <h1>${isGenerating ? "正在生成预览..." : "还没有可渲染预览"}</h1>
      <p>${isGenerating ? "新草稿生成期间，会先保留上一版稳定画面。" : "Agent 还没有产出可渲染代码，这个占位页用于避免空白画布。"}</p>
    </div>
  </body>
</html>`;
    const html = hasRenderableCode
      ? normalizedCode
      : hasEverRenderedCode
        ? lastRenderableCodeRef.current
        : fallbackHtml;
    if (iframe.srcdoc !== html) {
      iframe.srcdoc = html;
    }
  }, [hasEverRenderedCode, hasRenderableCode, isGenerating, normalizedCode]);

  return (
    <div
      className={`flex-1 min-h-0 relative ${
        device === "mobile"
          ? "flex justify-center overflow-hidden bg-gray-100 dark:bg-zinc-900"
          : activeMode === "fit"
            ? "flex justify-center overflow-hidden"
            : "overflow-auto"
      }`}
    >
      <div
        ref={wrapperRef}
        className={`w-full h-full ${device === "mobile" ? "flex justify-center" : ""}`}
        >
          <iframe
            id={`preview-${device}`}
            ref={iframeRef}
            title="预览"
            className={classNames(
              {
                "border-0": true,
              }
            )}
          ></iframe>
          {isGenerating && !hasRenderableCode && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-white/75 dark:bg-zinc-950/70 backdrop-blur-sm">
              <div className="rounded-2xl border border-dashed border-violet-300 bg-white px-5 py-3 text-sm font-medium text-violet-700 shadow-sm dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300">
                正在等待可渲染代码...
              </div>
            </div>
          )}
        </div>
      </div>
    );
}

export default PreviewComponent;
