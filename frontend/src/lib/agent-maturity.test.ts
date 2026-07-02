import { buildAgentMaturitySummary } from "./agent-maturity";
import { Commit } from "../components/commits/types";

function makeCommit(overrides: Partial<Commit>): Commit {
  return {
    hash: "base",
    dateCreated: new Date(),
    isCommitted: false,
    parentHash: null,
    selectedVariantIndex: 0,
    variants: [
      {
        code: "<!doctype html><html><body>ok</body></html>",
        history: [],
      },
    ],
    type: "ai_create",
    inputs: {
      text: "Create",
      images: [],
      videos: [],
    },
    ...overrides,
  } as Commit;
}

describe("buildAgentMaturitySummary", () => {
  it("summarizes hit rate, failure rate, and durations from revisions", () => {
    const createCommit = makeCommit({
      hash: "c1",
      type: "ai_create",
      variants: [
        {
          code: "<!doctype html><html><body>create</body></html>",
          history: [],
          status: "complete",
          diagnostics: { selfCheckStatus: "pass" },
          metrics: { durationMs: 4000 },
        },
      ],
    });
    const targetedEdit = makeCommit({
      hash: "c2",
      type: "ai_edit",
      parentHash: "c1",
      variants: [
        {
          code: "<!doctype html><html><body>edit</body></html>",
          history: [],
          status: "complete",
          diagnostics: { selfCheckStatus: "pass" },
          metrics: { durationMs: 2000 },
        },
      ],
      inputs: {
        text: "Move controls",
        images: [],
        videos: [],
        selectedElementHtml: "<div>controls</div>",
      },
    });
    const failedEdit = makeCommit({
      hash: "c3",
      type: "ai_edit",
      parentHash: "c2",
      variants: [
        {
          code: "",
          history: [],
          status: "error",
          diagnostics: { selfCheckStatus: "fail" },
        },
      ],
      inputs: {
        text: "Bad update",
        images: [],
        videos: [],
      },
    });

    const summary = buildAgentMaturitySummary({
      c1: createCommit,
      c2: targetedEdit,
      c3: failedEdit,
    });

    expect(summary.totalTurns).toBe(3);
    expect(summary.completedTurns).toBe(2);
    expect(summary.failedTurns).toBe(1);
    expect(summary.targetedUpdates).toBe(1);
    expect(summary.targetedHits).toBe(1);
    expect(summary.rollbackPoints).toBe(2);
    expect(summary.averageCreateDurationMs).toBe(4000);
    expect(summary.averageUpdateDurationMs).toBe(2000);
    expect(summary.failureRate).toBeCloseTo(1 / 3);
    expect(summary.targetHitRate).toBe(1);
  });
});
