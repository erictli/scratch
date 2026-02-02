import { useState } from "react";
import { ArrowLeftIcon, FolderIcon, SwatchIcon, GitBranchIcon } from "../icons";
import { Button, IconButton } from "../ui";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { GitSettingsSection } from "./GitSettingsSection";

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsTab = "general" | "appearance" | "git";

const tabs: { id: SettingsTab; label: string; icon: typeof FolderIcon }[] = [
  { id: "general", label: "General", icon: FolderIcon },
  { id: "appearance", label: "Appearance", icon: SwatchIcon },
  { id: "git", label: "Version Control", icon: GitBranchIcon },
];

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="h-full flex bg-bg w-full">
      {/* Sidebar - matches main Notes sidebar */}
      <div className="w-64 h-full bg-bg-secondary border-r border-border flex flex-col select-none">
        {/* Drag region */}
        <div className="h-11 shrink-0" data-tauri-drag-region></div>

        {/* Header with back button and Settings title */}
        <div className="flex items-center justify-between px-3 pb-2 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            <IconButton onClick={onBack} title="Back (⌘,)">
              <ArrowLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
            <div className="font-medium text-base">Settings</div>
          </div>
        </div>

        {/* Navigation tabs */}
        <nav className="flex-1 p-2 flex flex-col gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className="justify-start gap-2.5 h-9"
              >
                <Icon className="w-4.5 h-4.5 stroke-[1.5]" />
                {tab.label}
              </Button>
            );
          })}
        </nav>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col bg-bg overflow-hidden">
        {/* Drag region */}
        <div className="h-11 shrink-0" data-tauri-drag-region></div>

        {/* Content - centered with max width */}
        <div className="flex-1 overflow-auto">
          <div className="w-full max-w-3xl mx-auto px-8 py-4">
            {activeTab === "general" && <GeneralSettingsSection />}
            {activeTab === "appearance" && <AppearanceSettingsSection />}
            {activeTab === "git" && <GitSettingsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
