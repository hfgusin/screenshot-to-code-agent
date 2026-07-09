import { Link } from "react-router-dom";

function EvalNavigation() {
  return (
    <div className="flex justify-between items-center w-full py-3 px-4 bg-zinc-900 text-white">
      <div className="flex items-center space-x-4">
        <Link
          to="/evals"
          className="font-medium hover:text-blue-300 transition-colors"
        >
          评测首页
        </Link>
        
        <div className="text-gray-500">|</div>
        
        <Link
          to="/evals/run"
          className="hover:text-blue-300 transition-colors"
        >
          运行
        </Link>
        
        <Link
          to="/evals/best-of-n"
          className="hover:text-blue-300 transition-colors"
        >
          多选优胜
        </Link>
        
        <Link
          to="/evals/openai-input-compare"
          className="hover:text-blue-300 transition-colors"
        >
          输入对比
        </Link>

        <Link
          to="/evals/prompt-reports"
          className="hover:text-blue-300 transition-colors"
        >
          Prompt 报告
        </Link>

        <Link
          to="/evals/agent-qa"
          className="hover:text-blue-300 transition-colors"
        >
          Agent 质检
        </Link>
      </div>
      
      <Link
        to="/"
        className="text-sm text-gray-300 hover:text-white transition-colors"
      >
        ← 返回应用
      </Link>
    </div>
  );
}

export default EvalNavigation;
