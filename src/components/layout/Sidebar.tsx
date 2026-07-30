import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Settings } from "../../types/note";
import { toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { NoteList } from "../notes/NoteList";
import { Footer } from "./Footer";
import { IconButton, Input } from "../ui";
import {
  PlusIcon,
  XIcon,
  SearchIcon,
  SearchOffIcon,
  AddNoteIcon,
  FolderPlusIcon,
  NoteIcon,
} from "../icons";
import { mod, shift, isMac, isWindows } from "../../lib/platform";
import * as notesService from "../../services/notes";
import { FolderNameDialog } from "../notes/FolderNameDialog";

function reorderItems<T>(
  array: T[],
  activeItem: T,
  overItem: T,
  position: "before" | "after"
): T[] {
  const newArray = array.filter((item) => item !== activeItem);
  const overIndex = newArray.indexOf(overItem);
  if (overIndex === -1) return array;

  if (position === "before") {
    newArray.splice(overIndex, 0, activeItem);
  } else {
    newArray.splice(overIndex + 1, 0, activeItem);
  }
  return newArray;
}

interface SidebarProps {
  onOpenSettings?: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const {
    createNote,
    createFolder,
    notes,
    search,
    searchQuery,
    clearSearch,
    selectedNoteId,
    moveNote,
    moveFolder,
    refreshNotes,
    settings,
    updateSettings,
  } = useNotes();
  const { reloadSettings } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogParent, setFolderDialogParent] = useState("");
  const foldersEnabled = settings?.foldersEnabled === true;
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dragCount, setDragCount] = useState(1);
  const [dragOverInfo, setDragOverInfo] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const [multiSelectedNoteIds, setMultiSelectedNoteIds] = useState<Set<string>>(new Set());
  const [lastClickedNoteId, setLastClickedNoteId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const multiSelectedRef = useRef(multiSelectedNoteIds) as RefObject<Set<string>>;
  multiSelectedRef.current = multiSelectedNoteIds;

  const cursorYRef = useRef<number>(0);
  const handlePointerMove = useCallback((e: PointerEvent) => {
    cursorYRef.current = e.clientY;
  }, []);

  // dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragOverInfo(null);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    const data = event.active.data.current;
    if (data?.type === "note") {
      const noteId = data.id as string;
      const leaf = noteId.includes("/")
        ? noteId.substring(noteId.lastIndexOf("/") + 1)
        : noteId;
      setDragLabel(leaf);

      // Multi-select: if dragged note is in selection, drag all; otherwise reset
      const selected = multiSelectedRef.current!;
      if (selected.has(noteId) && selected.size > 1) {
        setDragCount(selected.size);
      } else {
        setMultiSelectedNoteIds(new Set([noteId]));
        setDragCount(1);
      }
    } else if (data?.type === "folder") {
      const path = data.path as string;
      const name = path.includes("/")
        ? path.substring(path.lastIndexOf("/") + 1)
        : path;
      setDragLabel(name);
      setDragCount(1);
    }
  }, []);

  const handleDragOver = useCallback((event: any) => {
    const { active, over } = event;
    if (!over) {
      setDragOverInfo(null);
      return;
    }

    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData || !overData) {
      setDragOverInfo(null);
      return;
    }

    if (activeData.type === "note" && overData.type === "note") {
      const noteId = activeData.id as string;
      const overId = overData.id as string;
      const activeParent = noteId.includes("/") ? noteId.substring(0, noteId.lastIndexOf("/")) : "";
      const overParent = overData.path as string;

      if (activeParent === overParent && noteId !== overId) {
        const overRect = over.rect;
        if (overRect) {
          const cursorY = cursorYRef.current;
          const overCenterY = overRect.top + overRect.height / 2;
          const position = cursorY < overCenterY ? "before" : "after";
          setDragOverInfo({ id: overId, position });
          return;
        }
      }
    } else if (activeData.type === "folder" && overData.type === "folder") {
      const folderPath = activeData.path as string;
      const overPath = overData.path as string;
      const activeParent = folderPath.includes("/") ? folderPath.substring(0, folderPath.lastIndexOf("/")) : "";
      const overParent = overPath.includes("/") ? overPath.substring(0, overPath.lastIndexOf("/")) : "";

      if (activeParent === overParent && folderPath !== overPath) {
        const overRect = over.rect;
        if (overRect) {
          const cursorY = cursorYRef.current;
          const overCenterY = overRect.top + overRect.height / 2;
          const position = cursorY < overCenterY ? "before" : "after";
          setDragOverInfo({ id: overPath, position });
          return;
        }
      }
    }

    setDragOverInfo(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      setDragLabel(null);
      setDragCount(1);
      setDragOverInfo(null);
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;
      if (!activeData || !overData) return;

      try {
        if (activeData.type === "note") {
          const noteId = activeData.id as string;
          const activeParent = noteId.includes("/")
            ? noteId.substring(0, noteId.lastIndexOf("/"))
            : "";

          const overType = overData.type as string;
          if (overType === "note") {
            const overId = overData.id as string;
            const overParent = overData.path as string;

            if (activeParent === overParent) {
              const currentSettings: Settings = settings || {
                theme: { mode: "system" },
                noteOrder: [],
                folderOrder: [],
              };
              const currentOrder = currentSettings.noteOrder || [];

              const siblings = notes.filter(n => {
                const p = n.id.includes("/") ? n.id.substring(0, n.id.lastIndexOf("/")) : "";
                return p === activeParent;
              }).map(n => n.id);

              let newOrder = [...currentOrder];
              for (const id of siblings) {
                if (!newOrder.includes(id)) {
                  newOrder.push(id);
                }
              }

              const activeIndex = newOrder.indexOf(noteId);
              const overIndex = newOrder.indexOf(overId);
              if (activeIndex !== -1 && overIndex !== -1) {
                let position: "before" | "after" = "after";
                const overRect = over.rect;
                if (overRect) {
                  const cursorY = cursorYRef.current;
                  const overCenterY = overRect.top + overRect.height / 2;
                  position = cursorY < overCenterY ? "before" : "after";
                } else {
                  position = activeIndex < overIndex ? "after" : "before";
                }
                newOrder = reorderItems(newOrder, noteId, overId, position);
              }

              const updatedSettings = {
                ...currentSettings,
                noteOrder: newOrder,
              };
              await updateSettings(updatedSettings);
              await reloadSettings();
              await refreshNotes();
              return;
            } else {
              // --- MOVE note to a different parent folder ---
              await moveNote(noteId, overParent);
            }
          } else if (overType === "folder") {
            const targetFolder = overData.path as string;
            if (activeParent === targetFolder) return;
            await moveNote(noteId, targetFolder);
          }
        } else if (activeData.type === "folder") {
          const folderPath = activeData.path as string;
          const activeParent = folderPath.includes("/")
            ? folderPath.substring(0, folderPath.lastIndexOf("/"))
            : "";

          const overType = overData.type as string;
          if (overType === "folder") {
            const overPath = overData.path as string;
            const overParent = overPath.includes("/")
              ? overPath.substring(0, overPath.lastIndexOf("/"))
              : "";

            if (activeParent === overParent) {
              const currentSettings: Settings = settings || {
                theme: { mode: "system" },
                noteOrder: [],
                folderOrder: [],
              };
              const currentOrder = currentSettings.folderOrder || [];

              const list = await notesService.listFolders();
              const siblings = list.filter(p => {
                const parent = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : "";
                return parent === activeParent;
              });

              let newOrder = [...currentOrder];
              for (const path of siblings) {
                if (!newOrder.includes(path)) {
                  newOrder.push(path);
                }
              }

              const activeIndex = newOrder.indexOf(folderPath);
              const overIndex = newOrder.indexOf(overPath);
              if (activeIndex !== -1 && overIndex !== -1) {
                let position: "before" | "after" = "after";
                const overRect = over.rect;
                if (overRect) {
                  const cursorY = cursorYRef.current;
                  const overCenterY = overRect.top + overRect.height / 2;
                  position = cursorY < overCenterY ? "before" : "after";
                } else {
                  position = activeIndex < overIndex ? "after" : "before";
                }
                newOrder = reorderItems(newOrder, folderPath, overPath, position);
              }

              const updatedSettings = {
                ...currentSettings,
                folderOrder: newOrder,
              };
              await updateSettings(updatedSettings);
              await reloadSettings();
              await refreshNotes();
              return;
            } else {
              // --- MOVE folder to a different parent folder ---
              if (
                overPath === folderPath ||
                overPath.startsWith(folderPath + "/")
              )
                return;
              const folderParent = folderPath.includes("/")
                ? folderPath.substring(0, folderPath.lastIndexOf("/"))
                : "";
              if (folderParent === overPath) return;
              await moveFolder(folderPath, overPath);
            }
          }
        }

        // Expand target folder so the moved item is visible
        const targetFolder = overData.path as string;
        if (targetFolder) {
          window.dispatchEvent(
            new CustomEvent("expand-folder", { detail: targetFolder }),
          );
        }
      } catch (error) {
        console.error("Failed to move/reorder item:", error);
        toast.error("Failed to move/reorder item");
      }
    },
    [moveNote, moveFolder, notes, reloadSettings, refreshNotes, settings, updateSettings],
  );

  // Sync input with search query
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);

      // Debounce search
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        search(value);
      }, 220);
    },
    [search],
  );

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        // Closing search — clear query
        setInputValue("");
        clearSearch();
      } else {
        // Opening search — clear multi-selection
        setMultiSelectedNoteIds(new Set());
      }
      return !prev;
    });
  }, [clearSearch]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      // Small delay to ensure the input is rendered
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [searchOpen]);

  // Global shortcut hook: open and focus sidebar search
  useEffect(() => {
    const handleOpenSidebarSearch = () => {
      setSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    };

    window.addEventListener("open-sidebar-search", handleOpenSidebarSearch);
    return () =>
      window.removeEventListener(
        "open-sidebar-search",
        handleOpenSidebarSearch,
      );
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (inputValue) {
          // First escape: clear search
          setInputValue("");
          clearSearch();
        } else {
          // Second escape: close search
          closeSearch();
        }
      }
    },
    [inputValue, clearSearch, closeSearch],
  );

  const handleClearSearch = useCallback(() => {
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  const handleNewFolder = useCallback(() => {
    const lastSlash = selectedNoteId?.lastIndexOf("/") ?? -1;
    setFolderDialogParent(
      lastSlash > 0 ? selectedNoteId!.substring(0, lastSlash) : "",
    );
    setFolderDialogOpen(true);
  }, [selectedNoteId]);

  const handleFolderDialogConfirm = useCallback(
    async (name: string) => {
      try {
        await createFolder(folderDialogParent, name);
        setFolderDialogOpen(false);
      } catch (error) {
        console.error("Failed to create folder:", error);
        toast.error("Failed to create folder");
      }
    },
    [createFolder, folderDialogParent],
  );

  // Listen for create-new-folder event (from command palette / keyboard shortcut)
  useEffect(() => {
    const handleCreateFolder = () => {
      // Derive parent folder from currently selected note
      const lastSlash = selectedNoteId?.lastIndexOf("/") ?? -1;
      setFolderDialogParent(
        lastSlash > 0 ? selectedNoteId!.substring(0, lastSlash) : "",
      );
      setFolderDialogOpen(true);
    };

    window.addEventListener("create-new-folder", handleCreateFolder);
    return () =>
      window.removeEventListener("create-new-folder", handleCreateFolder);
  }, [selectedNoteId]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        window.removeEventListener("pointermove", handlePointerMove);
        setDragLabel(null);
        setDragOverInfo(null);
      }}
    >
    <div className="relative w-full h-full bg-bg-secondary border-r border-border flex flex-col select-none">
      {/* Drag region */}
      {!isWindows && <div className="h-11 shrink-0" data-tauri-drag-region></div>}
      <div className={`flex items-center justify-between pl-4 pr-3 pb-2 border-b border-border shrink-0${isWindows ? " pt-2" : ""}`}>
        <div className="flex items-center gap-1">
          <div className="font-medium text-base">Notes</div>
          <div className="text-text-muted font-medium text-2xs min-w-4.75 h-4.75 flex items-center justify-center px-1 bg-bg-muted rounded-sm mt-0.5 pt-px">
            {notes.length}
          </div>
        </div>
        <div className="flex items-center gap-px">
          <IconButton
            onClick={toggleSearch}
            title={`Search Notes (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}F)`}
          >
            {searchOpen ? (
              <SearchOffIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            ) : (
              <SearchIcon className="w-4.25 h-4.25 stroke-[1.5]" />
            )}
          </IconButton>
          {foldersEnabled ? (
            <DropdownMenu.Root
              open={plusMenuOpen}
              onOpenChange={setPlusMenuOpen}
            >
              <DropdownMenu.Trigger asChild>
                <IconButton
                  variant="ghost"
                  title="New Note or Folder"
                >
                  <PlusIcon className="w-5.25 h-5.25 stroke-[1.4]" />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-40 bg-bg border border-border rounded-md shadow-lg py-1 z-50"
                  sideOffset={5}
                  align="end"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DropdownMenu.Item
                    className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                    onSelect={() => createNote()}
                  >
                    <AddNoteIcon className="w-4 h-4 stroke-[1.6]" />
                    <span className="flex-1">New Note</span>
                    <kbd className="text-xs text-text-muted ml-2">
                      {mod}
                      {isMac ? "" : "+"}N
                    </kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2"
                    onSelect={handleNewFolder}
                  >
                    <FolderPlusIcon className="w-4 h-4 stroke-[1.6]" />
                    New Folder
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <IconButton
              variant="ghost"
              onClick={() => createNote()}
              title={`New Note (${mod}${isMac ? "" : "+"}N)`}
            >
              <PlusIcon className="w-5.25 h-5.25 stroke-[1.4]" />
            </IconButton>
          )}
        </div>
      </div>
      {/* Scrollable area with search and notes */}
      <div className="flex-1 overflow-y-auto">
        {/* Search - sticky at top */}
        {searchOpen && (
          <div className="sticky top-0 z-10 px-2 pt-2 bg-bg-secondary">
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="text"
                value={inputValue}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search notes..."
                className="h-9 pr-8 text-sm"
              />
              {inputValue && (
                <button
                  onClick={handleClearSearch}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Note list */}
        <NoteList
          multiSelectedNoteIds={multiSelectedNoteIds}
          setMultiSelectedNoteIds={setMultiSelectedNoteIds}
          lastClickedNoteId={lastClickedNoteId}
          setLastClickedNoteId={setLastClickedNoteId}
          dragOverInfo={dragOverInfo}
        />
      </div>

      {/* Footer with git status, commit, and settings */}
      <Footer onOpenSettings={onOpenSettings} />

      {/* Folder name dialog */}
      <FolderNameDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        onConfirm={handleFolderDialogConfirm}
        title="Create new folder"
        description="Enter a name for your new folder"
        confirmLabel="Create"
      />
    </div>

    {/* Drag overlay — floating label while dragging */}
    <DragOverlay dropAnimation={null}>
      {dragLabel && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg border border-border rounded-md shadow-lg text-sm text-text">
          <NoteIcon className="w-3.5 h-3.5 stroke-[1.6] opacity-50 shrink-0" />
          {dragLabel}
          {dragCount > 1 && (
            <span className="ml-1 px-1.5 py-0.5 bg-accent text-text-inverse text-xs rounded-full leading-none">
              +{dragCount - 1}
            </span>
          )}
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
