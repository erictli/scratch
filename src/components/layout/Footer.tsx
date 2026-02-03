import { useCallback, memo } from "react";
import { toast } from "sonner";
import { useGit } from "../../context/GitContext";
import { Button, IconButton, Tooltip } from "../ui";
import {
  GitBranchIcon,
  GitBranchDeletedIcon,
  GitCommitIcon,
  UploadIcon,
  SpinnerIcon,
  SettingsIcon,
  CloudCheckIcon,
} from "../icons";

interface FooterProps {
  onOpenSettings?: () => void;
}

export const Footer = memo(function Footer({ onOpenSettings }: FooterProps) {
  const {
    status,
    isLoading,
    isPushing,
    isCommitting,
    gitAvailable,
    push,
    initRepo,
    commit,
    lastError,
    clearError,
  } = useGit();

  const handleCommit = useCallback(async () => {
    if (isCommitting) return;
    try {
      const success = await commit("Quick commit from Scratch");
      if (success) {
        toast.success("Changes committed");
      } else {
        toast.error("Failed to commit");
      }
    } catch {
      toast.error("Failed to commit");
    }
  }, [commit, isCommitting]);

  const handlePush = useCallback(async () => {
    const success = await push();
    if (success) {
      toast.success("Pushed to remote");
    } else {
      toast.error("Failed to push");
    }
  }, [push]);

  const handleEnableGit = useCallback(async () => {
    const success = await initRepo();
    if (success) {
      toast.success("Git repository initialized");
    } else {
      toast.error("Failed to initialize Git");
    }
  }, [initRepo]);

  // Git status section
  const renderGitStatus = () => {
    if (!gitAvailable) {
      return null;
    }

    // Not a git repo - show init option
    if (status && !status.isRepo) {
      return (
        <Tooltip content="Initialize Git repository">
          <Button
            onClick={handleEnableGit}
            variant="ghost"
            className="text-xs h-auto p-0 hover:bg-transparent"
          >
            Enable Git
          </Button>
        </Tooltip>
      );
    }

    // Show spinner only when loading and no error to display
    if (isLoading && !lastError) {
      return <SpinnerIcon className="w-3 h-3 text-text-muted animate-spin" />;
    }

    const hasChanges = status ? status.changedCount > 0 : false;

    return (
      <div className="flex items-center gap-1.5">
        {/* Branch icon with name on hover */}
        {status?.currentBranch ? (
          <Tooltip content={"Branch: " + status.currentBranch}>
            <span className="text-text-muted flex items-center">
              <GitBranchIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </span>
          </Tooltip>
        ) : status ? (
          <Tooltip content="No branch (set up git in settings)">
            <span className="text-text-muted flex items-center">
              <GitBranchDeletedIcon className="w-4.5 h-4.5 stroke-[1.5] opacity-50" />
            </span>
          </Tooltip>
        ) : null}

        {/* Changes indicator */}
        {hasChanges && (
          <Tooltip content="You have uncommitted changes">
            <span className="text-xs text-text-muted/70">Files changed</span>
          </Tooltip>
        )}

        {/* Error indicator */}
        {lastError && (
          <Tooltip content={lastError}>
            <Button
              onClick={clearError}
              variant="link"
              className="text-xs h-auto p-0 text-orange-500 hover:text-orange-600 hover:no-underline"
            >
              An error occurred
            </Button>
          </Tooltip>
        )}
      </div>
    );
  };

  // Determine what buttons to show
  const hasChanges = (status?.changedCount ?? 0) > 0;
  const showCommitButton = gitAvailable && status?.isRepo && hasChanges;
  const canPush = status?.hasRemote && (status?.aheadCount ?? 0) > 0;
  const showCloudCheck = status?.hasRemote && !hasChanges && !canPush;

  return (
    <div className="shrink-0 border-t border-border">
      {/* Footer bar with git status and action buttons */}
      <div className="pl-4 pr-3 pt-2 pb-2.5 flex items-center justify-between">
        {renderGitStatus()}
        <div className="flex items-center gap-0.5">
          {/* Push button or cloud check icon */}
          {canPush && (
            <Tooltip
              content={`${status?.aheadCount} commit${
                status?.aheadCount === 1 ? " to push" : "s to push"
              }`}
            >
              <IconButton
                onClick={handlePush}
                disabled={isPushing}
                title="Push"
              >
                {isPushing ? (
                  <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
                ) : (
                  <UploadIcon className="w-4.5 h-4.5 stroke-[1.5]" />
                )}
              </IconButton>
            </Tooltip>
          )}
          {showCloudCheck && (
            <Tooltip content="Synced with remote">
              <span className="text-text-muted flex items-center justify-center h-6 w-6">
                <CloudCheckIcon className="w-4.5 h-4.5 stroke-[1.5] opacity-50" />
              </span>
            </Tooltip>
          )}
          {showCommitButton && (
            <IconButton
              onClick={handleCommit}
              disabled={isCommitting}
              title="Quick commit"
            >
              {isCommitting ? (
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
              ) : (
                <GitCommitIcon className="w-4.5 h-4.5 stroke-[1.5]" />
              )}
            </IconButton>
          )}
          <IconButton onClick={onOpenSettings} title="Settings (⌘, to toggle)">
            <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        </div>
      </div>
    </div>
  );
});
