import { useState, useEffect } from "react";
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
} from "../icons";
import type { Settings } from "../../types/note";

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

export function GeneralSettingsSection() {
  const { notesFolder, setNotesFolder } = useNotes();
  const { reloadSettings } = useTheme();
  const {
    status,
    gitAvailable,
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

  // Load template from settings on mount
  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const settings = await invoke<Settings>("get_settings");
        const template = settings.defaultNoteName || "Untitled";
        setNoteTemplate(template);

        // Update preview
        const preview = await invoke<string>("preview_note_name", { template });
        setPreviewNoteName(preview);
      } catch (error) {
        console.error("Failed to load template:", error);
      }
    };
    loadTemplate();
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

      {/* Git Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Version Control</h2>
        <p className="text-sm text-text-muted mb-4">
          Track changes and store backups of your notes using Git
        </p>
        {!gitAvailable ? (
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
