jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import {
  buildChangeReport,
  classifyGenerationFailure,
  classifyUserTurnIntent,
  evaluateTargetedEdit,
  extractRenderableDiagnostics,
  getPreviewEscalationReason,
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

  it("keeps only the first renderable document and records trimmed output", () => {
    const result = extractRenderableDiagnostics(`
      Here is your updated page.
      <!doctype html><html><body><h1>First</h1></body></html>
      {"status":"completed"}
      <html><body><h1>Second</h1></body></html>
    `);

    expect(result.hasRenderableDocument).toBe(true);
    expect(result.primaryDocumentType).toBe("html");
    expect(result.discardedContentPreview).toContain("Here is your updated page.");
    expect(result.discardedContentPreview).toContain('{"status":"completed"}');
  });

  it("flags prose-only completions as failed self-checks", () => {
    const result = runPreviewSelfCheck("Here is your updated page.");
    expect(result.status).toBe("fail");
    expect(result.issues[0]).toContain("完整的 HTML 文档");
  });

  it("marks create turns as escalated preview checks", () => {
    const result = runPreviewSelfCheck("<!doctype html><html><body>ok</body></html>", {
      generationType: "create",
      userInstruction: "Create a landing page",
    });
    expect(result.status).toBe("pass");
    expect(result.localCheckOnly).toBe(false);
    expect(result.escalatedPreviewCheck).toBe(true);
    expect(
      getPreviewEscalationReason({
        generationType: "create",
        userInstruction: "Create a landing page",
      })
    ).toBe("create_requires_full_review");
  });

  it("fails targeted edits that do not change the selected area", () => {
    const previousCode =
      "<!doctype html><html><body><section><div class='controls'><button>Back</button><button>Play</button></div><p>Keep me</p></section></body></html>";
    const result = runPreviewSelfCheck(previousCode, {
      generationType: "update",
      turnIntent: "modify",
      previousCode,
      selectedElementHtml:
        "<div class='controls'><button>Back</button><button>Play</button></div>",
      designUpdateIntent: {
        target: "media controls",
        intent: "reposition",
        placement: "first row",
        alignment: "center",
        preserve: ["保留其他内容不要动"],
      },
      userInstruction: "把播放 前进 后退 调整到第一行居中，保留其他内容不要动",
    });

    expect(result.status).toBe("fail");
    expect(result.issues.join(" ")).toContain("目标区域");
  });

  it("classifies timeouts separately", () => {
    expect(classifyGenerationFailure("[timeout] ReadTimeout")).toBe("timeout");
  });

  it("treats reference style requests as generation rather than questions", () => {
    const decision = routeUserTurn({
      text: "参考蛋仔派对的可爱风格",
      generationType: "create",
      currentCode: "",
    });

    expect(decision.intent).toBe("generate");
    expect(decision.shouldAskQuestion).toBe(false);
    expect(decision.signals).toContain("reference");
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

  it("builds a compact change report from before/after html", () => {
    const result = buildChangeReport({
      previousCode:
        "<!doctype html><html><body><section><h1>Title</h1><p>Old copy</p></section></body></html>",
      nextCode:
        "<!doctype html><html><body><section><h1>Title</h1><p>New copy</p><button>CTA</button></section></body></html>",
    });

    expect(result).not.toBeNull();
    expect(result?.changedNodes).toBeGreaterThanOrEqual(1);
    expect(result?.addedNodes).toBeGreaterThanOrEqual(1);
    expect(result?.changedRegions.join(" ")).toContain("button");
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
