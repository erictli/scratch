import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreVerticalIcon, XIcon } from "../icons";

interface DiffMenuProps {
  top: number;
  left: number;
  onReject: () => void;
}

export function DiffMenu({ top, left, onReject }: DiffMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ai-diff-menu" style={{ top, left }}>
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="ai-diff-menu-trigger"
            aria-label="Open diff menu"
          >
            <MoreVerticalIcon className="w-4 h-4 stroke-[1.8]" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="min-w-36 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
            sideOffset={6}
            align="end"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenu.Item
              className="px-3 py-1.5 text-sm text-red-500 cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
              onSelect={() => {
                onReject();
                setOpen(false);
              }}
            >
              <XIcon className="w-4 h-4 stroke-[1.8]" />
              Reject changes
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
