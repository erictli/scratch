import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
} from "react";
import { cn } from "../../lib/utils";
import type { NoteMetadata } from "../../types/note";

export interface WikilinkSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface WikilinkSuggestionListProps {
  items: NoteMetadata[];
  command: (item: NoteMetadata) => void;
}

export const WikilinkSuggestionList = forwardRef<
  WikilinkSuggestionListRef,
  WikilinkSuggestionListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
        return true;
      }
      if (event.key === "Enter") {
        if (items[selectedIndex]) {
          command(items[selectedIndex]);
        }
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="bg-bg border border-border rounded-lg shadow-lg p-2 w-72">
        <div className="text-sm text-text-muted px-3 py-2">
          No matching notes
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="bg-bg border border-border rounded-lg shadow-lg p-1.5 w-72 max-h-80 overflow-y-auto animate-slide-down flex flex-col gap-0.5"
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          data-index={index}
          role="button"
          tabIndex={-1}
          onClick={() => command(item)}
          className={cn(
            "w-full text-left p-2 rounded-md flex flex-col min-w-0 transition-colors cursor-pointer",
            selectedIndex === index
              ? "bg-bg-muted text-text"
              : "text-text hover:bg-bg-muted",
          )}
        >
          <span className="text-sm leading-snug font-medium truncate">
            {item.title}
          </span>
          {item.preview && (
            <span className="text-xs text-text-muted truncate mt-0.5">
              {item.preview}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});
WikilinkSuggestionList.displayName = "WikilinkSuggestionList";
