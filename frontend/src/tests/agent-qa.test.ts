import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser, Page } from "puppeteer";
import { CodeGenerationModel } from "../lib/models";
import { AGENT_REGRESSION_CASES } from "../lib/agent-regression-cases";

const RUN_E2E = process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;
const QA_MODE = process.env.AGENT_QA_MODE === "live" ? "live" : "mock";
const FRONTEND_URL = process.env.AGENT_QA_FRONTEND_URL ?? "http://localhost:5173/";
const BACKEND_URL = process.env.AGENT_QA_BACKEND_URL ?? "http://localhost:7001";

const TESTS_ROOT_PATH =
  process.env.TEST_ROOT_PATH ?? path.resolve(process.cwd(), "src/tests");
const RESULTS_DIR = path.join(TESTS_ROOT_PATH, "results");
const REPORT_PATH = path.join(RESULTS_DIR, "agent_qa_report.md");
const BACKEND_AGENT_QA_DIR =
  process.env.AGENT_QA_ARTIFACTS_DIR ??
  path.resolve(process.cwd(), "../backend/run_logs/agent_qa");

type PromptReportSummary = {
  filename: string;
  created_at?: string;
};

type CaseResult = {
  id: string;
  title: string;
  pass: boolean;
  durationMs: number;
  screenshots: string[];
  notes: string[];
  expectedSignals?: string[];
  assertions?: string[];
  promptReports?: PromptReportSummary[];
  diagnostics?: Record<string, unknown>;
  error?: string;
};

describeE2E("agent regression pack", () => {
  let browser: Browser | undefined;
  let page: Page;
  let app: AgentQaApp;
  const results: CaseResult[] = [];

  beforeAll(async () => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.mkdirSync(BACKEND_AGENT_QA_DIR, { recursive: true });
    const browserProfileDir = path.join(RESULTS_DIR, ".puppeteer-profile");
    fs.mkdirSync(browserProfileDir, { recursive: true });
    browser = await puppeteer.launch({
      headless: process.env.HEADLESS !== "false",
      userDataDir: browserProfileDir,
      args: [
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    page = await browser.newPage();

    if (QA_MODE === "mock") {
      await installMockWebSocket(page);
    }
    await page.goto(FRONTEND_URL, { waitUntil: "networkidle0" });
    await page.setViewport({ width: 1440, height: 1100 });

    app = new AgentQaApp(page, QA_MODE);
    await app.init();
  });

  afterAll(async () => {
    await writeAgentQaReport(results);
    if (browser) {
      await browser.close();
    }
  });

  it(
    "runs the fixed 5-case agent regression pack",
    async () => {
      const failures: string[] = [];

      await runCase(
        results,
        AGENT_REGRESSION_CASES[0].id,
        AGENT_REGRESSION_CASES[0].title,
        async (result) => {
          result.expectedSignals = AGENT_REGRESSION_CASES[0].expectedSignals;
          result.assertions = AGENT_REGRESSION_CASES[0].assertions;
          result.screenshots.push(
            ...(await app.generateFromText(
            "做一个音乐 App 首页，暗色、极简、杂志感。",
            "case1_create"
            ))
          );
          await app.assertPrimaryDraftVisible();
          await app.assertPageContains("REGRESSION PACK");
          result.diagnostics = await app.readQaSnapshot();
          result.notes.push("首稿生成后预览可见。");
        },
        failures
      );

      await runCase(
        results,
        AGENT_REGRESSION_CASES[1].id,
        AGENT_REGRESSION_CASES[1].title,
        async (result) => {
          result.expectedSignals = AGENT_REGRESSION_CASES[1].expectedSignals;
          result.assertions = AGENT_REGRESSION_CASES[1].assertions;
          if (QA_MODE === "live") {
            await app.selectTarget("media-controls");
          }
          result.screenshots.push(
            ...(await app.update(
            "只调整这组播放控制按钮的位置，把播放、前进、后退按钮移动到第一行居中，保留封面、时间和其他区域不变。",
            2,
            "qa-state: controls-centered",
            "case2_controls"
            ))
          );
          await app.assertTargetingScore(0.5);
          result.diagnostics = await app.readQaSnapshot();
          result.notes.push("结构化目标命中了 media controls。");
        },
        failures
      );

      await runCase(
        results,
        AGENT_REGRESSION_CASES[2].id,
        AGENT_REGRESSION_CASES[2].title,
        async (result) => {
          result.expectedSignals = AGENT_REGRESSION_CASES[2].expectedSignals;
          result.assertions = AGENT_REGRESSION_CASES[2].assertions;
          if (QA_MODE === "live") {
            await app.selectTarget("hero-image");
          }
          result.screenshots.push(
            ...(await app.update(
            "只修改当前主视觉图片，让它更偏 Hello Kitty / Ruby 风格，保留标题、按钮和整体布局不变。",
            3,
            "qa-state: cute-hero",
            "case3_image"
            ))
          );
          await app.assertImageUpdateStatus("ok");
          result.diagnostics = await app.readQaSnapshot();
          result.notes.push("主视觉更新后仍保留原有布局。");
        },
        failures
      );

      await runCase(
        results,
        AGENT_REGRESSION_CASES[3].id,
        AGENT_REGRESSION_CASES[3].title,
        async (result) => {
          result.expectedSignals = AGENT_REGRESSION_CASES[3].expectedSignals;
          result.assertions = AGENT_REGRESSION_CASES[3].assertions;
          result.screenshots.push(
            ...(await app.update(
            "保持页面结构不变，不换题。只把整体视觉再高级一点，增加留白和更精致的排版层级。",
            4,
            "qa-state: editorial-refine",
            "case4_style"
            ))
          );
          if (QA_MODE === "mock") {
            await app.assertPreviewContains("Editorial spacing");
          } else {
            await app.assertPrimaryDraftVisible();
          }
          result.diagnostics = await app.readQaSnapshot();
          result.notes.push("风格收敛后仍围绕同一音乐 App 主题。");
        },
        failures
      );

      await runCase(
        results,
        AGENT_REGRESSION_CASES[4].id,
        AGENT_REGRESSION_CASES[4].title,
        async (result) => {
          result.expectedSignals = AGENT_REGRESSION_CASES[4].expectedSignals;
          result.assertions = AGENT_REGRESSION_CASES[4].assertions;
          const originalWorkspaceId = await app.readActiveWorkspaceId();
          result.screenshots.push(
            ...(await app.rollbackToVersion(1, "case5_rollback"))
          );
          if (QA_MODE === "mock") {
            await app.assertPreviewContains("Base Music Home");
          } else {
            await app.assertPrimaryDraftVisible();
          }
          await app.createNewProject();
          result.screenshots.push(
            ...(await app.restoreWorkspace(originalWorkspaceId, "case5_restore"))
          );
          if (QA_MODE === "mock") {
            await app.assertPreviewContains("Base Music Home");
          } else {
            await app.assertPrimaryDraftVisible();
          }
          result.diagnostics = await app.readQaSnapshot();
          result.notes.push("回滚后又成功恢复同一 workspace。");
        },
        failures
      );

      if (failures.length > 0) {
        throw new Error(
          `Agent regression failures:\n- ${failures.join("\n- ")}`
        );
      }
    },
    180000
  );
});

async function runCase(
  results: CaseResult[],
  id: string,
  title: string,
  fn: (result: CaseResult) => Promise<void>,
  failures: string[]
) {
  const result: CaseResult = {
    id,
    title,
    pass: false,
    durationMs: 0,
    screenshots: [],
    notes: [],
  };
  const startedAt = Date.now();
  try {
    await fn(result);
    result.promptReports = await fetchPromptReportsSince(startedAt);
    result.pass = true;
  } catch (error) {
    result.error =
      error instanceof Error ? error.message : "Unknown regression failure";
    result.promptReports = await fetchPromptReportsSince(startedAt);
    failures.push(`${title}: ${result.error}`);
  } finally {
    result.durationMs = Date.now() - startedAt;
    results.push(result);
  }
}

class AgentQaApp {
  constructor(private page: Page, private mode: "mock" | "live") {}

  async runQaControl(
    action: "openEditor" | "openHistory" | "openPreview" | "createNewProject",
    arg?: string
  ) {
    await this.page.evaluate(
      async ({ nextAction, nextArg }) => {
        const controls = (window as typeof window & {
          __agentQaControls?: {
            openEditor?: () => void;
            openHistory?: () => void;
            openPreview?: () => void;
            createNewProject?: () => Promise<void>;
            openWorkspace?: (id: string) => Promise<boolean>;
          };
        }).__agentQaControls;
        if (!controls) {
          throw new Error("QA controls are unavailable");
        }
        if (nextAction === "createNewProject") {
          await controls.createNewProject?.();
          return;
        }
        if (nextAction === "openEditor") {
          controls.openEditor?.();
          return;
        }
        if (nextAction === "openHistory") {
          controls.openHistory?.();
          return;
        }
        if (nextAction === "openPreview") {
          controls.openPreview?.();
          return;
        }
        if (nextAction === "openWorkspace") {
          await controls.openWorkspace?.(nextArg || "");
        }
      },
      { nextAction: action, nextArg: arg }
    );
  }

  async openWorkspaceById(workspaceId: string) {
    return this.page.evaluate(async (id) => {
      const controls = (window as typeof window & {
        __agentQaControls?: {
          openWorkspace?: (nextId: string) => Promise<boolean>;
        };
      }).__agentQaControls;
      if (!controls?.openWorkspace) {
        throw new Error("QA workspace control is unavailable");
      }
      return controls.openWorkspace(id);
    }, workspaceId);
  }

  async rollbackToVersionByControl(versionNumber: number) {
    return this.page.evaluate((targetVersion) => {
      const controls = (window as typeof window & {
        __agentQaControls?: {
          rollbackToVersion?: (nextVersion: number) => boolean;
        };
      }).__agentQaControls;
      if (!controls?.rollbackToVersion) {
        throw new Error("QA rollback control is unavailable");
      }
      return controls.rollbackToVersion(targetVersion);
    }, versionNumber);
  }

  async init() {
    await this.clearBrowserState();
    await this.setupLocalStorage();
    await this.page.reload({ waitUntil: "networkidle0" });
  }

  async clearBrowserState() {
    await this.page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();

      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("screenshot-to-code-workspaces");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
  }

  async setupLocalStorage() {
    const setting = {
      openAiApiKey:
        this.mode === "live" ? process.env.OPENAI_API_KEY || null : "test-openai-key",
      openAiBaseURL:
        this.mode === "live"
          ? process.env.OPENAI_BASE_URL || null
          : "https://example.invalid/v1",
      anthropicApiKey: this.mode === "live" ? process.env.ANTHROPIC_API_KEY || null : null,
      geminiApiKey: this.mode === "live" ? process.env.GEMINI_API_KEY || null : null,
      screenshotOneApiKey: null,
      isImageGenerationEnabled: true,
      editorTheme: "cobalt",
      generatedCodeConfig: "html_tailwind",
      codeGenerationModel:
        (process.env.AGENT_QA_MODEL as CodeGenerationModel | undefined) ||
        CodeGenerationModel.DOUBAO_SEED_2_0_MINI_260428,
      selectedDesignSystemId: null,
      isTermOfServiceAccepted: true,
    };

    await this.page.evaluate((nextSetting) => {
      localStorage.setItem("setting", JSON.stringify(nextSetting));
    }, setting);
  }

  async takeScreenshot(name: string): Promise<string> {
    const filePath = path.join(RESULTS_DIR, `${name}.png`);
    await this.page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async switchToTab(testId: string) {
    await this.page.click(`[data-testid="${testId}"]`);
  }

  async clearAndType(selector: string, text: string) {
    await this.page.waitForSelector(selector, { timeout: 15000 });
    await this.page.click(selector, { clickCount: 3 });
    await this.page.keyboard.press("Backspace");
    await this.page.type(selector, text);
  }

  async ensureEditorOpen() {
    await this.runQaControl("openEditor");
    await this.page.waitForSelector('[data-testid="update-input"]', {
      timeout: 20000,
    });
  }

  async waitForVersion(versionNumber: number) {
    await this.page.waitForFunction(
      (expectedVersion) =>
        document.body.innerText.includes(`Version ${expectedVersion}`),
      { timeout: 20000 },
      versionNumber
    );
  }

  async waitForPreviewText(text: string) {
    await this.page.waitForFunction(
      (expectedText) => {
        const iframe = document.querySelector(
          "#preview-desktop"
        ) as HTMLIFrameElement | null;
        const previewText = iframe?.contentDocument?.body?.innerText || "";
        return previewText.toLowerCase().includes(String(expectedText).toLowerCase());
      },
      { timeout: 20000 },
      text
    );
  }

  async assertPreviewContains(text: string) {
    await this.waitForPreviewText(text);
  }

  async assertPrimaryDraftVisible() {
    await this.page.waitForFunction(() => {
      const iframe = document.querySelector(
        "#preview-desktop"
      ) as HTMLIFrameElement | null;
      const previewText = iframe?.contentDocument?.body?.innerText || "";
      return (
        previewText.trim().length > 0 &&
        !previewText.includes("Preview pending") &&
        !previewText.includes("No renderable preview yet")
      );
    }, { timeout: this.mode === "live" ? 180000 : 20000 });
  }

  async assertPageContains(text: string) {
    await this.page.waitForFunction(
      (expectedText) => document.body.innerText.includes(expectedText),
      { timeout: 15000 },
      text
    );
  }

  async readQaSnapshot(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => {
      const snapshot = (window as typeof window & {
        __agentQaSnapshot?: () => unknown;
      }).__agentQaSnapshot;
      return (snapshot?.() as Record<string, unknown>) || {};
    });
  }

  async assertTargetingScore(minimumScore: number) {
    await this.page.waitForFunction(
      (score) => {
        const snapshot = (window as typeof window & {
          __agentQaSnapshot?: () => {
            activeVariant?: {
              diagnostics?: {
                targeting?: { score?: number };
              };
            };
          };
        }).__agentQaSnapshot?.();
        return (
          (snapshot?.activeVariant?.diagnostics?.targeting?.score || 0) >= score
        );
      },
      { timeout: this.mode === "live" ? 180000 : 20000 },
      minimumScore
    );
  }

  async assertImageUpdateStatus(expectedStatus: "ok" | "error") {
    await this.page.waitForFunction(
      (status) => {
        const snapshot = (window as typeof window & {
          __agentQaSnapshot?: () => {
            activeVariant?: {
              diagnostics?: {
                imageUpdateStatus?: { status?: string };
              };
            };
          };
        }).__agentQaSnapshot?.();
        return (
          snapshot?.activeVariant?.diagnostics?.imageUpdateStatus?.status === status
        );
      },
      { timeout: this.mode === "live" ? 180000 : 20000 },
      expectedStatus
    );
  }

  async generateFromText(prompt: string, screenshotPrefix: string) {
    const screenshots: string[] = [];
    await this.switchToTab("tab-text");
    await this.clearAndType('[data-testid="text-input"]', prompt);
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_typed`));
    await this.page.click('[data-testid="text-generate"]');
    await this.waitForVersion(1);
    await this.ensureEditorOpen();
    if (this.mode === "mock") {
      await this.waitForPreviewText("Base Music Home");
    } else {
      await this.assertPrimaryDraftVisible();
    }
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_done`));
    return screenshots;
  }

  async update(
    prompt: string,
    versionNumber: number,
    expectedPreviewText: string,
    screenshotPrefix: string
  ) {
    const screenshots: string[] = [];
    await this.ensureEditorOpen();
    await this.clearAndType('[data-testid="update-input"]', prompt);
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_typed`));
    await this.page.click(".update-btn");
    await this.waitForVersion(versionNumber);
    await this.ensureEditorOpen();
    if (this.mode === "mock") {
      await this.waitForPreviewText(expectedPreviewText);
    } else {
      await this.assertPrimaryDraftVisible();
    }
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_done`));
    return screenshots;
  }

  async getPreviewFrame() {
    await this.page.waitForSelector("#preview-desktop", {
      timeout: this.mode === "live" ? 60000 : 15000,
    });
    const handle = await this.page.$("#preview-desktop");
    const frame = await handle?.contentFrame();
    if (!frame) {
      throw new Error("Preview iframe is not ready");
    }
    return frame;
  }

  async selectTarget(strategy: "media-controls" | "hero-image") {
    await this.page.click('[data-testid="select-edit-toggle"]');
    const frame = await this.getPreviewFrame();
    if (strategy === "media-controls") {
      const playButton = await frame.waitForSelector("button", { timeout: 30000 });
      await playButton?.click();
    } else {
      const image = await frame.waitForSelector("img", { timeout: 30000 });
      if (image) {
        await image.click();
      } else {
        const heroBlock = await frame.waitForSelector("section, .hero, header", {
          timeout: 30000,
        });
        await heroBlock?.click();
      }
    }
    await this.page.waitForFunction(
      () => document.body.innerText.includes("Selected:"),
      { timeout: 15000 }
    );
  }

  async openHistory() {
    await this.runQaControl("openHistory");
    await this.page.waitForSelector('[data-testid="history-item-version-1"]', {
      timeout: 15000,
    });
    await this.page.click('[data-testid="history-item-version-1"]');
    await this.page.waitForSelector('[data-testid="rollback-version-1"]', {
      timeout: 15000,
    });
  }

  async rollbackToVersion(versionNumber: number, screenshotPrefix: string) {
    const screenshots: string[] = [];
    await this.rollbackToVersionByControl(versionNumber);
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_after`));
    await this.ensureEditorOpen();
    return screenshots;
  }

  async createNewProject() {
    const previousWorkspaceId = await this.readActiveWorkspaceId();
    await this.runQaControl("createNewProject");
    await this.page.waitForFunction(
      (currentWorkspaceId) => {
        const snapshot = (window as typeof window & {
          __agentQaSnapshot?: () => { workspaceId?: string };
        }).__agentQaSnapshot?.();
        return Boolean(
          snapshot?.workspaceId && snapshot.workspaceId !== currentWorkspaceId
        );
      },
      { timeout: 15000 },
      previousWorkspaceId
    );
  }

  async readActiveWorkspaceId(): Promise<string> {
    return this.page.evaluate(() => {
      const snapshot = (window as typeof window & {
        __agentQaSnapshot?: () => { workspaceId?: string };
      }).__agentQaSnapshot?.();
      if (snapshot?.workspaceId) {
        return snapshot.workspaceId;
      }
      const storedValue = localStorage.getItem("workspace-active-id-v1");
      const persistedWorkspaceId = localStorage.getItem("workspace-id");
      const value = storedValue || persistedWorkspaceId;
      if (!value) {
        throw new Error("Active workspace id was not found");
      }
      return value;
    });
  }

  async restoreWorkspace(workspaceId: string, screenshotPrefix: string) {
    const screenshots: string[] = [];
    const restored = await this.openWorkspaceById(workspaceId);
    if (!restored) {
      throw new Error(`Failed to restore workspace ${workspaceId}`);
    }
    await this.page.waitForFunction(
      (expectedWorkspaceId) => {
        const snapshot = (window as typeof window & {
          __agentQaSnapshot?: () => { workspaceId?: string };
        }).__agentQaSnapshot?.();
        return snapshot?.workspaceId === expectedWorkspaceId;
      },
      { timeout: 20000 },
      workspaceId
    );
    if (this.mode === "mock") {
      await this.waitForPreviewText("Base Music Home");
    } else {
      await this.assertPrimaryDraftVisible();
    }
    screenshots.push(await this.takeScreenshot(`${screenshotPrefix}_done`));
    return screenshots;
  }
}

async function writeAgentQaReport(results: CaseResult[]) {
  const runId = `qa_${QA_MODE}_${Date.now()}`;
  const durationValues = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) => {
    if (durationValues.length === 0) return null;
    const index = Math.min(
      durationValues.length - 1,
      Math.max(0, Math.ceil(durationValues.length * p) - 1)
    );
    return durationValues[index];
  };
  const passedCases = results.filter((result) => result.pass).length;
  const failedCases = results.length - passedCases;
  const totalDurationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
  const lines = [
    "# Agent QA Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${QA_MODE}`,
    "",
    "| Case | Result | Duration | Notes |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => {
      const notes = [
        ...result.notes,
        ...(result.error ? [`Error: ${result.error}`] : []),
      ].join("<br/>");
      return `| ${result.title} | ${result.pass ? "PASS" : "FAIL"} | ${(
        result.durationMs / 1000
      ).toFixed(1)}s | ${notes || "-"} |`;
    }),
    "",
    "## Screenshots",
    "",
    ...results.flatMap((result) => [
      `### ${result.title}`,
      ...(result.screenshots.length > 0
        ? result.screenshots.map(
            (screenshot) =>
              `- ${path.relative(RESULTS_DIR, screenshot) || path.basename(screenshot)}`
          )
        : ["- none"]),
      "",
    ]),
  ];

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
  const payload = {
    version: 1,
    run_id: runId,
    mode: QA_MODE,
    created_at: new Date().toISOString(),
    duration_ms: totalDurationMs,
    summary: {
      total_cases: results.length,
      passed_cases: passedCases,
      failed_cases: failedCases,
      success_rate: results.length > 0 ? passedCases / results.length : 0,
      p50_duration_ms: percentile(0.5),
      p95_duration_ms: percentile(0.95),
    },
    case_results: results,
  };
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
  const jsonPath = path.join(
    BACKEND_AGENT_QA_DIR,
    `agent_qa_run_${timestamp}_${runId}.json`
  );
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
}

async function fetchPromptReportsSince(startedAtMs: number): Promise<PromptReportSummary[]> {
  if (QA_MODE !== "live") {
    return [];
  }
  try {
    const response = await fetch(`${BACKEND_URL}/prompt-reports`);
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      reports?: Array<{ filename: string; created_at: string }>;
    };
    return (payload.reports || []).filter((report) => {
      const createdAtMs = Date.parse(report.created_at);
      return Number.isFinite(createdAtMs) && createdAtMs >= startedAtMs - 5000;
    });
  } catch {
    return [];
  }
}

async function installMockWebSocket(page: Page) {
  await page.evaluateOnNewDocument(() => {
    const buildBaseMusicHome = () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QA Base</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #111; color: #f5f5f5; padding: 32px; }
      .hero, .panel { border-radius: 20px; background: #1d1d1f; padding: 24px; margin-bottom: 24px; }
      .controls { display: flex; gap: 12px; margin-top: 16px; }
      .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
      .card { background: #18181b; border-radius: 16px; padding: 16px; min-height: 120px; }
    </style>
  </head>
  <body>
    <div>qa-state: base-home</div>
    <div class="hero">
      <h1>Base Music Home</h1>
      <h2>Featured</h2>
      <p>Midnight Melodies</p>
      <div class="controls"><button>Back</button><button>Play</button><button>Next</button></div>
    </div>
    <div class="panel">
      <h2>Recently Played</h2>
      <div class="cards">
        <div class="card">Ruby</div>
        <div class="card">Hello Kitty</div>
        <div class="card">Eclipse</div>
        <div class="card">Nova</div>
      </div>
    </div>
  </body>
</html>`;

    const buildControlsCentered = () => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#111;color:#f5f5f5;padding:32px}.hero,.panel{border-radius:20px;background:#1d1d1f;padding:24px;margin-bottom:24px}.control-row{display:flex;justify-content:center;gap:16px;margin:12px 0 24px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{background:#18181b;border-radius:16px;padding:16px;min-height:120px}</style></head>
  <body>
    <div>qa-state: controls-centered</div>
    <div class="hero">
      <h1>Base Music Home</h1>
      <div class="control-row"><button>Back</button><button>Play</button><button>Next</button></div>
      <h2>Featured</h2>
      <p>Midnight Melodies</p>
    </div>
    <div class="panel"><h2>Recently Played</h2><div class="cards"><div class="card">Ruby</div><div class="card">Hello Kitty</div><div class="card">Eclipse</div><div class="card">Nova</div></div></div>
  </body>
</html>`;

    const buildCuteHero = () => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#111;color:#f5f5f5;padding:32px}.hero,.panel{border-radius:20px;background:#1d1d1f;padding:24px;margin-bottom:24px}.hero-visual{height:220px;border-radius:18px;background:linear-gradient(135deg,#f7d7ff,#ffd6e7);display:flex;align-items:center;justify-content:center;color:#222;font-size:32px;font-weight:700;margin-bottom:16px}.controls{display:flex;gap:12px;margin-top:16px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{background:#18181b;border-radius:16px;padding:16px;min-height:120px}</style></head>
  <body>
    <div>qa-state: cute-hero</div>
    <div class="hero">
      <div class="hero-visual">Hello Kitty / Ruby Hero</div>
      <h1>Base Music Home</h1>
      <h2>Featured</h2>
      <p>Midnight Melodies</p>
      <div class="controls"><button>Back</button><button>Play</button><button>Next</button></div>
    </div>
    <div class="panel"><h2>Recently Played</h2><div class="cards"><div class="card">Ruby</div><div class="card">Hello Kitty</div><div class="card">Eclipse</div><div class="card">Nova</div></div></div>
  </body>
</html>`;

    const buildEditorialRefine = () => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>body{margin:0;font-family:Georgia,serif;background:#111;color:#f5f5f5;padding:48px}.hero,.panel{border-radius:24px;background:#17171a;padding:36px;margin-bottom:32px}.eyebrow{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#a1a1aa;margin-bottom:18px}.editorial-space{margin-top:28px}.controls{display:flex;gap:14px;margin-top:18px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.card{background:#1f1f23;border-radius:18px;padding:18px;min-height:128px}</style></head>
  <body>
    <div>qa-state: editorial-refine</div>
    <div class="hero">
      <div class="eyebrow">Editorial spacing</div>
      <h1>Base Music Home</h1>
      <h2 class="editorial-space">Featured</h2>
      <p>Midnight Melodies with quieter hierarchy and more breathing room.</p>
      <div class="controls"><button>Back</button><button>Play</button><button>Next</button></div>
    </div>
    <div class="panel"><h2>Recently Played</h2><div class="cards"><div class="card">Ruby</div><div class="card">Hello Kitty</div><div class="card">Eclipse</div><div class="card">Nova</div></div></div>
  </body>
</html>`;

    const resolveHtml = (params: any) => {
      const promptText =
        params?.prompt?.fullText || params?.prompt?.text || "";
      const normalized = String(promptText).toLowerCase();
      if (params?.generationType === "update") {
        if (
          normalized.includes("播放") ||
          normalized.includes("前进") ||
          normalized.includes("后退") ||
          normalized.includes("first row")
        ) {
          return buildControlsCentered();
        }
        if (
          normalized.includes("hello kitty") ||
          normalized.includes("ruby") ||
          normalized.includes("主视觉图片")
        ) {
          return buildCuteHero();
        }
        if (
          normalized.includes("高级") ||
          normalized.includes("留白") ||
          normalized.includes("排版")
        ) {
          return buildEditorialRefine();
        }
      }
      return buildBaseMusicHome();
    };

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = MockWebSocket.CONNECTING;
      url: string;
      listeners: Record<string, Array<(event: unknown) => void>> = {};

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.emit("open", {});
        }, 10);
      }

      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!this.listeners[type]) {
          this.listeners[type] = [];
        }
        this.listeners[type].push(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void) {
        if (!this.listeners[type]) return;
        this.listeners[type] = this.listeners[type].filter(
          (existing) => existing !== listener
        );
      }

      send(data: string) {
        const params = JSON.parse(data);
        const code = resolveHtml(params);
        const promptText =
          params?.prompt?.fullText || params?.prompt?.text || "";
        const normalized = String(promptText).toLowerCase();
        const events = [
          { type: "variantCount", value: "1", variantIndex: 0 },
          { type: "variantModels", data: { models: ["doubao-seed-2-0-mini-260428"] }, variantIndex: 0 },
          { type: "status", value: "Generating", variantIndex: 0 },
          { type: "thinking", value: "Thinking through the revision...", variantIndex: 0, eventId: `thinking-${Date.now()}` },
          { type: "assistant", value: "Applying the requested design update.", variantIndex: 0, eventId: `assistant-${Date.now()}` },
          { type: "setCode", value: code, variantIndex: 0 },
          {
            type: "variantMetrics",
            variantIndex: 0,
            data: {
              stageTimings: {
                requestParseMs: 5,
                promptBuildMs: 18,
                modelGenerationMs: 160,
                toolRuntimeMs: 32,
                imageGenerationMs:
                  normalized.includes("hello kitty") ||
                  normalized.includes("ruby") ||
                  normalized.includes("主视觉图片")
                    ? 420
                    : 0,
                previewSelfCheckMs: 12,
              },
              targeting:
                params?.generationType === "update"
                  ? {
                      score:
                        normalized.includes("播放") ||
                        normalized.includes("前进") ||
                        normalized.includes("后退") ||
                        normalized.includes("first row")
                          ? 0.92
                          : normalized.includes("hello kitty") ||
                              normalized.includes("ruby") ||
                              normalized.includes("主视觉图片")
                            ? 0.88
                            : 0.8,
                      changedInsideTarget: true,
                      preservedOutsideTarget: true,
                      intentMatched: true,
                      collateralDamage: false,
                      changedSignals: [
                        normalized.includes("播放") ||
                        normalized.includes("前进") ||
                        normalized.includes("后退") ||
                        normalized.includes("first row")
                          ? "controls-centered"
                          : normalized.includes("hello kitty") ||
                              normalized.includes("ruby") ||
                              normalized.includes("主视觉图片")
                            ? "hero-image-updated"
                            : "style-refined",
                      ],
                    }
                  : undefined,
              imageUpdateStatus:
                normalized.includes("hello kitty") ||
                normalized.includes("ruby") ||
                normalized.includes("主视觉图片")
                  ? {
                      operation: "edit",
                      status: "ok",
                      persistedAssetUrl: "http://127.0.0.1:7001/local-assets/mock-hero.png",
                    }
                  : undefined,
              failureStage: null,
            },
          },
          { type: "variantComplete", value: "", variantIndex: 0 },
        ];

        events.forEach((payload, index) => {
          window.setTimeout(() => {
            this.emit("message", { data: JSON.stringify(payload) });
          }, 40 * (index + 1));
        });

        window.setTimeout(() => {
          this.close(1000, "OK");
        }, 360);
      }

      close(code = 1000, reason = "") {
        this.readyState = MockWebSocket.CLOSED;
        this.emit("close", { code, reason });
      }

      emit(type: string, event: unknown) {
        (this.listeners[type] || []).forEach((listener) => {
          listener(event);
        });
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });
}
