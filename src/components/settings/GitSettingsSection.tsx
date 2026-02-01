import { useState } from "react";
import { useGit } from "../../context/GitContext";
import { Button } from "../ui";
import { SpinnerIcon, LinkIcon } from "../icons";

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

export function GitSettingsSection() {
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

  if (!gitAvailable) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-text-muted">Git</h2>
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <p className="text-sm text-text-muted">
            Git is not available on this system. Install Git to enable version
            control.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-text-muted">Git</h2>
        <div className="bg-bg-secondary rounded-lg border border-border p-4 flex items-center justify-center">
          <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  if (!status?.isRepo) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-text-muted">Git</h2>
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <p className="text-sm text-text mb-4">
            Enable Git to track changes to your notes with version control.
          </p>
          <Button onClick={initRepo} disabled={isLoading}>
            Initialize Git Repository
          </Button>
        </div>
      </div>
    );
  }

  const handleAddRemote = async () => {
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
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-text-muted">Git</h2>
      <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-4">
        {/* Branch status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-text">Status</span>
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
              <span className="text-sm text-text">Remote</span>
              <span
                className="text-sm text-text-muted truncate max-w-50"
                title={status.remoteUrl || undefined}
              >
                {formatRemoteUrl(status.remoteUrl)}
              </span>
            </div>

            {/* Upstream tracking status */}
            {status.hasUpstream ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-text">Tracking</span>
                <span className="text-sm text-text-muted">
                  origin/{status.currentBranch}
                </span>
              </div>
            ) : (
              status.currentBranch && (
                <div className="pt-3 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text">Tracking</span>
                    <span className="text-sm text-amber-500">Not set up</span>
                  </div>
                  <p className="text-xs text-text-muted">
                    Push your commits and set up tracking for the{" "}
                    {status.currentBranch} branch.
                  </p>
                  <Button
                    onClick={handlePushWithUpstream}
                    disabled={isPushing}
                    size="sm"
                  >
                    {isPushing ? (
                      <>
                        <SpinnerIcon className="w-3 h-3 mr-2 animate-spin" />
                        Pushing...
                      </>
                    ) : (
                      `Push & Track origin/${status.currentBranch}`
                    )}
                  </Button>
                </div>
              )
            )}
          </>
        ) : (
          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text">Remote</span>
              <span className="text-sm text-amber-500">Not connected</span>
            </div>

            {showRemoteInput ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddRemote();
                    if (e.key === "Escape") handleCancelRemote();
                  }}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full px-3 py-2 text-sm bg-bg-muted border border-border rounded-md text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50"
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
              </div>
            ) : (
              <>
                <Button
                  onClick={() => setShowRemoteInput(true)}
                  variant="outline"
                  size="sm"
                >
                  <LinkIcon className="w-3 h-3 mr-2" />
                  Add Remote
                </Button>
                <RemoteInstructions />
              </>
            )}
          </div>
        )}

        {/* Changes count */}
        {status.changedCount > 0 && (
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <span className="text-sm text-text">Changes</span>
            <span className="text-sm text-accent">
              {status.changedCount} files
            </span>
          </div>
        )}

        {/* Commits to push */}
        {status.aheadCount > 0 && status.hasUpstream && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-text">To push</span>
            <span className="text-sm text-accent">
              {status.aheadCount} commits
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

      <p className="text-xs text-text-muted">
        Changes are tracked automatically. Use the sidebar to commit and push.
      </p>
    </div>
  );
}

function RemoteInstructions() {
  return (
    <div className="text-xs text-text-muted space-y-2 pt-2">
      <p className="font-medium">To get your remote URL:</p>
      <ol className="list-decimal list-inside space-y-1 pl-1">
        <li>Create a repository on GitHub, GitLab, etc.</li>
        <li>Copy the repository URL (HTTPS or SSH)</li>
        <li>Paste it above and click Connect</li>
      </ol>
      <p className="text-text-muted/70 pt-1">
        Example: https://github.com/username/my-notes.git
      </p>
    </div>
  );
}
