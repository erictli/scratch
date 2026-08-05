import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { NoteSortOrder } from "../../types/note";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
} from "../icons";
import { IconButton } from "../ui";

interface NoteSortMenuProps {
  sortOrder: NoteSortOrder;
  onChange: (sortOrder: NoteSortOrder) => void;
}

const radioItemClass =
  "relative flex cursor-pointer items-center gap-2 px-3 py-1.5 pr-8 text-sm text-text outline-none hover:bg-bg-muted focus:bg-bg-muted data-[state=checked]:font-medium";

export function NoteSortMenu({
  sortOrder,
  onChange,
}: NoteSortMenuProps) {
  const newestFirst = sortOrder === "newest";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          title={`Sort notes: ${newestFirst ? "Newest" : "Oldest"} first`}
          tabIndex={0}
          className="active:scale-[0.96] motion-reduce:transform-none"
        >
          {newestFirst ? (
            <ArrowDownIcon className="h-4.25 w-4.25 stroke-[1.5]" />
          ) : (
            <ArrowUpIcon className="h-4.25 w-4.25 stroke-[1.5]" />
          )}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-44 rounded-md border border-border bg-bg py-1 shadow-lg"
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Label className="px-3 py-1 text-xs font-medium text-text-muted">
            Sort notes
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={sortOrder}
            onValueChange={(value) => {
              if (value === "newest" || value === "oldest") onChange(value);
            }}
          >
            <DropdownMenu.RadioItem value="newest" className={radioItemClass}>
              <ArrowDownIcon className="h-4 w-4 shrink-0 stroke-[1.6]" />
              Newest first
              <DropdownMenu.ItemIndicator className="absolute right-3 inline-flex items-center">
                <CheckIcon className="h-3.5 w-3.5 stroke-[1.8]" />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="oldest" className={radioItemClass}>
              <ArrowUpIcon className="h-4 w-4 shrink-0 stroke-[1.6]" />
              Oldest first
              <DropdownMenu.ItemIndicator className="absolute right-3 inline-flex items-center">
                <CheckIcon className="h-3.5 w-3.5 stroke-[1.8]" />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
