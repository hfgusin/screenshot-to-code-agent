import { AGENT_REGRESSION_CASES } from "../../lib/agent-regression-cases";

function AgentRegressionPanel() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
          Regression pack
        </h3>
        <span className="text-[10px] text-gray-400 dark:text-zinc-500">
          fixed 5 cases
        </span>
      </div>
      <div className="space-y-2">
        {AGENT_REGRESSION_CASES.map((testCase, index) => (
          <div
            key={testCase.id}
            className="rounded-xl border border-gray-200 px-3 py-3 dark:border-zinc-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-950 dark:text-zinc-100">
                  {index + 1}. {testCase.title}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Setup: {testCase.setup}
                </div>
                <div className="mt-1 text-xs text-gray-700 dark:text-zinc-300">
                  {testCase.request}
                </div>
              </div>
            </div>
            <ul className="mt-2 list-disc pl-4 text-xs text-gray-500 dark:text-zinc-400">
              {testCase.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentRegressionPanel;
