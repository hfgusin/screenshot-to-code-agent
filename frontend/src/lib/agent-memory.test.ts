import {
  consolidateAgentMemory,
  createEmptyAgentMemory,
  detectMemoryConflicts,
} from "./agent-memory";

describe("agent memory", () => {
  it("promotes explicit user corrections into confirmed long memory", () => {
    const memory = consolidateAgentMemory({
      previousMemory: createEmptyAgentMemory(),
      userText:
        "特殊分享不可能再展示分享按钮。评论不是评价游戏卡顿，而是评论分享出来的人玩得咋样。",
      generationType: "update",
      turnIntent: "modify",
    });

    expect(memory.longTerm.map((item) => item.text)).toEqual(
      expect.arrayContaining([
        "特殊分享不可能再展示分享按钮",
        "评论不是评价游戏卡顿，而是评论分享出来的人玩得咋样",
      ])
    );
    expect(memory.longTerm[0].status).toBe("active");
    expect(memory.longTerm[0].source).toBe("user_instruction");
  });

  it("detects semantic conflicts against active long memory", () => {
    const memory = consolidateAgentMemory({
      previousMemory: createEmptyAgentMemory(),
      userText: "特殊分享不可能再展示分享按钮。",
      generationType: "update",
      turnIntent: "modify",
    });

    const conflicts = detectMemoryConflicts(memory, "加一个分享按钮");

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("high");
    expect(conflicts[0].text).toContain("长期记忆冲突");
  });
});
