import {
  applySafeDirectTextEdit,
  parseExplicitTextReplacement,
} from "./direct-text-edit";

describe("parseExplicitTextReplacement", () => {
  it("parses a replacement inside the selected copy", () => {
    expect(
      parseExplicitTextReplacement(
        "把 12 家改成 18 家",
        "本周新增客户 12 家"
      )
    ).toEqual({ oldText: "12 家", newText: "18 家" });
  });

  it("uses the entire selection for an explicit change-to instruction", () => {
    expect(parseExplicitTextReplacement("改成“项目最新进展”", "项目进展"))
      .toEqual({ oldText: "项目进展", newText: "项目最新进展" });
  });

  it("does not treat semantic rewriting as a direct replacement", () => {
    expect(parseExplicitTextReplacement("写得更专业一点", "项目进展"))
      .toBeNull();
    expect(parseExplicitTextReplacement("把这里润色一下", "项目进展"))
      .toBeNull();
  });
});

describe("applySafeDirectTextEdit", () => {
  it("edits a uniquely located selected source element", () => {
    const code = "<main><p>本周新增客户 12 家</p><p>其他内容</p></main>";
    const result = applySafeDirectTextEdit({
      code,
      instruction: "把 12 家改成 18 家",
      selectedText: "本周新增客户 12 家",
      selectedOuterHTML: "<p>本周新增客户 12 家</p>",
    });
    expect(result?.code).toContain("本周新增客户 18 家");
    expect(result?.strategy).toBe("selected-source");
  });

  it("falls back to uniquely located text when rendered markup differs", () => {
    const result = applySafeDirectTextEdit({
      code: '<h2 className="title">项目进展</h2>',
      instruction: "改成项目最新进展",
      selectedText: "项目进展",
      selectedOuterHTML: '<h2 class="title">项目进展</h2>',
    });
    expect(result?.code).toContain("项目最新进展");
    expect(result?.strategy).toBe("unique-text");
  });

  it("escapes replacement text before inserting it into HTML", () => {
    const result = applySafeDirectTextEdit({
      code: "<p>旧标题</p>",
      instruction: "改成 A < B & C",
      selectedText: "旧标题",
      selectedOuterHTML: "<p>旧标题</p>",
    });
    expect(result?.code).toBe("<p>A &lt; B &amp; C</p>");
  });

  it("refuses an ambiguous source replacement", () => {
    const result = applySafeDirectTextEdit({
      code: "<p>12 家</p><p>12 家</p>",
      instruction: "把 12 家改成 18 家",
      selectedText: "12 家",
      selectedOuterHTML: "<p>12 家</p>",
    });
    expect(result).toBeNull();
  });
});
