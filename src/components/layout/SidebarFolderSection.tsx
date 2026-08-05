import { useId, type ReactNode } from "react";
import { ChevronRightIcon } from "../icons";

const STORAGE_KEY = "scratch:foldersSectionCollapsed";

type SidebarStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): SidebarStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadFolderSectionCollapsed(
  storage: SidebarStorage | undefined = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveFolderSectionCollapsed(
  collapsed: boolean,
  storage: SidebarStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Keep the disclosure usable when storage is unavailable.
  }
}

interface SidebarFolderSectionProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}

export function SidebarFolderSection({
  collapsed,
  onCollapsedChange,
  children,
}: SidebarFolderSectionProps) {
  const contentId = useId();
  const expanded = !collapsed;

  return (
    <section aria-label="Folders" className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} Folders`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => onCollapsedChange(!collapsed)}
        className="flex h-8 w-full shrink-0 items-center gap-1 rounded-sm px-2 text-left text-xs font-medium text-text-muted outline-none transition-colors hover:bg-bg-muted hover:text-text focus-visible:bg-bg-muted focus-visible:text-text active:bg-bg-muted motion-reduce:transition-none"
      >
        <span>Folders</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 stroke-[1.7] transition-transform duration-150 motion-reduce:transition-none${
            expanded ? " rotate-90" : ""
          }`}
        />
      </button>
      {expanded && <div id={contentId}>{children}</div>}
    </section>
  );
}
