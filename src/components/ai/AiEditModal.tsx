import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { SpinnerIcon, ClaudeIcon } from "../icons";
import * as aiService from "../../services/ai";

interface AiEditModalProps {
  open: boolean;
  onBack: () => void; // Go back to command palette
  onExecute: (prompt: string) => Promise<void>;
  isExecuting: boolean;
}

export function AiEditModal({
  open,
  onBack,
  onExecute,
  isExecuting,
}: AiEditModalProps) {
  const [prompt, setPrompt] = useState("");
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current && claudeInstalled) {
      inputRef.current.focus();
    }
  }, [open, claudeInstalled]);

  // Check for Claude CLI when modal opens
  useEffect(() => {
    if (!open) return;
    let active = true;
    aiService
      .checkClaudeCli()
      .then((result) => {
        if (active) setClaudeInstalled(result);
      })
      .catch((err) => {
        console.error("Failed to check Claude CLI:", err);
        if (active) setClaudeInstalled(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Clear prompt when modal closes
  useEffect(() => {
    if (!open) {
      setPrompt("");
      setClaudeInstalled(null);
    }
  }, [open]);

  // Handle Escape key at modal level (works even when input is disabled)
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onBack]);

  const handleExecute = async () => {
    if (!prompt.trim() || isExecuting || !claudeInstalled) return;
    await onExecute(prompt);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
    // Escape is handled by the global handleEscape listener
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center py-11 px-4 pointer-events-none">
      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down pointer-events-auto">
        {/* Input */}
        <div className="border-b border-border">
          <div className="flex items-center gap-3 px-4.5 py-3.5">
            <ClaudeIcon className="w-5 h-5 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                claudeInstalled === false
                  ? "Claude CLI not installed"
                  : "Describe how to edit the current note..."
              }
              disabled={isExecuting || claudeInstalled === false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="flex-1 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50 disabled:opacity-50"
            />
            {isExecuting && (
              <SpinnerIcon className="w-5 h-5 animate-spin text-text-muted flex-shrink-0" />
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="p-4.5 space-y-3">
          {isExecuting ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <SpinnerIcon className="w-4 h-4 animate-spin" />
              <span>Claude is editing your note...</span>
            </div>
          ) : claudeInstalled === false ? (
            <>
              <div className="text-sm space-y-0.5 p-3 bg-orange-500/10 rounded-md ">
                <div className="font-medium text-orange-700 dark:text-orange-400">
                  Claude Code CLI Not Found
                </div>
                <div className="text-orange-700/80 dark:text-orange-400/80">
                  You'll need the Claude Code CLI and a Claude subscription to
                  use this feature. Visit{" "}
                  <a
                    href="https://code.claude.com/docs/en/quickstart"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-700 dark:text-orange-400 font-medium hover:underline"
                  >
                    Claude Code
                  </a>{" "}
                  to install it, then restart Scratch.
                </div>
              </div>
              <div className="w-full flex justify-between">
                <div className="flex items-center gap-1.5 text-sm text-text-muted">
                  <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                    Esc
                  </kbd>
                  <span>to go back</span>
                </div>
              </div>
            </>
          ) : claudeInstalled === null ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <SpinnerIcon className="w-4 h-4 animate-spin" />
              <span>Checking for Claude CLI...</span>
            </div>
          ) : (
            <>
              <div className="text-sm space-y-1 p-3 bg-bg-muted rounded-md">
                <span className="font-medium text-text">How does it work?</span>{" "}
                <span className="text-text-muted">
                  Claude will edit the current note directly using the local
                  Claude Code CLI (uses your Claude subscription). You'll be
                  able to undo changes.
                </span>
              </div>
              <div className="w-full flex justify-between">
                <div className="flex items-center gap-1.5 text-sm text-text-muted">
                  <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                    Esc
                  </kbd>
                  <span>to go back</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-text-muted">
                  <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                    Enter
                  </kbd>
                  <span>to submit</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
