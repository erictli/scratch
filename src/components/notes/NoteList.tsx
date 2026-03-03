import { useCallback, useMemo, memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import {
  ListItem,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui";
import { ChevronRightIcon, ChevronDownIcon, FolderIcon } from "../icons";
import { cleanTitle } from "../../lib/utils";
import * as notesService from "../../services/notes";
import type { NoteMetadata, Settings } from "../../types/note";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();

  // Get start of today, yesterday, etc. (midnight local time)
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  // Today: show time
  if (date >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // Yesterday
  if (date >= startOfYesterday) {
    return "Yesterday";
  }

  // Calculate days ago
  const daysAgo =
    Math.floor((startOfToday.getTime() - date.getTime()) / 86400000) + 1;

  // 2-6 days ago: show "X days ago"
  if (daysAgo <= 6) {
    return `${daysAgo} days ago`;
  }

  // This year: show month and day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Different year: show full date
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Folder tree types & helpers ---

interface FolderNode {
  path: string;       // full relative path, e.g. "work/projects"
  name: string;       // display segment, e.g. "projects"
  notes: NoteMetadata[];
  subfolders: FolderNode[];
}

function buildTree(notes: NoteMetadata[]): { rootNotes: NoteMetadata[]; folders: FolderNode[] } {
  const folderMap = new Map<string, FolderNode>();
  const rootNotes: NoteMetadata[] = [];

  for (const note of notes) {
    const slashIdx = note.id.lastIndexOf("/");
    if (slashIdx === -1) {
      rootNotes.push(note);
    } else {
      const folderPath = note.id.substring(0, slashIdx);
      // Ensure every ancestor folder node exists
      const segments = folderPath.split("/");
      let currentPath = "";
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        if (!folderMap.has(currentPath)) {
          folderMap.set(currentPath, { path: currentPath, name: segment, notes: [], subfolders: [] });
        }
      }
      folderMap.get(folderPath)!.notes.push(note);
    }
  }

  // Link child folders to their parent
  for (const [path, node] of folderMap) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash !== -1) {
      folderMap.get(path.substring(0, lastSlash))?.subfolders.push(node);
    }
  }

  // Collect top-level folders
  const folders: FolderNode[] = [];
  for (const [path, node] of folderMap) {
    if (!path.includes("/")) folders.push(node);
  }

  // Sort folders alphabetically at every level
  const sortFolders = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortFolders(n.subfolders);
  };
  sortFolders(folders);

  return { rootNotes, folders };
}

const COLLAPSED_KEY = "scratch-collapsed-folders";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s]));
  } catch { /* ignore */ }
}

// --- FolderRow ---

interface FolderRowProps {
  path: string;
  name: string;
  isCollapsed: boolean;
  onToggle: (path: string) => void;
}

const FolderRow = memo(function FolderRow({ path, name, isCollapsed, onToggle }: FolderRowProps) {
  const handleClick = useCallback(() => onToggle(path), [onToggle, path]);
  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-text-muted hover:text-text hover:bg-bg-muted rounded-md transition-colors cursor-pointer select-none text-left"
    >
      {isCollapsed
        ? <ChevronRightIcon className="w-3.5 h-3.5 shrink-0" />
        : <ChevronDownIcon className="w-3.5 h-3.5 shrink-0" />
      }
      <FolderIcon className="w-3.5 h-3.5 shrink-0" />
      <span className="text-xs font-medium truncate">{name}</span>
    </button>
  );
});

// --- Memoized note item component ---

interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  /** When true the note is rendered inside a folder header, so omit the folder prefix from subtitle */
  inTree?: boolean;
}

const NoteItem = memo(function NoteItem({
  id,
  title,
  preview,
  modified,
  isSelected,
  isPinned,
  onSelect,
  onContextMenu,
  inTree = false,
}: NoteItemProps) {
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  const folder = id.includes("/") ? id.substring(0, id.lastIndexOf("/")) : null;
  const filename = id.includes("/") ? id.substring(id.lastIndexOf("/") + 1) : id;
  const contentTitle = cleanTitle(title);
  const subtitleParts = [
    contentTitle !== "Untitled" ? contentTitle : undefined,
    preview,
  ].filter(Boolean);
  const displayPreview = (!inTree && folder)
    ? `${folder}/ · ${subtitleParts.join(" · ")}`
    : subtitleParts.join(" · ") || undefined;

  return (
    <ListItem
      title={filename}
      subtitle={displayPreview}
      meta={formatDate(modified)}
      isSelected={isSelected}
      isPinned={isPinned}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
});

// --- FolderTreeNode (recursive) ---

interface FolderTreeNodeProps {
  folder: FolderNode;
  collapsedFolders: Set<string>;
  onToggle: (path: string) => void;
  selectedNoteId: string | null;
  pinnedIds: Set<string>;
  selectNote: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function FolderTreeNode({
  folder,
  collapsedFolders,
  onToggle,
  selectedNoteId,
  pinnedIds,
  selectNote,
  onContextMenu,
}: FolderTreeNodeProps) {
  const isCollapsed = collapsedFolders.has(folder.path);
  return (
    <div>
      <FolderRow path={folder.path} name={folder.name} isCollapsed={isCollapsed} onToggle={onToggle} />
      {!isCollapsed && (
        <div className="ml-3 flex flex-col gap-0.5 mt-0.5">
          {folder.subfolders.map((sub) => (
            <FolderTreeNode
              key={sub.path}
              folder={sub}
              collapsedFolders={collapsedFolders}
              onToggle={onToggle}
              selectedNoteId={selectedNoteId}
              pinnedIds={pinnedIds}
              selectNote={selectNote}
              onContextMenu={onContextMenu}
            />
          ))}
          {folder.notes.map((note) => (
            <NoteItem
              key={note.id}
              id={note.id}
              title={note.title}
              preview={note.preview}
              modified={note.modified}
              isSelected={selectedNoteId === note.id}
              isPinned={pinnedIds.has(note.id)}
              onSelect={selectNote}
              onContextMenu={onContextMenu}
              inTree={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteList() {
  const {
    notes,
    selectedNoteId,
    selectNote,
    deleteNote,
    duplicateNote,
    pinNote,
    unpinNote,
    isLoading,
    searchQuery,
    searchResults,
  } = useNotes();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsed);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      saveCollapsed(next);
      return next;
    });
  }, []);

  // Load settings when notes change
  useEffect(() => {
    notesService
      .getSettings()
      .then(setSettings)
      .catch((error) => {
        console.error("Failed to load settings:", error);
      });
  }, [notes]);

  // Calculate pinned IDs set for efficient lookup
  const pinnedIds = useMemo(
    () => new Set(settings?.pinnedNoteIds || []),
    [settings]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (noteToDelete) {
      try {
        await deleteNote(noteToDelete);
        setNoteToDelete(null);
        setDeleteDialogOpen(false);
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    }
  }, [noteToDelete, deleteNote]);

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, noteId: string) => {
      e.preventDefault();
      const isPinned = pinnedIds.has(noteId);

      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: isPinned ? "Unpin" : "Pin",
            action: async () => {
              try {
                await (isPinned ? unpinNote(noteId) : pinNote(noteId));
                // Refresh settings after pin/unpin
                const newSettings = await notesService.getSettings();
                setSettings(newSettings);
              } catch (error) {
                console.error("Failed to pin/unpin note:", error);
              }
            },
          }),
          await MenuItem.new({
            text: "Duplicate",
            action: () => duplicateNote(noteId),
          }),
          await MenuItem.new({
            text: "Copy Filepath",
            action: async () => {
              try {
                const folder = await notesService.getNotesFolder();
                if (folder) {
                  const filepath = `${folder}/${noteId}.md`;
                  await invoke("copy_to_clipboard", { text: filepath });
                }
              } catch (error) {
                console.error("Failed to copy filepath:", error);
              }
            },
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Delete",
            action: () => {
              setNoteToDelete(noteId);
              setDeleteDialogOpen(true);
            },
          }),
        ],
      });

      await menu.popup();
    },
    [pinnedIds, pinNote, unpinNote, duplicateNote]
  );

  // Memoize display items for search mode (flat list)
  const searchItems = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchResults.map((r) => ({
      id: r.id,
      title: r.title,
      preview: r.preview,
      modified: r.modified,
    }));
  }, [searchQuery, searchResults]);

  // Memoize folder tree for normal (non-search) mode
  const { rootNotes, folders } = useMemo(
    () => (searchItems ? { rootNotes: [], folders: [] } : buildTree(notes)),
    [searchItems, notes]
  );

  // Listen for focus request from editor (when Escape is pressed)
  useEffect(() => {
    const handleFocusNoteList = () => {
      containerRef.current?.focus();
    };

    window.addEventListener("focus-note-list", handleFocusNoteList);
    return () =>
      window.removeEventListener("focus-note-list", handleFocusNoteList);
  }, []);

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted select-none">
        Loading...
      </div>
    );
  }

  if (searchItems !== null && searchItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (searchItems === null && notes.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No notes yet
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex flex-col gap-1 p-1.5 outline-none"
      >
        {searchItems !== null ? (
          // Search mode: flat list
          searchItems.map((item) => (
            <NoteItem
              key={item.id}
              id={item.id}
              title={item.title}
              preview={item.preview}
              modified={item.modified}
              isSelected={selectedNoteId === item.id}
              isPinned={pinnedIds.has(item.id)}
              onSelect={selectNote}
              onContextMenu={handleContextMenu}
            />
          ))
        ) : (
          // Normal mode: folder tree
          <>
            {folders.map((folder) => (
              <FolderTreeNode
                key={folder.path}
                folder={folder}
                collapsedFolders={collapsedFolders}
                onToggle={toggleFolder}
                selectedNoteId={selectedNoteId}
                pinnedIds={pinnedIds}
                selectNote={selectNote}
                onContextMenu={handleContextMenu}
              />
            ))}
            {rootNotes.map((note) => (
              <NoteItem
                key={note.id}
                id={note.id}
                title={note.title}
                preview={note.preview}
                modified={note.modified}
                isSelected={selectedNoteId === note.id}
                isPinned={pinnedIds.has(note.id)}
                onSelect={selectNote}
                onContextMenu={handleContextMenu}
              />
            ))}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the note and all its content. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
