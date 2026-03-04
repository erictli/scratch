import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { mod, shift, isMac } from "../../lib/platform";
import { cn } from "../../lib/utils";
import { IconButton, Tooltip } from "../ui";
import {
  SpinnerIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  ShareIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  PinIcon,
  SearchIcon,
  MarkdownIcon,
  MarkdownOffIcon,
  FolderPlusIcon,
} from "../icons";

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface EditorTopBarProps {
  currentNote: { id: string; modified: number };
  sidebarVisible?: boolean;
  focusMode?: boolean;
  onToggleSidebar?: () => void;
  // Save status
  isSaving: boolean;
  hasExternalChanges: boolean;
  onReload: () => Promise<void>;
  // Pin
  isPinned: boolean;
  pinNote?: (noteId: string) => Promise<void>;
  unpinNote?: (noteId: string) => Promise<void>;
  onSettingsReload: () => Promise<void>;
  // Search
  onOpenSearch: () => void;
  // Source mode
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  // Copy/Export
  copyMenuOpen: boolean;
  onCopyMenuOpenChange: (open: boolean) => void;
  onCopyMarkdown: () => Promise<void>;
  onCopyPlainText: () => Promise<void>;
  onCopyHtml: () => Promise<void>;
  onDownloadPdf: () => Promise<void>;
  onDownloadMarkdown: () => Promise<void>;
  // Save to folder (preview mode)
  onSaveToFolder?: () => void;
  saveToFolderDisabled?: boolean;
}

export function EditorTopBar({
  currentNote,
  sidebarVisible,
  focusMode,
  onToggleSidebar,
  isSaving,
  hasExternalChanges,
  onReload,
  isPinned,
  pinNote,
  unpinNote,
  onSettingsReload,
  onOpenSearch,
  sourceMode,
  onToggleSourceMode,
  copyMenuOpen,
  onCopyMenuOpenChange,
  onCopyMarkdown,
  onCopyPlainText,
  onCopyHtml,
  onDownloadPdf,
  onDownloadMarkdown,
  onSaveToFolder,
  saveToFolderDisabled,
}: EditorTopBarProps) {
  return (
    <div
      className={cn(
        "h-11 shrink-0 flex items-center justify-between px-3",
        !sidebarVisible && "pl-22",
        focusMode && "pl-22",
      )}
      data-tauri-drag-region
    >
      <div
        className={`titlebar-no-drag flex items-center gap-1 min-w-0 transition-opacity duration-1000 delay-500 ${focusMode ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        {onToggleSidebar && (
          <IconButton
            onClick={onToggleSidebar}
            title={
              sidebarVisible
                ? `Hide sidebar (${mod}${isMac ? "" : "+"}\\)`
                : `Show sidebar (${mod}${isMac ? "" : "+"}\\)`
            }
            className="shrink-0"
          >
            <PanelLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        )}
        <span className="text-xs text-text-muted mb-px truncate">
          {formatDateTime(currentNote.modified)}
        </span>
      </div>
      <div
        className={`titlebar-no-drag flex items-center gap-px shrink-0 transition-opacity duration-1000 delay-500 ${focusMode ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        {hasExternalChanges ? (
          <Tooltip
            content={`External changes detected (${mod}${isMac ? "" : "+"}R to refresh)`}
          >
            <button
              onClick={onReload}
              className="h-7 px-2 flex items-center gap-1 text-xs text-text-muted hover:bg-bg-emphasis rounded transition-colors font-medium"
            >
              <RefreshCwIcon className="w-4 h-4 stroke-[1.6]" />
              <span>Refresh</span>
            </button>
          </Tooltip>
        ) : isSaving ? (
          <Tooltip content="Saving...">
            <div className="h-7 w-7 flex items-center justify-center">
              <SpinnerIcon className="w-4.5 h-4.5 text-text-muted/40 stroke-[1.5] animate-spin" />
            </div>
          </Tooltip>
        ) : (
          <Tooltip content="All changes saved">
            <div className="h-7 w-7 flex items-center justify-center rounded-full">
              <CircleCheckIcon className="w-4.5 h-4.5 mt-px stroke-[1.5] text-text-muted/40" />
            </div>
          </Tooltip>
        )}
        {currentNote && pinNote && unpinNote && (
          <Tooltip content={isPinned ? "Unpin note" : "Pin note"}>
            <IconButton
              onClick={async () => {
                if (!currentNote) return;
                try {
                  if (isPinned) {
                    await unpinNote(currentNote.id);
                  } else {
                    await pinNote(currentNote.id);
                  }
                  await onSettingsReload();
                } catch (error) {
                  console.error("Failed to pin/unpin note:", error);
                }
              }}
            >
              <PinIcon
                className={cn(
                  "w-5 h-5 stroke-[1.3]",
                  isPinned && "fill-current",
                )}
              />
            </IconButton>
          </Tooltip>
        )}
        {currentNote && (
          <Tooltip content={`Find in note (${mod}${isMac ? "" : "+"}F)`}>
            <IconButton onClick={onOpenSearch}>
              <SearchIcon className="w-4.25 h-4.25 stroke-[1.6]" />
            </IconButton>
          </Tooltip>
        )}
        {currentNote && (
          <Tooltip
            content={
              sourceMode
                ? `View Formatted (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}M)`
                : `View Markdown Source (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}M)`
            }
          >
            <IconButton onClick={onToggleSourceMode}>
              {sourceMode ? (
                <MarkdownOffIcon className="w-4.75 h-4.75 stroke-[1.4]" />
              ) : (
                <MarkdownIcon className="w-4.75 h-4.75 stroke-[1.4]" />
              )}
            </IconButton>
          </Tooltip>
        )}
        <DropdownMenu.Root open={copyMenuOpen} onOpenChange={onCopyMenuOpenChange}>
          <Tooltip
            content={`Export (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}C)`}
          >
            <DropdownMenu.Trigger asChild>
              <IconButton>
                <ShareIcon className="w-4.25 h-4.25 stroke-[1.6]" />
              </IconButton>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-35 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
              sideOffset={5}
              align="end"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.stopPropagation();
                }
              }}
            >
              <DropdownMenu.Item
                className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                onSelect={onCopyMarkdown}
              >
                <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                Copy Markdown
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                onSelect={onCopyPlainText}
              >
                <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                Copy Plain Text
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                onSelect={onCopyHtml}
              >
                <CopyIcon className="w-4 h-4 stroke-[1.6]" />
                Copy HTML
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                onSelect={onDownloadPdf}
              >
                <DownloadIcon className="w-4 h-4 stroke-[1.6]" />
                Print as PDF
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                onSelect={onDownloadMarkdown}
              >
                <DownloadIcon className="w-4 h-4 stroke-[1.6]" />
                Export Markdown
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {onSaveToFolder && (
          <Tooltip content="Save in Folder">
            <IconButton
              onClick={onSaveToFolder}
              aria-label="Save in Folder"
              disabled={saveToFolderDisabled}
            >
              {saveToFolderDisabled ? (
                <SpinnerIcon className="w-4.25 h-4.25 animate-spin" />
              ) : (
                <FolderPlusIcon className="w-4.25 h-4.25 stroke-[1.6]" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
