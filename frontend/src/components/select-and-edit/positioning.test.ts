import { calculateSelectionPopoverPosition } from "./positioning";

const rootRect = { top: 100, left: 100, width: 1000, height: 700 };
const iframeRect = { top: 100, left: 100, width: 683, height: 700 };

describe("calculateSelectionPopoverPosition", () => {
  it("places the editor below a selection when there is room", () => {
    const result = calculateSelectionPopoverPosition({
      rootRect,
      iframeRect,
      elementRect: { top: 100, left: 200, width: 400, height: 80 },
      iframeLayoutWidth: 1366,
      iframeLayoutHeight: 1400,
      popoverWidth: 336,
      popoverHeight: 190,
    });
    expect(result.placement).toBe("below");
    expect(result.top).toBe(102);
  });

  it("moves the editor above a selection near the bottom", () => {
    const result = calculateSelectionPopoverPosition({
      rootRect,
      iframeRect,
      elementRect: { top: 1100, left: 200, width: 400, height: 80 },
      iframeLayoutWidth: 1366,
      iframeLayoutHeight: 1400,
      popoverWidth: 336,
      popoverHeight: 190,
    });
    expect(result.placement).toBe("above");
  });

  it("keeps the editor inside the preview pane", () => {
    const result = calculateSelectionPopoverPosition({
      rootRect,
      iframeRect,
      elementRect: { top: 80, left: 0, width: 30, height: 30 },
      iframeLayoutWidth: 1366,
      iframeLayoutHeight: 1400,
      popoverWidth: 336,
      popoverHeight: 190,
    });
    expect(result.left).toBe(12);
    expect(result.top).toBeGreaterThanOrEqual(12);
  });
});
