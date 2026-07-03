import React from "react";
import { DesignSession, DesignSystem, Settings } from "../../types";
import { Stack } from "../../lib/stacks";
import UnifiedInputPane from "../unified-input/UnifiedInputPane";
import DesignSessionPanel from "../design-session/DesignSessionPanel";
import RecentWorkspacesPanel from "../workspace/RecentWorkspacesPanel";
import { WorkspaceSummary } from "../../lib/workspace-storage";

interface Props {
  doCreate: (
    images: string[],
    inputMode: "image" | "video",
    textPrompt?: string
  ) => void | Promise<void>;
  doCreateFromText: (text: string) => void | Promise<void>;
  importFromCode: (code: string, stack: Stack) => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  designSession: DesignSession;
  setDesignSession: React.Dispatch<React.SetStateAction<DesignSession>>;
  designSystems: DesignSystem[];
  onAddNewDesignSystem: () => void;
  onManageDesignSystems: () => void;
  workspaceId: string;
  recentWorkspaces: WorkspaceSummary[];
  onOpenWorkspace: (id: string) => Promise<boolean>;
}

const StartPane: React.FC<Props> = ({
  doCreate,
  doCreateFromText,
  importFromCode,
  settings,
  setSettings,
  designSession,
  setDesignSession,
  designSystems,
  onAddNewDesignSystem,
  onManageDesignSystems,
  workspaceId,
  recentWorkspaces,
  onOpenWorkspace,
}) => {
  return (
    <div className="flex flex-col justify-center items-center py-8">
      <div className="w-full max-w-4xl space-y-6 px-4">
        <DesignSessionPanel
          designSession={designSession}
          setDesignSession={setDesignSession}
          compact
        />
        <RecentWorkspacesPanel
          workspaces={recentWorkspaces}
          activeWorkspaceId={workspaceId}
          onOpenWorkspace={onOpenWorkspace}
        />
        <UnifiedInputPane
          doCreate={doCreate}
          doCreateFromText={doCreateFromText}
          importFromCode={importFromCode}
          settings={settings}
          setSettings={setSettings}
          designSystems={designSystems}
          onAddNewDesignSystem={onAddNewDesignSystem}
          onManageDesignSystems={onManageDesignSystems}
        />
      </div>
    </div>
  );
};

export default StartPane;
