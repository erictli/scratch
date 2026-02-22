import { useEffect, type RefObject } from "react";
import { Input, IconButton } from "../ui";
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "../icons";
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

  return (
    <div className="flex items-center gap-1.5 bg-bg border border-border rounded-lg shadow-lg p-1">
      <Input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find in note..."
        className="w-55 h-8 text-sm"
        onKeyDown={handleKeyDown}
      />

      <span className="text-xs text-text-muted whitespace-nowrap px-1 min-w-17">
        {totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "Not found"}
      </span>

      <div className="flex items-center gap-px ml-1">
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
  );
}
