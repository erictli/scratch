import { useCallback, useEffect, useRef, useState } from "react";
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
import { mod, shift, isMac } from "../../lib/platform";
import * as notesService from "../../services/notes";
import { FolderNameDialog } from "../notes/FolderNameDialog";

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
  } = useNotes();
  const [searchOpen, setSearchOpen] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogParent, setFolderDialogParent] = useState("");
  const [foldersEnabled, setFoldersEnabled] = useState(true);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "note") {
      const noteId = data.id as string;
      const leaf = noteId.includes("/")
        ? noteId.substring(noteId.lastIndexOf("/") + 1)
        : noteId;
      setDragLabel(leaf);
    } else if (data?.type === "folder") {
      const path = data.path as string;
      const name = path.includes("/")
        ? path.substring(path.lastIndexOf("/") + 1)
        : path;
      setDragLabel(name);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDragLabel(null);
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;
      if (!activeData || !overData) return;

      const targetFolder = overData.path as string;

      try {
        if (activeData.type === "note") {
          const noteId = activeData.id as string;
          const noteParent = noteId.includes("/")
            ? noteId.substring(0, noteId.lastIndexOf("/"))
            : "";
          if (noteParent === targetFolder) return;
          await moveNote(noteId, targetFolder);
        } else if (activeData.type === "folder") {
          const folderPath = activeData.path as string;
          if (
            targetFolder === folderPath ||
            targetFolder.startsWith(folderPath + "/")
          )
            return;
          const folderParent = folderPath.includes("/")
            ? folderPath.substring(0, folderPath.lastIndexOf("/"))
            : "";
          if (folderParent === targetFolder) return;
          await moveFolder(folderPath, targetFolder);
        }

        // Expand target folder so the moved item is visible
        if (targetFolder) {
          window.dispatchEvent(
            new CustomEvent("expand-folder", { detail: targetFolder }),
          );
        }
      } catch (error) {
        console.error("Failed to move item:", error);
        toast.error("Failed to move item");
      }
    },
    [moveNote, moveFolder],
  );

  // Load folders setting
  useEffect(() => {
    notesService.getSettings().then((s) => {
      setFoldersEnabled(s.foldersEnabled === true);
    }).catch((error) => {
      console.error("Failed to load settings:", error);
      setFoldersEnabled(false);
    });
  }, []);

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
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
    <div className="relative w-64 h-full bg-bg-secondary border-r border-border flex flex-col select-none">
      {/* Drag region */}
      <div className="h-11 shrink-0" data-tauri-drag-region></div>
      <div className="flex items-center justify-between pl-4 pr-3 pb-2 border-b border-border shrink-0">
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
        <NoteList />
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
    <DragOverlay>
      {dragLabel && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg border border-border rounded-md shadow-lg text-sm text-text">
          <NoteIcon className="w-3.5 h-3.5 stroke-[1.6] opacity-50 shrink-0" />
          {dragLabel}
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
