jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import {
  classifyGenerationFailure,
  classifyUserTurnIntent,
  evaluateTargetedEdit,
  isRenderableHtmlDocument,
  parseDesignUpdateIntent,
  resolveIntentDecision,
  routeUserTurn,
  runPreviewSelfCheck,
  summarizeReviewState,
  summarizeImageUpdateStatus,
} from "./design-agent";

describe("design-agent helpers", () => {
  it("parses a targeted alignment request into a structured intent", () => {
    expect(
      parseDesignUpdateIntent(
        "把播放 前进 后退 调整到第一行居中，保留其他内容不要动",
        "div"
      )
    ).toEqual({
      target: "media controls",
      intent: "reposition",
      placement: "first row",
      alignment: "center",
      preserve: ["保留其他内容不要动"],
    });
  });

  it("recognizes renderable html documents", () => {
    expect(isRenderableHtmlDocument("<!doctype html><html><body>ok</body></html>")).toBe(
      true
    );
    expect(isRenderableHtmlDocument("Here is your updated page.")).toBe(false);
  });

  it("flags prose-only completions as failed self-checks", () => {
    const result = runPreviewSelfCheck("Here is your updated page.");
    expect(result.status).toBe("fail");
    expect(result.issues[0]).toContain("full HTML document");
  });

  it("classifies timeouts separately", () => {
    expect(classifyGenerationFailure("[timeout] ReadTimeout")).toBe("timeout");
  });

  it("classifies update and question turns", () => {
    const decision = routeUserTurn({
      text: "把播放 前进 后退 调整到第一行居中",
      generationType: "update",
      selectedElementHtml: "<div class='controls'>...</div>",
      currentCode: "<html></html>",
    });
    expect(decision.intent).toBe("modify");
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(decision.shouldAskQuestion).toBe(false);

    expect(
      classifyUserTurnIntent({
        text: "把播放 前进 后退 调整到第一行居中",
        generationType: "update",
        selectedElementHtml: "<div class='controls'>...</div>",
        currentCode: "<html></html>",
      })
    ).toBe("modify");

    const questionDecision = routeUserTurn({
      text: "为什么这个预览会失败？",
      generationType: "update",
      currentCode: "",
    });
    expect(questionDecision.intent).toBe("question");
    expect(questionDecision.shouldAskQuestion).toBe(true);
  });

  it("scores a centered targeted edit as a hit", () => {
    const result = evaluateTargetedEdit({
      previousCode:
        "<!doctype html><html><body><section><div class='controls'><button>Back</button><button>Play</button><button>Next</button></div><p>Keep me</p></section></body></html>",
      nextCode:
        "<!doctype html><html><body><section><div class='controls justify-center'><button>Back</button><button>Play</button><button>Next</button></div><p>Keep me</p></section></body></html>",
      selectedElementHtml:
        "<div class='controls'><button>Back</button><button>Play</button><button>Next</button></div>",
      designUpdateIntent: {
        target: "media controls",
        intent: "reposition",
        placement: "first row",
        alignment: "center",
        preserve: ["保留其他内容不要动"],
      },
      userInstruction: "把播放 前进 后退 调整到第一行居中，保留其他内容不要动",
    });
    expect(result?.intentMatched).toBe(true);
    expect(result?.preservedOutsideTarget).toBe(true);
    expect(result?.score).toBeGreaterThanOrEqual(0.8);
  });

  it("summarizes the latest image update status from tool events", () => {
    const result = summarizeImageUpdateStatus([
      {
        toolName: "edit_image",
        output: {
          image: {
            status: "ok",
            imageOperation: "edit",
            persistedAssetUrl: "http://127.0.0.1:7001/local-assets/asset_x.png",
            assetLineage: {
              assetId: "tmp_asset_123",
              parentAssetId: "tmp_asset_parent",
              sourceImageUrl: "http://127.0.0.1:7001/local-assets/source.png",
            },
          },
        },
      },
    ]);
    expect(result).toEqual({
      operation: "edit",
      status: "ok",
      persistedAssetUrl: "http://127.0.0.1:7001/local-assets/asset_x.png",
      sourceImageUrl: "http://127.0.0.1:7001/local-assets/source.png",
      assetId: "tmp_asset_123",
      parentAssetId: "tmp_asset_parent",
      message: undefined,
    });
  });

  it("summarizes review state for the design session", () => {
    const summary = summarizeReviewState({
      turnIntent: "modify",
      selfCheck: {
        status: "pass",
        summary: "Preview self-check passed.",
        issues: [],
        isRenderable: true,
      },
      imageUpdateStatus: {
        operation: "edit",
        status: "ok",
        persistedAssetUrl: "http://127.0.0.1:7001/local-assets/asset_x.png",
      },
    });
    expect(summary).toContain("intent=modify");
    expect(summary).toContain("preview=pass");
    expect(summary).toContain("image=edit/ok");
  });

  it("falls back to the local router when the backend intent endpoint is unavailable", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    try {
      const decision = await resolveIntentDecision({
        text: "把播放 前进 后退 调整到第一行居中",
        generationType: "update",
        selectedElementHtml: "<div class='controls'>...</div>",
        currentCode: "<html></html>",
      });

      expect(decision.intent).toBe("modify");
      expect(decision.confidence).toBeGreaterThan(0.8);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
