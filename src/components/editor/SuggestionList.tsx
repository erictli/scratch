import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export interface SuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SuggestionListProps<T> {
  items: T[];
  command: (item: T) => void;
  itemKey: (item: T) => string;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  emptyText?: string;
  width?: string;
}

function SuggestionListInner<T>(
  {
    items,
    command,
    itemKey,
    renderItem,
    emptyText = "No results",
    width = "w-64",
  }: SuggestionListProps<T>,
  ref: React.ForwardedRef<SuggestionListRef>,
) {
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
      <div
        className={cn(
          "bg-bg border border-border rounded-lg shadow-lg p-2",
          width,
        )}
      >
        <div className="text-sm text-text-muted px-3 py-2">{emptyText}</div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className={cn(
        "bg-bg border border-border rounded-lg shadow-lg p-1.5 max-h-80 overflow-y-auto animate-slide-down flex flex-col gap-0.5",
        width,
      )}
    >
      {items.map((item, index) => (
        <div
          key={itemKey(item)}
          data-index={index}
          role="button"
          tabIndex={-1}
          onClick={() => command(item)}
          className={cn(
            "w-full text-left p-2 rounded-md transition-colors cursor-pointer",
            selectedIndex === index
              ? "bg-bg-muted text-text"
              : "text-text hover:bg-bg-muted",
          )}
        >
          {renderItem(item, selectedIndex === index)}
        </div>
      ))}
    </div>
  );
}

export const SuggestionList = forwardRef(SuggestionListInner) as <T>(
  props: SuggestionListProps<T> & { ref?: React.Ref<SuggestionListRef> },
) => ReactNode;
