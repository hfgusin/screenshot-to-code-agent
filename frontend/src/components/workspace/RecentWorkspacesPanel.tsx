import { WorkspaceSummary } from "../../lib/workspace-storage";

interface Props {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  onOpenWorkspace: (id: string) => void;
}

function RecentWorkspacesPanel({
  workspaces,
  activeWorkspaceId,
  onOpenWorkspace,
}: Props) {
  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Recent Workspaces
        </h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Up to 5
        </span>
      </div>
      <div className="space-y-2">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => void onOpenWorkspace(workspace.id)}
              data-testid={`recent-workspace-${workspace.id}`}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                isActive
                  ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
                  : "border-gray-200 hover:border-gray-300 dark:border-zinc-800 dark:hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {workspace.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                    {workspace.summary}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
                  {isActive ? "Open" : "Load"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default RecentWorkspacesPanel;
