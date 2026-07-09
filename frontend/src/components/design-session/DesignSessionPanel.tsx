import React from "react";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { DesignSession } from "../../types";

interface Props {
  designSession: DesignSession;
  setDesignSession: React.Dispatch<React.SetStateAction<DesignSession>>;
  compact?: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  compact?: boolean;
}) {
  const common =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      {compact ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={common}
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${common} min-h-20`}
        />
      )}
    </label>
  );
}

function DesignSessionPanel({
  designSession,
  setDesignSession,
  compact = false,
}: Props) {
  const updateField = <K extends keyof DesignSession>(key: K, value: string) => {
    setDesignSession((prev) => ({
      ...prev,
      [key]: value,
      lastUpdatedAt: new Date().toISOString(),
    }));
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            设计会话
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
            多轮修改会持续复用的设计简报。
          </p>
        </div>
        <Badge variant="secondary" className="rounded-full px-2.5 py-1">
          多轮
        </Badge>
      </div>

      <div className={compact ? "grid gap-3" : "grid gap-4"}>
        <Field
          label="目标"
          value={designSession.goal}
          onChange={(value) => updateField("goal", value)}
          placeholder="这个设计最终要达成什么效果？"
          compact={compact}
        />
        <Field
          label="风格"
          value={designSession.style}
          onChange={(value) => updateField("style", value)}
          placeholder="编辑感、高级感、数据密集、极简..."
          compact={compact}
        />
        <Field
          label="约束"
          value={designSession.constraints}
          onChange={(value) => updateField("constraints", value)}
          placeholder="允许使用的组件、品牌规则、必须保留的内容..."
          compact={compact}
        />
        <Field
          label="参考"
          value={designSession.references}
          onChange={(value) => updateField("references", value)}
          placeholder="URL、产品、截图，或简短备注"
          compact={compact}
        />
      </div>

      {(designSession.lastIntent ||
        designSession.intentReason ||
        designSession.intentSignals?.length ||
        designSession.pendingQuestion ||
        designSession.reviewSummary) && (
        <div className="mt-4 grid gap-2">
          {designSession.lastIntent && (
            <div className="rounded-xl border border-violet-200/80 bg-violet-50/70 px-3 py-2 text-xs dark:border-violet-900/50 dark:bg-violet-950/20">
              <div className="mb-1 font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                最近意图
              </div>
              <div className="text-violet-900 dark:text-violet-100">
                {designSession.lastIntent}
              </div>
              {typeof designSession.intentConfidence === "number" && (
                <div className="mt-1 text-violet-700 dark:text-violet-300">
                  置信度 {(designSession.intentConfidence * 100).toFixed(0)}%
                </div>
              )}
              {designSession.intentReason && (
                <div className="mt-1 text-violet-700/90 dark:text-violet-300/90">
                  {designSession.intentReason}
                </div>
              )}
              {!!designSession.intentSignals?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {designSession.intentSignals.map((signal) => (
                    <span
                      key={signal}
                      className="rounded-full border border-violet-200 bg-white/80 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-700 dark:border-violet-900/50 dark:bg-zinc-900 dark:text-violet-200"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {designSession.pendingQuestion && (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="mb-1 font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                待补充问题
              </div>
              <div className="text-amber-900 dark:text-amber-100">
                {designSession.pendingQuestion}
              </div>
            </div>
          )}
          {designSession.reviewSummary && (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="mb-1 font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                审查摘要
              </div>
              <div className="text-emerald-900 dark:text-emerald-100">
                {designSession.reviewSummary}
              </div>
            </div>
          )}
        </div>
      )}

      {!!designSession.revisionLog.length && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
              修订轨迹
            </span>
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              {designSession.revisionLog.length} 条
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {designSession.revisionLog.slice(-4).map((entry, index) => (
              <span
                key={`${entry}-${index}`}
                className="max-w-full rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                title={entry}
              >
                {entry}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default DesignSessionPanel;
