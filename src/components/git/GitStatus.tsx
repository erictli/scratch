import { useState } from "react";
import { useGit } from "../../context/GitContext";
import { Button, IconButton, Tooltip, Input } from "../ui";
import {
  GitBranchIcon,
  GitCommitIcon,
  UploadIcon,
  SpinnerIcon,
} from "../icons";

export function GitStatus() {
  const {
    status,
    isLoading,
    isCommitting,
    isPushing,
    gitAvailable,
    commit,
    push,
    initRepo,
    lastError,
    clearError,
  } = useGit();

  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

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

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    const success = await commit(commitMessage);
    if (success) {
      setCommitMessage("");
      setShowCommitInput(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Branch name */}
      {status.currentBranch && (
        <span className="text-xs text-text-muted flex items-center gap-1">
          <GitBranchIcon className="w-4.5 h-4.5" />
          {status.currentBranch}
        </span>
      )}

      {/* Changes indicator */}
      {hasChanges && (
        <Tooltip content={`${status.changedCount} changed`}>
          <span className="text-xs text-accent">
            {status.changedCount} changes
          </span>
        </Tooltip>
      )}

      {/* Commit button/input */}
      {hasChanges && (
        <>
          {showCommitInput ? (
            <div className="flex items-center gap-1">
              <Input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommit();
                  if (e.key === "Escape") setShowCommitInput(false);
                }}
                placeholder="Commit message..."
                className="w-28 h-6 px-2 text-xs"
                autoFocus
              />
              <IconButton
                onClick={handleCommit}
                disabled={isCommitting || !commitMessage.trim()}
                title="Commit"
              >
                {isCommitting ? (
                  <SpinnerIcon className="w-3 h-3 animate-spin" />
                ) : (
                  <GitCommitIcon className="w-4.5 h-4.5" />
                )}
              </IconButton>
            </div>
          ) : (
            <IconButton
              onClick={() => setShowCommitInput(true)}
              title="Commit changes"
            >
              <GitCommitIcon className="w-4.5 h-4.5" />
            </IconButton>
          )}
        </>
      )}

      {/* Push indicator and button */}
      {canPush && (
        <Tooltip content={`${status.aheadCount} to push`}>
          <IconButton onClick={push} disabled={isPushing} title="Push">
            {isPushing ? (
              <SpinnerIcon className="w-3 h-3 animate-spin" />
            ) : (
              <UploadIcon className="w-3 h-3" />
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
}
