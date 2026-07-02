import {
  buildSelectedElementInstruction,
  describeElementContext,
  resolveEditableTarget,
} from "./utils";

// Minimal stand-in for a DOM element; jest runs in the node environment.
interface FakeElement {
  tagName: string;
  outerHTML: string;
  parentElement: FakeElement | null;
  children: FakeElement[];
  textContent?: string;
  ownerDocument: { getElementsByTagName: (tag: string) => FakeElement[] };
  getAttribute: (name: string) => string | null;
}

function fakeElement(tag: string, classAttr: string, outerHTML = ""): FakeElement {
  return {
    tagName: tag.toUpperCase(),
    outerHTML,
    parentElement: null,
    children: [],
    textContent: "",
    ownerDocument: { getElementsByTagName: () => [] },
    getAttribute: (name) => (name === "class" && classAttr ? classAttr : null),
  };
}

function appendChild(parent: FakeElement, child: FakeElement): void {
  child.parentElement = parent;
  parent.children.push(child);
}

function asElement(el: FakeElement): Element {
  return el as unknown as Element;
}

describe("describeElementContext", () => {
  function buildPricingPage() {
    const body = fakeElement("body", "");
    const grid = fakeElement("div", "pricing-grid");
    const card = fakeElement("div", "pricing-card featured");
    const anchorHtml = '<a href="#" class="btn">Choose plan</a>';
    const basicBtn = fakeElement("a", "btn", anchorHtml);
    const proBtn = fakeElement("a", "btn", anchorHtml);
    const enterpriseBtn = fakeElement("a", "btn", anchorHtml);
    grid.parentElement = body;
    card.parentElement = grid;
    proBtn.parentElement = card;
    const doc = {
      getElementsByTagName: () => [basicBtn, proBtn, enterpriseBtn],
    };
    [basicBtn, proBtn, enterpriseBtn].forEach((el) => {
      el.ownerDocument = doc;
    });
    return { proBtn };
  }

  it("builds an ancestor path with classes", () => {
    const { proBtn } = buildPricingPage();
    const context = describeElementContext(asElement(proBtn));
    expect(context).toContain(
      "Element location: body > div.pricing-grid > div.pricing-card.featured > a.btn"
    );
  });

  it("notes the position among identical elements", () => {
    const { proBtn } = buildPricingPage();
    const context = describeElementContext(asElement(proBtn));
    expect(context).toContain("3 elements on the page share this exact markup");
    expect(context).toContain("number 2 of 3");
  });

  it("omits the duplicate note when the markup is unique", () => {
    const heading = fakeElement("h1", "title", "<h1 class=\"title\">Hi</h1>");
    heading.ownerDocument = { getElementsByTagName: () => [heading] };
    const context = describeElementContext(asElement(heading));
    expect(context).toContain("Element location: h1.title");
    expect(context).not.toContain("share this exact markup");
  });
});

describe("buildSelectedElementInstruction", () => {
  it("includes the instruction and the element html", () => {
    const result = buildSelectedElementInstruction(
      "Make the button red",
      '<button class="btn">Buy</button>'
    );
    expect(result).toContain("Make the button red");
    expect(result).toContain('<button class="btn">Buy</button>');
    expect(result).toContain("selected in the preview");
  });

  it("mentions that the snippet is rendered DOM, not source", () => {
    const result = buildSelectedElementInstruction(
      "Center it",
      "<div>x</div>"
    );
    expect(result).toContain("outerHTML captured from the rendered page");
  });

  it("truncates very large element html", () => {
    const hugeHtml = `<div>${"a".repeat(20000)}</div>`;
    const result = buildSelectedElementInstruction("Shrink it", hugeHtml);
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThan(hugeHtml.length);
  });

  it("does not truncate small element html", () => {
    const result = buildSelectedElementInstruction(
      "Bold it",
      "<span>hello</span>"
    );
    expect(result).not.toContain("truncated");
  });

  it("includes the element context when provided", () => {
    const result = buildSelectedElementInstruction(
      "Make it red",
      '<a class="btn">Go</a>',
      "Element location: body > div.card > a.btn"
    );
    expect(result).toContain("Element location: body > div.card > a.btn");
  });

  it("adds edit-boundary self-check guidance", () => {
    const result = buildSelectedElementInstruction(
      "Center the controls",
      '<div class="controls"><button>Play</button></div>'
    );
    expect(result).toContain("This snippet is the edit boundary");
    expect(result).toContain("Content outside this selected scope remains visually unchanged");
  });

  it("omits the context block when not provided", () => {
    const result = buildSelectedElementInstruction(
      "Make it red",
      '<a class="btn">Go</a>'
    );
    expect(result).not.toContain("Element location:");
  });
});

describe("resolveEditableTarget", () => {
  it("promotes an icon inside a button row to the parent control group", () => {
    const controls = fakeElement("div", "controls");
    const previous = fakeElement("button", "icon-btn", "<button><i></i></button>");
    const play = fakeElement("button", "icon-btn", "<button><i></i></button>");
    const next = fakeElement("button", "icon-btn", "<button><i></i></button>");
    const icon = fakeElement("i", "fa fa-play", "<i class=\"fa fa-play\"></i>");

    appendChild(controls, previous);
    appendChild(controls, play);
    appendChild(controls, next);
    appendChild(play, icon);

    expect(resolveEditableTarget(asElement(icon) as unknown as HTMLElement)).toBe(
      controls as unknown as HTMLElement
    );
  });

  it("promotes inline text to a richer card container", () => {
    const card = fakeElement("div", "album-card");
    const title = fakeElement("h3", "title", "<h3>Eclipse</h3>");
    title.textContent = "Eclipse";
    const subtitle = fakeElement("p", "artist", "<p>Artist Vox</p>");
    subtitle.textContent = "Artist Vox";

    appendChild(card, title);
    appendChild(card, subtitle);

    expect(
      resolveEditableTarget(asElement(subtitle) as unknown as HTMLElement)
    ).toBe(card as unknown as HTMLElement);
  });
});
