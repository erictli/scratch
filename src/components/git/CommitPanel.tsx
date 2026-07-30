import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { useGit } from "../../context/GitContext";
import { Button, Textarea } from "../ui";

const DEFAULT_COMMIT_MESSAGE = "Quick Commit from Scratch";

interface CommitPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CommitPanel({ open, onClose }: CommitPanelProps) {
  const { commit, isCommitting } = useGit();

  const [message, setMessage] = useState(DEFAULT_COMMIT_MESSAGE);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setMessage(DEFAULT_COMMIT_MESSAGE);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, [open]);

  const canCommit = useMemo(() => message.trim().length > 0, [message]);

  const handleCommit = useCallback(async () => {
    const commitMessage = message.trim();

    if (!commitMessage || isCommitting) {
      return;
    }

    try {
      const success = await commit(commitMessage);

      if (success) {
        toast.success("Changes committed");
        onClose();
      } else {
        toast.error("Failed to commit");
      }
    } catch {
      toast.error("Failed to commit");
    }
  }, [commit, isCommitting, message, onClose]);

  const handleKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleCommit();
      }
    },
    [handleCommit, onClose],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="border-t border-border bg-bg-secondary px-3 py-3">
      <div className="mb-2">
        <h3 className="text-sm font-medium text-text">Commit Changes</h3>

        <p className="mt-1 text-xs text-text-muted">
          Enter to commit • Shift+Enter for newline
        </p>
      </div>

      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={4}
        placeholder="Commit message"
        className="min-h-24"
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={isCommitting}>
          Cancel
        </Button>

        <Button
          variant="primary"
          onClick={handleCommit}
          disabled={!canCommit || isCommitting}
        >
          {isCommitting ? "Committing..." : "Commit"}
        </Button>
      </div>
    </div>
  );
}
