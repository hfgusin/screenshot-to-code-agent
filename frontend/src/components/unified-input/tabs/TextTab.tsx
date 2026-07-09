import { useState, useRef, useEffect } from "react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import toast from "react-hot-toast";
import OutputSettingsSection from "../../settings/OutputSettingsSection";
import { DesignSystemSelectorProps } from "../../settings/DesignSystemSelector";
import { Stack } from "../../../lib/stacks";

interface Props {
  doCreateFromText: (text: string) => void | Promise<void>;
  stack: Stack;
  setStack: (stack: Stack) => void;
  designSystem: DesignSystemSelectorProps;
}

const EXAMPLE_PROMPTS = [
  "环保护肤品牌电商首页，包含商品网格、用户评价和订阅入口",
  "产品设计师作品集网站，包含案例研究、设计流程和联系方式",
  "移动健身 app 仪表盘，包含训练计划、进度环和快速开始按钮",
  "音乐播放 app，包含正在播放、推荐歌单和最近收听",
];

function TextTab({ doCreateFromText, stack, setStack, designSystem }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleGenerate = () => {
    if (text.trim() === "") {
      toast.error("请先输入描述");
      return;
    }
    doCreateFromText(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleExampleClick = (example: string) => {
    setText(example);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6 p-8 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50/50 dark:bg-zinc-900/50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400 dark:text-zinc-500"
              >
                <path d="M17 6.1H3" />
                <path d="M21 12.1H3" />
                <path d="M15.1 18H3" />
              </svg>
            </div>

            <div className="text-center">
              <h3 className="text-gray-700 dark:text-zinc-200 font-medium">根据文字生成</h3>
            </div>
          </div>

          <div className="space-y-4">
            <Textarea
              ref={textareaRef}
              rows={4}
              placeholder="描述你想生成的 UI..."
              className="w-full resize-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              data-testid="text-input"
            />

            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-500 dark:text-zinc-400">试试示例：</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleExampleClick(example)}
                    className="text-xs px-2.5 py-1.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors truncate max-w-[200px]"
                    title={example}
                  >
                    {example.length > 30 ? example.slice(0, 30) + "..." : example}
                  </button>
                ))}
              </div>
            </div>

            <OutputSettingsSection
              stack={stack}
              setStack={setStack}
              designSystem={designSystem}
            />

            <Button
              onClick={handleGenerate}
              className="w-full"
              size="lg"
              data-testid="text-generate"
            >
              生成
            </Button>

            <p className="text-xs text-gray-400 dark:text-zinc-500 text-center">
              按 Cmd/Ctrl + Enter 生成
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextTab;
