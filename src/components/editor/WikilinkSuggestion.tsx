import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from "react";
import type { NoteMetadata } from "../../types/note";

export interface WikilinkSuggestionProps {
  items: NoteMetadata[];
  command: (item: { id: string; title: string }) => void;
  query: string;
}

export interface WikilinkSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const WikilinkSuggestionList = forwardRef<
  WikilinkSuggestionRef,
  WikilinkSuggestionProps
>(({ items, command, query }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Show "create new note" option if no exact match
  const hasExactMatch = items.some(
    (item) => item.title.toLowerCase() === query.toLowerCase()
  );
  const showCreateOption = query.trim().length > 0 && !hasExactMatch;
  const totalItems = items.length + (showCreateOption ? 1 : 0);

  const selectItem = useCallback(
    (index: number) => {
      if (index < items.length) {
        const item = items[index];
        if (item) {
          command({ id: item.id, title: item.title });
        }
      } else if (showCreateOption) {
        // "Create" option selected
        command({ id: "", title: query.trim() });
      }
    },
    [items, command, showCreateOption, query]
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0 && !showCreateOption) {
    return (
      <div className="wikilink-suggestion-dropdown">
        <div className="px-3 py-2 text-sm text-text-muted">No notes found</div>
      </div>
    );
  }

  return (
    <div ref={listRef} className="wikilink-suggestion-dropdown">
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`wikilink-suggestion-item ${
            index === selectedIndex ? "is-selected" : ""
          }`}
          onClick={() => selectItem(index)}
        >
          <span className="truncate">{item.title}</span>
        </button>
      ))}
      {showCreateOption && (
        <button
          className={`wikilink-suggestion-item wikilink-suggestion-create ${
            selectedIndex === items.length ? "is-selected" : ""
          }`}
          onClick={() => command({ id: "", title: query.trim() })}
        >
          <span className="text-text-muted">Create:</span>
          <span className="truncate font-medium">{query.trim()}</span>
        </button>
      )}
    </div>
  );
});

WikilinkSuggestionList.displayName = "WikilinkSuggestionList";
