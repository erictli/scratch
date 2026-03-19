import { useState, useEffect, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { useGit } from "../../context/GitContext";
import { Button } from "../ui";
import { Input } from "../ui";
import {
  FolderIcon,
  FoldersIcon,
  ExternalLinkIcon,
  SpinnerIcon,
  CloudPlusIcon,
  ChevronRightIcon,
  CheckIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "../icons";
import { AI_PROVIDER_ORDER, type AiProvider } from "../../services/ai";
import * as aiService from "../../services/ai";
import { mod } from "../../lib/platform";
import { formatTemplateName } from "../../lib/utils";
import type { Settings } from "../../types/note";
import * as cliService from "../../services/cli";
import type { CliStatus } from "../../services/cli";
import * as notesService from "../../services/notes";

// Format remote URL for display - extract user/repo from full URL
function formatRemoteUrl(url: string | null): string {
  if (!url) return "Connected";
  // Extract repo path from URL
  // SSH: git@github.com:user/repo.git
  // HTTPS: https://github.com/user/repo.git
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return sshMatch?.[1] || httpsMatch?.[1] || url;
}

// Convert git remote URL to a browsable web URL
function getRemoteWebUrl(url: string | null): string | null {
  if (!url) return null;
  // SSH: git@github.com:user/repo.git -> https://github.com/user/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  // HTTPS: https://github.com/user/repo.git -> https://github.com/user/repo
  const httpsMatch = url.match(/^(https?:\/\/.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return httpsMatch[1];
  }
  return null;
}

type CliState = {
  status: CliStatus | null;
  loaded: boolean;
  error: boolean;
  operating: boolean;
};

type CliAction =
  | { type: "loaded"; status: CliStatus }
  | { type: "error" }
  | { type: "operating" }
  | { type: "operated"; status: CliStatus }
  | { type: "operate_failed" };

const cliInitialState: CliState = {
  status: null,
  loaded: false,
  error: false,
  operating: false,
};

function cliReducer(state: CliState, action: CliAction): CliState {
  switch (action.type) {
    case "loaded":
      return { ...state, status: action.status, loaded: true, error: false };
    case "error":
      return { ...state, error: true };
    case "operating":
      return { ...state, operating: true };
    case "operated":
      return { ...state, status: action.status, operating: false };
    case "operate_failed":
      return { ...state, operating: false };
  }
}

function CliUsageHint() {
  return (
    <p className="text-sm text-text-muted font-mono">
      scratch file.md # open note
      <br />
      scratch . # open folder
      <br />
      scratch # launch app
    </p>
  );
}

export function GeneralSettingsSection() {
  const { notesFolder, setNotesFolder } = useNotes();
  const { reloadSettings } = useTheme();
  const {
    status,
    gitAvailable,
    gitEnabled,
    isUpdatingGitEnabled,
    setGitEnabled,
    initRepo,
    isLoading,
    addRemote,
    pushWithUpstream,
    isAddingRemote,
    isPushing,
    lastError,
    clearError,
  } = useGit();

  const [remoteUrl, setRemoteUrl] = useState("");
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [noteTemplate, setNoteTemplate] = useState<string>("Untitled");
  const [previewNoteName, setPreviewNoteName] = useState<string>("Untitled");
  const [defaultNoteFolder, setDefaultNoteFolder] = useState<string>("");
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [templateFolder, setTemplateFolder] = useState<string>("");
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [defaultTemplate, setDefaultTemplate] = useState<string>("");
  const [cli, dispatchCli] = useReducer(cliReducer, cliInitialState);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [aiProvidersLoading, setAiProvidersLoading] = useState(true);

  useEffect(() => {
    cliService
      .getCliStatus()
      .then((status) => dispatchCli({ type: "loaded", status }))
      .catch((err) => {
        console.error("Failed to get CLI status:", err);
        dispatchCli({ type: "error" });
      });
  }, []);

  // Discover installed AI CLIs on mount
  useEffect(() => {
    aiService
      .getAvailableAiProviders()
      .then(setAiProviders)
      .catch(() => setAiProviders([]))
      .finally(() => setAiProvidersLoading(false));
  }, []);

  // Load settings and available folders on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settings, folders, templates] = await Promise.all([
          invoke<Settings>("get_settings"),
          notesService.listFolders(),
          notesService.listTemplates(),
        ]);
        const template = settings.defaultNoteName || "Untitled";
        setNoteTemplate(template);
        setDefaultNoteFolder(settings.defaultNoteFolder || "");
        setAvailableFolders(folders);
        setTemplateFolder(settings.templateFolder || "");
        setAvailableTemplates(templates);
        setDefaultTemplate(settings.defaultTemplate || "");

        // Update preview
        const preview = await invoke<string>("preview_note_name", { template });
        setPreviewNoteName(preview);
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };
    loadSettings();
  }, []);

  // Update preview when template changes (debounced)
  useEffect(() => {
    const updatePreview = async () => {
      try {
        const preview = await invoke<string>("preview_note_name", {
          template: noteTemplate,
        });
        setPreviewNoteName(preview);
      } catch (error) {
        setPreviewNoteName("Invalid template");
      }
    };

    const timer = setTimeout(updatePreview, 300);
    return () => clearTimeout(timer);
  }, [noteTemplate]);

  const handleSaveTemplate = async () => {
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: {
          ...settings,
          defaultNoteName: noteTemplate || undefined,
        },
      });
      toast.success("Default name saved");
    } catch (error) {
      console.error("Failed to save default name:", error);
      toast.error("Failed to save default name");
    }
  };

  const handleDefaultNoteFolderChange = async (folder: string) => {
    setDefaultNoteFolder(folder);
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: {
          ...settings,
          defaultNoteFolder: folder || undefined,
        },
      });
    } catch (error) {
      console.error("Failed to save default note folder:", error);
      toast.error("Failed to save default folder");
    }
  };

  const handleChangeTemplateFolder = async () => {
    try {
      const selected = await invoke<string | null>("open_folder_dialog", {
        defaultPath: templateFolder || null,
      });
      if (selected) {
        const settings = await invoke<Settings>("get_settings");
        await invoke("update_settings", {
          newSettings: {
            ...settings,
            templateFolder: selected,
            defaultTemplate: undefined,
          },
        });
        setTemplateFolder(selected);
        setDefaultTemplate("");
        const templates = await notesService.listTemplates();
        setAvailableTemplates(templates);
      }
    } catch (err) {
      console.error("Failed to select template folder:", err);
      toast.error("Failed to select template folder");
    }
  };

  const handleClearTemplateFolder = async () => {
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: {
          ...settings,
          templateFolder: undefined,
          defaultTemplate: undefined,
        },
      });
      setTemplateFolder("");
      setDefaultTemplate("");
      setAvailableTemplates([]);
    } catch (err) {
      console.error("Failed to clear template folder:", err);
      toast.error("Failed to clear template folder");
    }
  };

  const handleDefaultTemplateChange = async (template: string) => {
    setDefaultTemplate(template);
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: {
          ...settings,
          defaultTemplate: template || undefined,
        },
      });
    } catch (error) {
      console.error("Failed to save default template:", error);
      toast.error("Failed to save default template");
    }
  };

  const handleChangeFolder = async () => {
    try {
      const selected = await invoke<string | null>("open_folder_dialog", {
        defaultPath: notesFolder || null,
      });

      if (selected) {
        await setNotesFolder(selected);
        // Reload theme/font settings from the new folder's .scratch/settings.json
        await reloadSettings();
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
      toast.error("Failed to select folder");
    }
  };

  const handleOpenFolder = async () => {
    if (!notesFolder) return;
    try {
      await invoke("open_in_file_manager", { path: notesFolder });
    } catch (err) {
      console.error("Failed to open folder:", err);
      toast.error("Failed to open folder");
    }
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await invoke("open_url_safe", { url });
    } catch (err) {
      console.error("Failed to open URL:", err);
      toast.error(err instanceof Error ? err.message : "Failed to open URL");
    }
  };

  // Format path for display - truncate middle if too long
  const formatPath = (path: string | null): string => {
    if (!path) return "Not set";
    const maxLength = 50;
    if (path.length <= maxLength) return path;

    // Show start and end of path
    const start = path.slice(0, 20);
    const end = path.slice(-25);
    return `${start}...${end}`;
  };

  const handleAddRemote = async () => {
    // Guard against concurrent submissions
    if (isAddingRemote) return;
    if (!remoteUrl.trim()) return;
    const success = await addRemote(remoteUrl.trim());
    if (success) {
      setRemoteUrl("");
      setShowRemoteInput(false);
    }
  };

  const handlePushWithUpstream = async () => {
    await pushWithUpstream();
  };

  const handleCancelRemote = () => {
    setShowRemoteInput(false);
    setRemoteUrl("");
    clearError();
  };

  const handleInstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.installCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success(
        "CLI tool installed. Open a new terminal to use `scratch`.",
      );
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to install CLI tool",
      );
    }
  };

  const handleUninstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.uninstallCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success("CLI tool uninstalled.");
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to uninstall CLI tool",
      );
    }
  };

  const handleToggleGitEnabled = async (enabled: boolean) => {
    if (isUpdatingGitEnabled) return;

    const success = await setGitEnabled(enabled);
    if (!success) {
      toast.error("Failed to update version control setting");
      return;
    }

    if (!enabled) {
      setShowRemoteInput(false);
      setRemoteUrl("");
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* Folder Location */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Folder Location</h2>
        <p className="text-sm text-text-muted mb-4">
          Your notes are stored as markdown files in this folder
        </p>
        <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border mb-2.5">
          <div className="p-2 rounded-md bg-bg-muted">
            <FolderIcon className="w-4.5 h-4.5 stroke-[1.5] text-text-muted" />
          </div>
          <p
            className="text-sm text-text-muted truncate"
            title={notesFolder || undefined}
          >
            {formatPath(notesFolder)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={handleChangeFolder}
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <FoldersIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            Change Folder
          </Button>
          {notesFolder && (
            <Button
              onClick={handleOpenFolder}
              variant="ghost"
              size="md"
              className="gap-1.25 text-text"
            >
              Open Folder
            </Button>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Default Note Folder */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Default Folder</h2>
        <p className="text-sm text-text-muted mb-4">
          New notes will be created in this folder by default
        </p>
        <select
          value={defaultNoteFolder}
          onChange={(e) => handleDefaultNoteFolderChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:border-accent cursor-pointer"
        >
          <option value="">Root (no folder)</option>
          {availableFolders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Folders Section */}
      <section className="pb-2">
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-0.75">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-medium">Enable Folders</h2>
            </div>
            <p className="text-sm text-text-muted max-w-lg">
              Create and view nested folders to organize your notes. When off,
              notes are shown in a flat list sorted by date.
            </p>
          </div>
          <FoldersToggle />
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Git Section */}
      <section className="pb-2 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-0.75">
            <h2 className="text-xl font-medium">Version Control</h2>
            <p className="text-sm text-text-muted max-w-lg">
              Track changes and store backups of your notes using Git
            </p>
          </div>
          <div className="flex gap-1 p-1 rounded-[10px] border border-border">
            <Button
              onClick={() => handleToggleGitEnabled(false)}
              variant={!gitEnabled ? "primary" : "ghost"}
              size="xs"
              disabled={isUpdatingGitEnabled}
            >
              Off
            </Button>
            <Button
              onClick={() => handleToggleGitEnabled(true)}
              variant={gitEnabled ? "primary" : "ghost"}
              size="xs"
              disabled={isUpdatingGitEnabled}
            >
              On
            </Button>
          </div>
        </div>
        {!gitEnabled ? null : !gitAvailable ? (
          <div className="bg-bg-secondary rounded-[10px] border border-border p-4">
            <p className="text-sm text-text-muted">
              Git is not available on this system.{" "}
              <a
                href="https://git-scm.com/downloads"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted border-b border-text-muted/50 hover:text-text hover:border-text cursor-pointer transition-colors"
              >
                Install Git
              </a>{" "}
              to enable version control.
            </p>
          </div>
        ) : isLoading ? (
          <div className="rounded-[10px] border border-border p-4 flex items-center justify-center">
            <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
          </div>
        ) : !status?.isRepo ? (
          <div className="bg-bg-secondary rounded-[10px] border border-border p-4">
            <p className="text-sm text-text-muted mb-2">
              Enable Git to track changes to your notes with version control.
              Your changes will be tracked automatically and you can commit and
              push from the sidebar.
            </p>
            <Button
              onClick={initRepo}
              disabled={isLoading}
              variant="outline"
              size="md"
            >
              Initialize Git Repository
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-[10px] border border-border p-4 space-y-2.5">
              {/* Branch status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-text font-medium">Status</span>
                <span className="text-sm text-text-muted">
                  {status.currentBranch
                    ? `On branch ${status.currentBranch}`
                    : "Git enabled"}
                </span>
              </div>

              {/* Remote configuration */}
              {status.hasRemote ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Remote
                    </span>
                    {getRemoteWebUrl(status.remoteUrl) ? (
                      <button
                        onClick={() =>
                          handleOpenUrl(getRemoteWebUrl(status.remoteUrl)!)
                        }
                        className="flex items-center gap-0.75 text-sm text-text-muted hover:text-text truncate max-w-50 transition-colors cursor-pointer"
                        title={status.remoteUrl || undefined}
                      >
                        <span className="truncate">
                          {formatRemoteUrl(status.remoteUrl)}
                        </span>
                        <ExternalLinkIcon className="w-3.25 h-3.25 shrink-0" />
                      </button>
                    ) : (
                      <span
                        className="text-sm text-text-muted truncate max-w-50"
                        title={status.remoteUrl || undefined}
                      >
                        {formatRemoteUrl(status.remoteUrl)}
                      </span>
                    )}
                  </div>

                  {/* Upstream tracking status */}
                  {status.hasUpstream ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">
                        Tracking
                      </span>
                      <span className="text-sm text-text-muted">
                        origin/{status.currentBranch}
                      </span>
                    </div>
                  ) : (
                    status.currentBranch && (
                      <div className="pt-3 border-t border-border border-dashed space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text font-medium">
                            Tracking
                          </span>
                          <span className="text-sm font-medium text-amber-500">
                            Not set up
                          </span>
                        </div>
                        <p className="text-sm text-text-muted mb-2">
                          Push your commits and set up tracking for the '
                          {status.currentBranch}' branch.
                        </p>
                        <Button
                          onClick={handlePushWithUpstream}
                          disabled={isPushing}
                          size="sm"
                          className="mb-1.5"
                        >
                          {isPushing ? (
                            <>
                              <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                              Pushing...
                            </>
                          ) : (
                            `Push & track '${status.currentBranch}'`
                          )}
                        </Button>
                      </div>
                    )
                  )}
                </>
              ) : (
                <div className="pt-3 border-t border-border border-dashed space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Remote
                    </span>
                    <span className="text-sm font-medium text-orange-500">
                      Not connected
                    </span>
                  </div>

                  {showRemoteInput ? (
                    <div className="space-y-2">
                      <Input
                        type="text"
                        value={remoteUrl}
                        onChange={(e) => setRemoteUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddRemote();
                          if (e.key === "Escape") handleCancelRemote();
                        }}
                        placeholder="https://github.com/user/repo.git"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={handleAddRemote}
                          disabled={isAddingRemote || !remoteUrl.trim()}
                          size="sm"
                        >
                          {isAddingRemote ? (
                            <>
                              <SpinnerIcon className="w-3 h-3 mr-2 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            "Connect"
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelRemote}
                        >
                          Cancel
                        </Button>
                      </div>
                      <RemoteInstructions />
                    </div>
                  ) : (
                    <>
                      <Button
                        onClick={() => setShowRemoteInput(true)}
                        variant="outline"
                        size="md"
                      >
                        <CloudPlusIcon className="w-4 h-4 stroke-[1.7] mr-1.5" />
                        Add Remote
                      </Button>
                      <RemoteInstructions />
                    </>
                  )}
                </div>
              )}

              {/* Changes count */}
              {status.changedCount > 0 && (
                <div className="flex items-center justify-between pt-3 border-t border-border border-dashed">
                  <span className="text-sm text-text font-medium">
                    Changes to commit
                  </span>
                  <span className="text-sm text-text-muted">
                    {status.changedCount} file
                    {status.changedCount === 1 ? "" : "s"} changed
                  </span>
                </div>
              )}

              {/* Commits to push */}
              {status.aheadCount > 0 && status.hasUpstream && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text font-medium">
                    Commits to push
                  </span>
                  <span className="text-sm text-text-muted">
                    {status.aheadCount} commit
                    {status.aheadCount === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {/* Commits to pull */}
              {status.behindCount > 0 && status.hasUpstream && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text font-medium">
                    Commits to pull
                  </span>
                  <span className="text-sm text-text-muted">
                    {status.behindCount} commit
                    {status.behindCount === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              {/* Error display */}
              {lastError && (
                <div className="pt-3 border-t border-border">
                  <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3">
                    <p className="text-sm text-red-500">{lastError}</p>
                    {(lastError.includes("Authentication") ||
                      lastError.includes("SSH")) && (
                      <a
                        href="https://docs.github.com/en/authentication/connecting-to-github-with-ssh"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-red-400 hover:text-red-300 underline mt-1 inline-block"
                      >
                        Learn more about SSH authentication
                      </a>
                    )}
                    <Button
                      onClick={clearError}
                      variant="link"
                      className="block text-xs h-auto p-0 mt-2 text-red-400 hover:text-red-300"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* New Note Template */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Default Note Name</h2>
        <p className="text-sm text-text-muted mb-4">
          Customize the default name when creating a new note
        </p>

        <div className="space-y-2">
          <div>
            <Input
              type="text"
              value={noteTemplate}
              onChange={(e) => setNoteTemplate(e.target.value)}
              onBlur={handleSaveTemplate}
              placeholder="Untitled"
            />
          </div>
          <div className="text-2xs text-text-muted font-mono p-2 rounded-md bg-bg-muted mb-4">
            Preview: {previewNoteName}
          </div>

          {/* Template Tags Reference */}
          <details className="text-sm">
            <summary className="cursor-pointer text-text-muted hover:text-text select-none flex items-center gap-1 font-medium">
              <ChevronRightIcon className="w-3.5 h-3.5 stroke-2 transition-transform [[open]>&]:rotate-90" />
              Add template tags to your name
            </summary>
            <div className="mt-2 space-y-1.5 pl-2 text-text-muted">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                <code>{"{timestamp}"}</code>
                <span>1739586000</span>
                <code>{"{date}"}</code>
                <span>2026-02-15</span>
                <code>{"{time}"}</code>
                <span>14-30-45</span>
                <code>{"{year}"}</code>
                <span>2026</span>
                <code>{"{month}"}</code>
                <span>02</span>
                <code>{"{day}"}</code>
                <span>15</span>
                <code>{"{counter}"}</code>
                <span>1, 2, 3...</span>
              </div>
              <p className="text-xs mt-2 pt-2 border-t border-border">
                Examples: <code>Note-{"{year}-{month}-{day}"}</code>
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Note Templates */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Note Templates</h2>
        <p className="text-sm text-text-muted mb-4">
          Choose a folder of markdown files to use as templates for new notes.
          Templates appear as commands in the command palette.
        </p>

        {templateFolder ? (
          <>
            <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border mb-2.5">
              <div className="p-2 rounded-md bg-bg-muted">
                <FolderIcon className="w-4.5 h-4.5 stroke-[1.5] text-text-muted" />
              </div>
              <p
                className="text-sm text-text-muted truncate"
                title={templateFolder}
              >
                {formatPath(templateFolder)}
              </p>
            </div>

            {availableTemplates.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Default Template</p>
                <select
                  value={defaultTemplate}
                  onChange={(e) => handleDefaultTemplateChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:border-accent cursor-pointer"
                >
                  <option value="">None (blank note)</option>
                  {availableTemplates.map((filename) => (
                    <option key={filename} value={filename}>
                      {formatTemplateName(filename)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {availableTemplates.length === 0 && (
              <p className="text-sm text-text-muted mb-4">
                No .md files found in this folder.
              </p>
            )}
          </>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            onClick={handleChangeTemplateFolder}
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <FoldersIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            {templateFolder ? "Change Folder" : "Set Template Folder"}
          </Button>
          {templateFolder && (
            <Button
              onClick={handleClearTemplateFolder}
              variant="ghost"
              size="md"
              className="text-text"
            >
              Clear
            </Button>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* AI Providers */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">AI Providers</h2>
        <p className="text-sm text-text-muted mb-4">
          Edit notes with AI from the command palette ({mod}P while editing a
          note)
        </p>

        {aiProvidersLoading ? (
          <div className="flex items-center gap-2 p-3">
            <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
            <span className="text-sm text-text-muted">
              Detecting installed providers...
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {AI_PROVIDER_ORDER.map((provider) => {
              const installed = aiProviders.includes(provider);
              const info = AI_PROVIDER_INFO[provider];
              return (
                <div
                  key={provider}
                  className="flex items-center justify-between p-3 rounded-[10px] border border-border"
                >
                  <div className="flex items-center gap-2.5">
                    <info.icon className="w-4.5 h-4.5 text-text-muted" />
                    <span className="text-sm font-medium">{info.name}</span>
                  </div>
                  {installed ? (
                    <span className="flex items-center gap-1.25 text-sm text-text-muted">
                      Installed
                      <span className="h-4.5 w-4.5 bg-bg-emphasis rounded-full flex items-center justify-center">
                        <CheckIcon className="w-3 h-3 stroke-[2.2]" />
                      </span>
                    </span>
                  ) : (
                    <a
                      href={info.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-text font-medium hover:text-text-muted transition-colors cursor-pointer"
                    >
                      Install
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CLI Tool (macOS only) */}
      {(cli.loaded && cli.status?.supported) || cli.error ? (
        <>
          <div className="border-t border-border border-dashed" />

          <section className="pb-2">
            <h2 className="text-xl font-medium mb-0.5">CLI Tool</h2>
            <p className="text-sm text-text-muted mb-4">
              Open notes from the terminal with the{" "}
              <code className="font-mono text-xs bg-bg-muted px-1.5 py-0.5 rounded">
                scratch
              </code>{" "}
              command
            </p>

            {cli.error ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3">
                <p className="text-sm text-red-500">
                  Failed to check CLI status. Please restart the app.
                </p>
              </div>
            ) : cli.status === null ? (
              <div className="rounded-[10px] border border-border p-4 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
              </div>
            ) : cli.status.installed ? (
              <>
                <div className="rounded-[10px] border border-border p-4 space-y-3 mb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Status
                    </span>
                    <span className="text-sm text-text-muted">Installed</span>
                  </div>
                  {cli.status.path && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">
                        Path
                      </span>
                      <button
                        type="button"
                        className="text-xs font-mono text-text-muted bg-bg-muted px-2 py-0.5 rounded max-w-48 truncate cursor-pointer hover:bg-bg-hover transition-colors"
                        title="Click to copy path"
                        onClick={async () => {
                          try {
                            await invoke("copy_to_clipboard", { text: cli.status!.path! });
                            toast.success("Path copied to clipboard");
                          } catch {
                            toast.error("Failed to copy path");
                          }
                        }}
                      >
                        {cli.status.path}
                      </button>
                    </div>
                  )}
                  <div className="pt-3 border-t border-border border-dashed">
                    <CliUsageHint />
                  </div>
                </div>
                <Button
                  onClick={handleUninstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Uninstalling...
                    </>
                  ) : (
                    "Uninstall CLI Tool"
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border bg-bg-secondary mb-2.5">
                  <CliUsageHint />
                </div>
                <Button
                  onClick={handleInstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    "Install CLI Tool"
                  )}
                </Button>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

const AI_PROVIDER_INFO: Record<
  AiProvider,
  {
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    installUrl: string;
  }
> = {
  claude: {
    name: "Claude Code",
    icon: ClaudeIcon,
    installUrl: "https://code.claude.com/docs/en/quickstart",
  },
  codex: {
    name: "OpenAI Codex",
    icon: CodexIcon,
    installUrl: "https://github.com/openai/codex",
  },
  opencode: {
    name: "OpenCode",
    icon: OpenCodeIcon,
    installUrl: "https://opencode.ai",
  },
  ollama: {
    name: "Ollama",
    icon: OllamaIcon,
    installUrl: "https://ollama.com",
  },
};

function FoldersToggle() {
  const [foldersEnabled, setFoldersEnabled] = useState<boolean | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        setFoldersEnabled(s.foldersEnabled === true);
      })
      .catch((error) => {
        console.error("Failed to load folder setting:", error);
        setFoldersEnabled(false);
      });
  }, []);

  const handleToggle = async (enabled: boolean) => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: { ...settings, foldersEnabled: enabled },
      });
      setFoldersEnabled(enabled);
    } catch {
      toast.error("Failed to update folder setting");
    } finally {
      setIsUpdating(false);
    }
  };

  if (foldersEnabled === null) {
    return (
      <div className="flex gap-1 p-1 rounded-[10px] border border-border shrink-0">
        <Button variant="ghost" size="xs" disabled>
          Off
        </Button>
        <Button variant="ghost" size="xs" disabled>
          On
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1 p-1 rounded-[10px] border border-border shrink-0">
      <Button
        onClick={() => handleToggle(false)}
        variant={!foldersEnabled ? "primary" : "ghost"}
        size="xs"
        disabled={isUpdating}
      >
        Off
      </Button>
      <Button
        onClick={() => handleToggle(true)}
        variant={foldersEnabled ? "primary" : "ghost"}
        size="xs"
        disabled={isUpdating}
      >
        On
      </Button>
    </div>
  );
}

function RemoteInstructions() {
  return (
    <div className="text-sm text-text-muted space-y-1.5 pt-2 pb-1.5">
      <p className="font-medium">To get your remote URL:</p>
      <ol className="list-decimal list-inside space-y-0.5 pl-1">
        <li>Create a repository on GitHub, GitLab, etc.</li>
        <li>Copy the repository URL (HTTPS or SSH)</li>
        <li>Click "Add Remote" and paste the URL</li>
      </ol>
      <p className="text-text-muted/70 pt-1">
        Example: https://github.com/username/my-notes.git
      </p>
    </div>
  );
}
