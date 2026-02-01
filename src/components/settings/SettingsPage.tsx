import { useState } from "react";
import { ArrowLeftIcon, FolderIcon, PaletteIcon, GitBranchIcon } from "../icons";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { GitSettingsSection } from "./GitSettingsSection";

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsTab = "general" | "appearance" | "git";

const tabs: { id: SettingsTab; label: string; icon: typeof FolderIcon }[] = [
  { id: "general", label: "General", icon: FolderIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "git", label: "Version Control", icon: GitBranchIcon },
];

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-bg-muted text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-text">Settings</h1>
      </div>

      {/* Content with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 border-r border-border p-3 flex flex-col gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left
                  ${
                    isActive
                      ? "bg-bg-emphasis text-text"
                      : "text-text-muted hover:bg-bg-muted hover:text-text"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-xl p-8">
            {activeTab === "general" && <GeneralSettingsSection />}
            {activeTab === "appearance" && <AppearanceSettingsSection />}
            {activeTab === "git" && <GitSettingsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
