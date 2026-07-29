import { useEffect, type RefObject } from "react";
import { Input, IconButton } from "../ui";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  XIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ReplaceIcon,
  ReplaceAllIcon,
} from "../icons";
import { shift } from "../../lib/platform";

interface SearchToolbarProps {
  query: string;
  onChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  currentMatch: number;
  totalMatches: number;
  inputRef: RefObject<HTMLInputElement | null>;
  // Replace functionality props
  replaceQuery: string;
  onReplaceChange: (value: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  isReplaceOpen: boolean;
  onToggleReplace: () => void;
}

export function SearchToolbar({
  query,
  onChange,
  onNext,
  onPrevious,
  onClose,
  currentMatch,
  totalMatches,
  inputRef,
  replaceQuery,
  onReplaceChange,
  onReplace,
  onReplaceAll,
  isReplaceOpen,
  onToggleReplace,
}: SearchToolbarProps) {
  // Auto-focus input on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [inputRef]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // Allow tab navigation within toolbar
      e.stopPropagation();
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
        onReplaceAll();
      } else {
        onReplace();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      e.stopPropagation();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 bg-bg border border-border rounded-lg shadow-lg p-1.5 w-85 text-text search-toolbar-container">
      {/* First Row: Find */}
      <div className="flex items-center gap-1.5">
        <IconButton
          onClick={onToggleReplace}
          title={isReplaceOpen ? "Hide Replace" : "Show Replace"}
          className="shrink-0"
        >
          {isReplaceOpen ? (
            <ChevronDownIcon className="w-4 h-4 stroke-[1.8]" />
          ) : (
            <ChevronRightIcon className="w-4 h-4 stroke-[1.8]" />
          )}
        </IconButton>

        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Find in note..."
          className="flex-1 h-8 text-sm"
          onKeyDown={handleKeyDown}
        />

        <span className="text-xs text-text-muted whitespace-nowrap px-1 min-w-10 text-right">
          {totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}
        </span>

        <div className="flex items-center gap-px shrink-0">
          <IconButton
            onClick={onPrevious}
            disabled={totalMatches === 0}
            title={`Previous match (${shift}↵)`}
          >
            <ArrowUpIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>

          <IconButton
            onClick={onNext}
            disabled={totalMatches === 0}
            title="Next match (↵)"
          >
            <ArrowDownIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>

          <IconButton onClick={onClose} title="Close (Esc)">
            <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        </div>
      </div>

      {/* Second Row: Replace */}
      {isReplaceOpen && (
        <div className="flex items-center gap-1.5 pl-8.5 animate-in slide-in-from-top-1 duration-150">
          <Input
            type="text"
            value={replaceQuery}
            onChange={(e) => onReplaceChange(e.target.value)}
            placeholder="Replace with..."
            className="flex-1 h-8 text-sm"
            onKeyDown={handleReplaceKeyDown}
          />

          <div className="flex items-center gap-px shrink-0">
            <IconButton
              onClick={onReplace}
              disabled={totalMatches === 0}
              title="Replace (↵)"
            >
              <ReplaceIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>

            <IconButton
              onClick={onReplaceAll}
              disabled={totalMatches === 0}
              title="Replace All (Ctrl/Cmd+Enter)"
            >
              <ReplaceAllIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
