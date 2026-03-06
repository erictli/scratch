import {
  useCallback,
  useMemo,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotesData, useNotesActions } from "../../context/NotesContext";
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
import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "../icons";
import { cleanTitle } from "../../lib/utils";
import { getDisplayItems } from "../../lib/noteSelectors";

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

// Memoized note item component
interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  showFolderPrefix?: boolean;
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
  showFolderPrefix = true,
}: NoteItemProps) {
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  const folder = id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : null;
  const displayPreview = folder && showFolderPrefix
    ? preview ? `${folder}/ · ${preview}` : `${folder}/`
    : preview;

  return (
    <ListItem
      title={cleanTitle(title)}
      subtitle={displayPreview}
      meta={formatDate(modified)}
      isSelected={isSelected}
      isPinned={isPinned}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
});

interface DisplayItem {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

interface FolderTreeNode {
  name: string;
  path: string;
  children: Map<string, FolderTreeNode>;
  notes: DisplayItem[];
}

function buildFolderTree(items: DisplayItem[]): FolderTreeNode {
  const root: FolderTreeNode = {
    name: "",
    path: "",
    children: new Map(),
    notes: [],
  };

  for (const item of items) {
    const parts = item.id.split("/");
    if (parts.length === 1) {
      root.notes.push(item);
      continue;
    }

    let current = root;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let child = current.children.get(name);
      if (!child) {
        child = {
          name,
          path: currentPath,
          children: new Map(),
          notes: [],
        };
        current.children.set(name, child);
      }
      current = child;
    }

    current.notes.push(item);
  }

  return root;
}

interface NoteListProps {
  focusSignal?: number;
  toggleAllFoldersSignal?: number;
  onFolderTreeStateChange?: (allExpanded: boolean) => void;
}

export function NoteList({
  focusSignal = 0,
  toggleAllFoldersSignal = 0,
  onFolderTreeStateChange,
}: NoteListProps) {
  const {
    notes,
    notesFolder,
    pinnedNoteIds,
    selectedNoteId,
    isLoading,
    searchQuery,
    searchResults,
  } = useNotesData();
  const { selectNote, deleteNote, duplicateNote, togglePinNote } =
    useNotesActions();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHandledToggleSignalRef = useRef(0);

  // Calculate pinned IDs set for efficient lookup
  const pinnedIds = useMemo(
    () => new Set(pinnedNoteIds),
    [pinnedNoteIds]
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
                await togglePinNote(noteId);
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
                if (notesFolder) {
                  const filepath = `${notesFolder}/${noteId}.md`;
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
    [pinnedIds, togglePinNote, duplicateNote, notesFolder]
  );

  const displayItems = useMemo(
    () => getDisplayItems(notes, searchQuery, searchResults),
    [notes, searchQuery, searchResults],
  );

  const folderTree = useMemo(
    () => buildFolderTree(displayItems),
    [displayItems]
  );

  const allFolderPaths = useMemo(() => {
    const paths: string[] = [];
    const walk = (node: FolderTreeNode) => {
      for (const child of node.children.values()) {
        paths.push(child.path);
        walk(child);
      }
    };
    walk(folderTree);
    return paths;
  }, [folderTree]);

  useEffect(() => {
    if (!selectedNoteId || !selectedNoteId.includes("/")) return;

    const parts = selectedNoteId.split("/");
    const ancestors = new Set<string>();
    let path = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      path = path ? `${path}/${parts[i]}` : parts[i];
      ancestors.add(path);
    }

    setExpandedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedNoteId]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAllFolders = useCallback(() => {
    if (allFolderPaths.length === 0) return;
    setExpandedFolders((prev) => {
      const allExpanded = allFolderPaths.every((path) => prev.has(path));
      return allExpanded ? new Set<string>() : new Set(allFolderPaths);
    });
  }, [allFolderPaths]);

  useEffect(() => {
    const allExpanded =
      allFolderPaths.length > 0 &&
      allFolderPaths.every((path) => expandedFolders.has(path));
    onFolderTreeStateChange?.(allExpanded);
  }, [expandedFolders, allFolderPaths, onFolderTreeStateChange]);

  useEffect(() => {
    if (focusSignal === 0) return;
    containerRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (
      toggleAllFoldersSignal === 0 ||
      toggleAllFoldersSignal === lastHandledToggleSignalRef.current
    ) {
      return;
    }
    lastHandledToggleSignalRef.current = toggleAllFoldersSignal;
    toggleAllFolders();
  }, [toggleAllFoldersSignal, toggleAllFolders]);

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted select-none">
        Loading...
      </div>
    );
  }

  if (searchQuery.trim() && displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No notes yet
      </div>
    );
  }

  const renderFolderTree = (node: FolderTreeNode, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];

    const childFolders = Array.from(node.children.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const folder of childFolders) {
      const isExpanded = expandedFolders.has(folder.path);
      rows.push(
        <button
          key={`folder-${folder.path}`}
          onClick={() => toggleFolder(folder.path)}
          className="w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-md hover:bg-bg-muted text-text-muted hover:text-text transition-colors"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {isExpanded ? (
            <ChevronDownIcon className="w-3.5 h-3.5 stroke-[1.9] shrink-0" />
          ) : (
            <ChevronRightIcon className="w-3.5 h-3.5 stroke-[1.9] shrink-0" />
          )}
          <FolderIcon className="w-3.75 h-3.75 stroke-[1.9] shrink-0" />
          <span className="text-xs font-medium truncate">{folder.name}</span>
        </button>
      );

      if (isExpanded) {
        rows.push(...renderFolderTree(folder, depth + 1));
      }
    }

    for (const item of node.notes) {
      rows.push(
        <div
          key={item.id}
          style={{ paddingLeft: `${depth > 0 ? 8 + depth * 14 : 0}px` }}
        >
          <NoteItem
            id={item.id}
            title={item.title}
            preview={item.preview}
            modified={item.modified}
            isSelected={selectedNoteId === item.id}
            isPinned={pinnedIds.has(item.id)}
            onSelect={selectNote}
            onContextMenu={handleContextMenu}
            showFolderPrefix={false}
          />
        </div>
      );
    }

    return rows;
  };

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex flex-col gap-1 p-1.5 outline-none"
      >
        {searchQuery.trim()
          ? displayItems.map((item) => (
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
          : renderFolderTree(folderTree, 0)}
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
