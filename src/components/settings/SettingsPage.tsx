import { useState, useEffect } from "react";
import { ArrowLeftIcon, FolderIcon, SwatchIcon, KeyboardIcon } from "../icons";
import { Button, IconButton } from "../ui";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { AppearanceSettingsSection } from "./EditorSettingsSection";
import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";
import { useTheme } from "../../context/ThemeContext";
import type { ShortcutAction } from "../../types/note";
import {
  getShortcutDisplayText,
  matchesParsedShortcut,
  parseShortcut,
} from "../../lib/shortcuts";

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsTab = "general" | "editor" | "shortcuts";

const tabs: {
  id: SettingsTab;
  label: string;
  icon: typeof FolderIcon;
  shortcutAction: ShortcutAction;
}[] = [
  {
    id: "general",
    label: "General",
    icon: FolderIcon,
    shortcutAction: "settingsGeneralTab",
  },
  {
    id: "editor",
    label: "Appearance",
    icon: SwatchIcon,
    shortcutAction: "settingsAppearanceTab",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    shortcutAction: "settingsShortcutsTab",
  },
];

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { shortcuts } = useTheme();

  // Keyboard shortcuts
  useEffect(() => {
    const generalTabShortcut = parseShortcut(shortcuts.settingsGeneralTab);
    const appearanceTabShortcut = parseShortcut(shortcuts.settingsAppearanceTab);
    const shortcutsTabShortcut = parseShortcut(shortcuts.settingsShortcutsTab);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (generalTabShortcut && matchesParsedShortcut(e, generalTabShortcut)) {
        e.preventDefault();
        setActiveTab("general");
        return;
      }

      if (
        appearanceTabShortcut &&
        matchesParsedShortcut(e, appearanceTabShortcut)
      ) {
        e.preventDefault();
        setActiveTab("editor");
        return;
      }

      if (shortcutsTabShortcut && matchesParsedShortcut(e, shortcutsTabShortcut)) {
        e.preventDefault();
        setActiveTab("shortcuts");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    shortcuts.settingsAppearanceTab,
    shortcuts.settingsGeneralTab,
    shortcuts.settingsShortcutsTab,
  ]);

  return (
    <div className="h-full flex bg-bg w-full">
      {/* Sidebar - matches main Notes sidebar */}
      <div className="w-64 h-full bg-bg-secondary border-r border-border flex flex-col select-none">
        {/* Drag region */}
        <div className="h-11 shrink-0" data-tauri-drag-region></div>

        {/* Header with back button and Settings title */}
        <div className="flex items-center justify-between px-3 pb-2 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            <IconButton
              onClick={onBack}
              title={`Back (${getShortcutDisplayText(shortcuts.openSettings)})`}
            >
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
                className="justify-between gap-2.5 h-10 pr-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4.5 h-4.5 stroke-[1.5]" />
                  {tab.label}
                </div>
                <div className="text-xs text-text-muted">
                  {getShortcutDisplayText(shortcuts[tab.shortcutAction])}
                </div>
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
          <div className="w-full max-w-3xl mx-auto px-6 pb-6">
            {activeTab === "general" && <GeneralSettingsSection />}
            {activeTab === "editor" && <AppearanceSettingsSection />}
            {activeTab === "shortcuts" && <ShortcutsSettingsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
