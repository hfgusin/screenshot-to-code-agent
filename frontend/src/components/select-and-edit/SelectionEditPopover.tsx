import { FormEvent, useEffect, useRef, useState } from "react";
import { LuArrowUp, LuMousePointerClick, LuX } from "react-icons/lu";
import { EditableElementDescription } from "./utils";
import { PopoverPosition } from "./positioning";

interface Props {
  description: EditableElementDescription;
  instruction: string;
  isSubmitting: boolean;
  position: PopoverPosition;
  onInstructionChange: (instruction: string) => void;
  onSubmit: () => void | Promise<void>;
  onReselect: () => void;
  onCancel: () => void;
}

const QUICK_ACTIONS = [
  { label: "精简", instruction: "精简这段内容，保留关键信息。" },
  { label: "润色", instruction: "润色这段内容，让表达更专业、自然。" },
  { label: "删除", instruction: "删除选中的内容，并保持周围布局自然。" },
];

export function SelectionEditPopover({
  description,
  instruction,
  isSubmitting,
  position,
  onInstructionChange,
  onSubmit,
  onReselect,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isLocallySubmitting, setIsLocallySubmitting] = useState(false);
  const submitDisabled = isSubmitting || isLocallySubmitting;

  const executeSubmit = () => {
    setIsLocallySubmitting(true);
    Promise.resolve(onSubmit()).finally(() => setIsLocallySubmitting(false));
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, [description.accessibleLabel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!instruction.trim() || submitDisabled) return;
    executeSubmit();
  };

  return (
    <form
      onSubmit={submit}
      data-testid="selection-edit-popover"
      className="absolute z-50 w-[min(21rem,calc(100%-1.5rem))] rounded-2xl border border-violet-200 bg-white p-3 shadow-2xl shadow-violet-950/20 dark:border-violet-700 dark:bg-zinc-900"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <LuMousePointerClick className="h-3.5 w-3.5 shrink-0" />
            已选择{description.kind}
          </div>
          {description.preview !== "无可见文字" && (
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-zinc-400">
              “{description.preview}”
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          title="取消选择"
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <LuX className="h-4 w-4" />
        </button>
      </div>

      <textarea
        ref={inputRef}
        value={instruction}
        onChange={(event) => onInstructionChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (instruction.trim() && !submitDisabled) {
              executeSubmit();
            }
          }
        }}
        rows={2}
        placeholder={`告诉 AI 你想怎样修改这段${description.kind}…`}
        className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-5 text-gray-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-violet-500 dark:focus:bg-zinc-900 dark:focus:ring-violet-900/40"
      />
      <p className="mt-1.5 text-[11px] leading-4 text-gray-400 dark:text-zinc-500">
        明确替换会即时完成；润色、精简等修改将由 AI 处理。
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                onInstructionChange(action.instruction);
                inputRef.current?.focus();
              }}
              className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-violet-100 hover:text-violet-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-violet-900/40 dark:hover:text-violet-300"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onReselect}
            className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            重新选择
          </button>
        </div>
        <button
          type="submit"
          disabled={!instruction.trim() || submitDisabled}
          title="提交修改"
          className="shrink-0 rounded-lg bg-violet-600 p-2 text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-zinc-700"
        >
          <LuArrowUp className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
