import { useState, useEffect, useMemo, useRef } from "react";
import { cleanTitle, cn } from "../../lib/utils";
import type { NoteMetadata } from "../../types/note";

interface NoteNavigatorProps {
  notes: NoteMetadata[];
  onSelect: (note: NoteMetadata) => void;
  onCancel: () => void;
}

export const NoteNavigator = ({
  notes,
  onSelect,
  onCancel,
}: NoteNavigatorProps) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      notes
        .filter((n) =>
          cleanTitle(n.title).toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 10),
    [notes, query],
  );

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="bg-bg border border-border rounded-lg shadow-lg overflow-hidden w-72">
      <div className="border-b border-border">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Go to note..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full px-3 py-2 text-sm bg-transparent outline-none text-text placeholder:text-text-muted"
        />
      </div>
      <div
        ref={listRef}
        className="p-1.5 max-h-60 overflow-y-auto flex flex-col gap-0.5"
      >
        {filtered.length === 0 ? (
          <div className="text-sm text-text-muted px-3 py-2">
            No matching notes
          </div>
        ) : (
          filtered.map((note, i) => (
            <div
              key={note.id}
              data-index={i}
              role="button"
              tabIndex={-1}
              onClick={() => onSelect(note)}
              className={cn(
                "w-full text-left p-2 rounded-md transition-colors cursor-pointer",
                selectedIndex === i
                  ? "bg-bg-muted text-text"
                  : "text-text hover:bg-bg-muted",
              )}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm leading-snug font-medium truncate">
                  {cleanTitle(note.title)}
                </span>
                {note.preview && (
                  <span className="text-xs text-text-muted truncate mt-0.5">
                    {note.preview}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
