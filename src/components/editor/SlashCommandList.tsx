import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useRef,
} from "react";
import { cn } from "../../lib/utils";
import type { SlashCommandItem } from "./SlashCommand";

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
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
      <div className="bg-bg border border-border rounded-lg shadow-lg p-2 w-64">
        <div className="text-sm text-text-muted px-3 py-2">No results</div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="bg-bg border border-border rounded-lg shadow-lg p-1.5 w-64 max-h-80 overflow-y-auto animate-slide-down flex flex-col gap-0.5"
    >
      {items.map((item, index) => (
        <div
          key={item.title}
          data-index={index}
          role="button"
          tabIndex={-1}
          onClick={() => command(item)}
          className={cn(
            "w-full text-left p-2 rounded-md flex items-center gap-3 transition-colors cursor-pointer",
            selectedIndex === index
              ? "bg-bg-muted text-text"
              : "text-text hover:bg-bg-muted",
          )}
        >
          <div className="shrink-0 text-text-muted [&_svg]:stroke-[1.5]">
            {item.icon}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm leading-snug font-medium truncate">
              {item.title}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});
SlashCommandList.displayName = "SlashCommandList";
