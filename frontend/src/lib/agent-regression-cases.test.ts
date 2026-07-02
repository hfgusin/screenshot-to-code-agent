import { AGENT_REGRESSION_CASES } from "./agent-regression-cases";

describe("AGENT_REGRESSION_CASES", () => {
  it("keeps exactly five fixed regression cases", () => {
    expect(AGENT_REGRESSION_CASES).toHaveLength(5);
  });

  it("uses unique ids and non-empty checks", () => {
    const ids = AGENT_REGRESSION_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    AGENT_REGRESSION_CASES.forEach((testCase) => {
      expect(testCase.title.trim().length).toBeGreaterThan(0);
      expect(testCase.request.trim().length).toBeGreaterThan(0);
      expect(testCase.checks.length).toBeGreaterThan(0);
    });
  });
});
