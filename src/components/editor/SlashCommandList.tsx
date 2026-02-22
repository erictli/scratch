import { forwardRef } from "react";
import type { SlashCommandItem } from "./SlashCommand";
import {
  SuggestionList,
  type SuggestionListRef,
} from "./SuggestionList";

export type SlashCommandListRef = SuggestionListRef;

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(({ items, command }, ref) => (
  <SuggestionList
    ref={ref}
    items={items}
    command={command}
    itemKey={(item) => item.title}
    renderItem={(item) => (
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-text-muted [&_svg]:stroke-[1.5]">
          {item.icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm leading-snug font-medium truncate">
            {item.title}
          </span>
        </div>
      </div>
    )}
  />
));
SlashCommandList.displayName = "SlashCommandList";
