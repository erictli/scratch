import { useCallback, useEffect, useRef, useState } from "react";
import { useGit } from "../../context/GitContext";
import { Button, IconButton, Tooltip, Input } from "../ui";
import {
  GitBranchIcon,
  GitCommitIcon,
  UploadIcon,
  SpinnerIcon,
  SettingsIcon,
  XIcon,
} from "../icons";

interface FooterProps {
  onOpenSettings?: () => void;
}

export function Footer({ onOpenSettings }: FooterProps) {
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

  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const commitInputRef = useRef<HTMLInputElement>(null);

  // Commit handlers
  const openCommit = useCallback(() => {
    if (!commitOpen) {
      setCommitOpen(true);
    } else {
      commitInputRef.current?.focus();
    }
  }, [commitOpen]);

  const closeCommit = useCallback(() => {
    setCommitOpen(false);
    setCommitMessage("");
  }, []);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    const success = await commit(commitMessage);
    if (success) {
      setCommitMessage("");
      setCommitOpen(false);
    }
  }, [commitMessage, commit]);

  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeCommit();
      }
    },
    [handleCommit, closeCommit]
  );

  // Auto-focus commit input when opened
  useEffect(() => {
    if (commitOpen) {
      requestAnimationFrame(() => {
        commitInputRef.current?.focus();
      });
    }
  }, [commitOpen]);

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
            onClick={initRepo}
            variant="link"
            className="text-xs h-auto p-0"
          >
            Enable Git
          </Button>
        </Tooltip>
      );
    }

    if (!status || isLoading) {
      return <SpinnerIcon className="w-3 h-3 text-text-muted animate-spin" />;
    }

    const hasChanges = status.changedCount > 0;
    const canPush = status.hasRemote && status.aheadCount > 0;

    return (
      <div className="flex items-center gap-1.5">
        {/* Branch icon with name on hover */}
        {status.currentBranch && (
          <Tooltip content={"Branch: " + status.currentBranch}>
            <span className="text-text-muted flex items-center">
              <GitBranchIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </span>
          </Tooltip>
        )}

        {/* Changes indicator */}
        {hasChanges && (
          <Tooltip
            content={`You have ${status.changedCount} uncommitted changes`}
          >
            <span className="text-xs text-text-muted/70">
              {status.changedCount} changes
            </span>
          </Tooltip>
        )}

        {/* Push indicator and button */}
        {canPush && (
          <Tooltip content={`${status.aheadCount} to push`}>
            <IconButton onClick={push} disabled={isPushing} title="Push">
              {isPushing ? (
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
              ) : (
                <UploadIcon className="w-4.5 h-4.5 stroke-[1.5]" />
              )}
            </IconButton>
          </Tooltip>
        )}

        {/* Error indicator */}
        {lastError && (
          <Tooltip content={lastError}>
            <Button
              onClick={clearError}
              variant="link"
              className="text-xs h-auto p-0 text-red-500 hover:text-red-600"
            >
              Error
            </Button>
          </Tooltip>
        )}
      </div>
    );
  };

  // Determine if commit button should be shown
  const hasChanges = (status?.changedCount ?? 0) > 0;
  const showCommitButton = gitAvailable && status?.isRepo && hasChanges;

  return (
    <div className="shrink-0 border-t border-border flex flex-col">
      {/* Commit input - appears above footer when open */}
      {commitOpen && (
        <div className="px-2 pt-2 bg-bg-secondary">
          <div className="relative">
            <Input
              ref={commitInputRef}
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={handleCommitKeyDown}
              placeholder="Commit message..."
              className="h-9 pr-8 text-sm"
            />
            {commitMessage && !isCommitting && (
              <button
                onClick={() => setCommitMessage("")}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
              >
                <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
              </button>
            )}
            {isCommitting && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted">
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer bar with git status and action buttons */}
      <div className="px-3 pt-2.5 pb-3 flex items-center justify-between">
        {renderGitStatus()}
        <div className="flex items-center gap-0.75">
          {showCommitButton && (
            <IconButton onClick={openCommit} title="Commit changes">
              <GitCommitIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          )}
          <IconButton onClick={onOpenSettings} title="Settings (⌘,)">
            <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
