export interface AgentRegressionCase {
  id: string;
  title: string;
  workspaceSeed: string;
  selectionStrategy: "none" | "media-controls" | "hero-image";
  setup: string;
  request: string;
  expectedSignals: string[];
  assertions: string[];
  checks: string[];
}

export const AGENT_REGRESSION_CASES: AgentRegressionCase[] = [
  {
    id: "first-draft-create",
    title: "首稿创建",
    workspaceSeed: "music-home-dark-editorial",
    selectionStrategy: "none",
    setup: "新 workspace，文本生成",
    request: "做一个音乐 App 首页，暗色、极简、杂志感。",
    expectedSignals: ["visible-preview", "single-main-draft", "renderable-html"],
    assertions: ["preview-visible", "version-created", "history-seeded"],
    checks: [
      "能稳定生成可见页面",
      "不是空白页，也不是说明文案页",
      "首屏结构完整，有导航、主视觉或内容层级",
    ],
  },
  {
    id: "targeted-layout-edit",
    title: "局部按钮布局修改",
    workspaceSeed: "music-home-dark-editorial",
    selectionStrategy: "media-controls",
    setup: "选中一个控件区后再更新",
    request:
      "只调整这组播放控制按钮的位置，把播放、前进、后退按钮移动到第一行居中，保留封面、时间和其他区域不变。",
    expectedSignals: ["target-hit", "controls-centered", "preserve-outside-target"],
    assertions: ["targeting-pass", "visible-change", "no-collateral-damage"],
    checks: [
      "只改被选中的模块",
      "按钮位置出现明显变化",
      "相邻 section 不被误伤",
    ],
  },
  {
    id: "image-local-update",
    title: "图片局部更新",
    workspaceSeed: "music-home-dark-editorial",
    selectionStrategy: "hero-image",
    setup: "选中 hero / image block 后更新",
    request:
      "只修改当前主视觉图片，让它更偏 Hello Kitty / Ruby 风格，保留标题、按钮和整体布局不变。",
    expectedSignals: ["image-edit", "layout-preserved", "asset-lineage"],
    assertions: ["image-status-ok", "targeting-pass", "text-preserved"],
    checks: [
      "图片变化聚焦在目标区域",
      "文案和布局仍然保留",
      "不会整页重画成另一种结构",
    ],
  },
  {
    id: "style-refinement",
    title: "风格收敛",
    workspaceSeed: "music-home-dark-editorial",
    selectionStrategy: "none",
    setup: "不选元素，基于当前稿继续改",
    request:
      "保持页面结构不变，不换题。只把整体视觉再高级一点，增加留白和更精致的排版层级。",
    expectedSignals: ["editorial-spacing", "same-topic", "preview-pass"],
    assertions: ["renderable-html", "same-workspace", "style-change-visible"],
    checks: [
      "结构基本不变",
      "页面有明确但克制的风格提升",
      "不是重新生成另一个题材",
    ],
  },
  {
    id: "workspace-restore-rollback",
    title: "工作区恢复与回滚",
    workspaceSeed: "music-home-dark-editorial",
    selectionStrategy: "none",
    setup: "做过至少 2 轮修改后测试",
    request: "点击历史里的回滚按钮，再刷新页面并重新打开最近工作区。",
    expectedSignals: ["rollback-works", "restore-works", "same-history-chain"],
    assertions: ["rollback-visible", "workspace-restored", "history-intact"],
    checks: [
      "能显式回到旧版本",
      "刷新/重开后仍能恢复当前工作区",
      "历史链条和后续编辑基线正确",
    ],
  },
];
