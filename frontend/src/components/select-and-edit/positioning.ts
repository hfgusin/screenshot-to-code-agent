export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  placement: "above" | "below";
}

interface PositionOptions {
  rootRect: RectLike;
  iframeRect: RectLike;
  elementRect: RectLike;
  iframeLayoutWidth: number;
  iframeLayoutHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  gap?: number;
  padding?: number;
}

export function calculateSelectionPopoverPosition({
  rootRect,
  iframeRect,
  elementRect,
  iframeLayoutWidth,
  iframeLayoutHeight,
  popoverWidth,
  popoverHeight,
  gap = 12,
  padding = 12,
}: PositionOptions): PopoverPosition {
  const scaleX = iframeLayoutWidth > 0 ? iframeRect.width / iframeLayoutWidth : 1;
  const scaleY = iframeLayoutHeight > 0 ? iframeRect.height / iframeLayoutHeight : 1;
  const selectedLeft = iframeRect.left - rootRect.left + elementRect.left * scaleX;
  const selectedTop = iframeRect.top - rootRect.top + elementRect.top * scaleY;
  const selectedWidth = elementRect.width * scaleX;
  const selectedHeight = elementRect.height * scaleY;
  const availableBelow = rootRect.height - (selectedTop + selectedHeight + gap);
  const placement =
    availableBelow >= popoverHeight || selectedTop < popoverHeight + gap
      ? "below"
      : "above";
  const idealTop =
    placement === "below"
      ? selectedTop + selectedHeight + gap
      : selectedTop - popoverHeight - gap;
  const idealLeft = selectedLeft + selectedWidth / 2 - popoverWidth / 2;

  return {
    placement,
    top: Math.max(
      padding,
      Math.min(idealTop, Math.max(padding, rootRect.height - popoverHeight - padding))
    ),
    left: Math.max(
      padding,
      Math.min(idealLeft, Math.max(padding, rootRect.width - popoverWidth - padding))
    ),
  };
}
