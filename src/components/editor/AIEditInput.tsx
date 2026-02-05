import { useState, useRef, useEffect } from "react";
import { SpinnerIcon, XIcon } from "../icons";

interface AIEditInputProps {
  isEditing: boolean;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function AIEditInput({ isEditing, onSubmit, onCancel }: AIEditInputProps) {
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isEditing) return;
    onSubmit(trimmed);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
      <div className="flex items-center gap-1.5 text-xs font-medium text-accent shrink-0">
        {isEditing ? (
          <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />
          </svg>
        )}
        <span>{isEditing ? "Editing..." : "AI Edit"}</span>
      </div>
      {isEditing ? (
        <div className="flex-1 text-xs text-text-muted">
          Claude is editing this note...
        </div>
      ) : (
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
      )}
      {!isEditing && (
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
      )}
    </div>
  );
}
