import { useState, useRef, useEffect } from "react";
import { SpinnerIcon, XIcon, CheckIcon } from "../icons";
import type { ClaudeResult } from "../../services/claude";

interface AIEditInputProps {
  isEditing: boolean;
  result: ClaudeResult | null;
  onSubmit: (prompt: string) => void;
  onUndo: () => void;
  onDismiss: () => void;
  onCancel: () => void;
}

const SparkleIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />
  </svg>
);

export function AIEditInput({ isEditing, result, onSubmit, onUndo, onDismiss, onCancel }: AIEditInputProps) {
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing && !result) {
      inputRef.current?.focus();
    }
  }, [isEditing, result]);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isEditing) return;
    onSubmit(trimmed);
  };

  // Result state: show what Claude did with Keep/Undo
  if (result && !isEditing) {
    const output = result.output?.trim();
    return (
      <div className="border-b border-border bg-bg-secondary">
        <div className="flex items-start gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-accent shrink-0 mt-0.5">
            {result.success ? (
              <CheckIcon className="w-3.5 h-3.5" />
            ) : (
              <XIcon className="w-3.5 h-3.5 text-red-500" />
            )}
            <span>{result.success ? "Done" : "Failed"}</span>
          </div>
          <div className="flex-1 min-w-0">
            {output && (
              <p className="text-xs text-text-muted line-clamp-3">{output}</p>
            )}
            {result.error && !result.success && (
              <p className="text-xs text-red-500 line-clamp-2">{result.error}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          {result.success && (
            <>
              <button
                onClick={onDismiss}
                className="text-xs font-medium px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                Keep
              </button>
              <button
                onClick={onUndo}
                className="text-xs font-medium px-2.5 py-1 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
              >
                Undo
              </button>
            </>
          )}
          {!result.success && (
            <button
              onClick={onDismiss}
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
            >
              Dismiss
            </button>
          )}
          {result.sessionUrl && (
            <a
              href={result.sessionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline ml-auto"
            >
              View session
            </a>
          )}
        </div>
      </div>
    );
  }

  // Editing state: spinner
  if (isEditing) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-1.5 text-xs font-medium text-accent shrink-0">
          <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
          <span>Editing...</span>
        </div>
        <div className="flex-1 text-xs text-text-muted">
          Claude is editing this note...
        </div>
      </div>
    );
  }

  // Input state: prompt entry
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
      <div className="flex items-center gap-1.5 text-xs font-medium text-accent shrink-0">
        <SparkleIcon />
        <span>AI Edit</span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Describe changes to make..."
        className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted focus:outline-none"
      />
      <div className="flex items-center gap-1 shrink-0">
        <kbd className="text-[10px] px-1 py-0.5 rounded bg-bg-muted text-text-muted border border-border">
          Enter
        </kbd>
        <button
          onClick={onCancel}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-bg-muted text-text-muted hover:text-text transition-colors"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
