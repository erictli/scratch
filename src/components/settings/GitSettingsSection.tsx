import { useGit } from "../../context/GitContext";
import { Button } from "../ui";
import { SpinnerIcon } from "../icons";

export function GitSettingsSection() {
  const { status, gitAvailable, initRepo, isLoading } = useGit();

  if (!gitAvailable) {
    return (
      <div className="bg-bg-secondary rounded-lg border border-border p-4">
        <p className="text-sm text-text-muted">
          Git is not available on this system. Install Git to enable version control.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-bg-secondary rounded-lg border border-border p-4 flex items-center justify-center">
        <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!status?.isRepo) {
    return (
      <div className="bg-bg-secondary rounded-lg border border-border p-4">
        <p className="text-sm text-text mb-4">
          Enable Git to track changes to your notes with version control.
        </p>
        <Button onClick={initRepo} disabled={isLoading}>
          Initialize Git Repository
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">Status</span>
        <span className="text-sm text-text-muted">
          {status.currentBranch ? `On branch ${status.currentBranch}` : "Git enabled"}
        </span>
      </div>
      {status.hasRemote && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text">Remote</span>
          <span className="text-sm text-text-muted">Connected</span>
        </div>
      )}
      {status.changedCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text">Changes</span>
          <span className="text-sm text-accent">{status.changedCount} files</span>
        </div>
      )}
      {status.aheadCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text">To push</span>
          <span className="text-sm text-accent">{status.aheadCount} commits</span>
        </div>
      )}
      <p className="text-xs text-text-muted pt-2 border-t border-border">
        Changes are tracked automatically. Use the sidebar to commit and push.
      </p>
    </div>
  );
}
