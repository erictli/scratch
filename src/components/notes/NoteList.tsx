import { useCallback, useMemo, memo, useEffect, useRef, useState } from "react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
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
import { cleanTitle } from "../../lib/utils";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";

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
  className?: string;
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
  className = "",
}: NoteItemProps) {
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  return (
    <div className={className}>
      <ListItem
        title={cleanTitle(title)}
        subtitle={preview}
        meta={formatDate(modified)}
        isSelected={isSelected}
        isPinned={isPinned}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
});

// Grouped notes structure
interface GroupedNotes {
  root: DisplayItem[];
  folders: Map<string, DisplayItem[]>;
}

interface DisplayItem {
  id: string;
  title: string;
  preview?: string;
  folderPath?: string;
  modified: number;
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
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Group notes by folder
  const groupedNotes = useMemo((): GroupedNotes => {
    let items: DisplayItem[];
    
    if (searchQuery.trim()) {
      items = searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.preview,
        folderPath: r.folderPath,
        modified: r.modified,
      }));
    } else {
      items = notes.map((n) => ({
        id: n.id,
        title: n.title,
        preview: n.preview,
        folderPath: n.folderPath,
        modified: n.modified,
      }));
    }

    const root: DisplayItem[] = [];
    const folders = new Map<string, DisplayItem[]>();

    for (const item of items) {
      if (item.folderPath) {
        if (!folders.has(item.folderPath)) {
          folders.set(item.folderPath, []);
        }
        folders.get(item.folderPath)!.push(item);
      } else {
        root.push(item);
      }
    }

    return { root, folders };
  }, [searchQuery, searchResults, notes]);

  // Get sorted folder names
  const sortedFolderNames = useMemo(() => {
    return Array.from(groupedNotes.folders.keys()).sort((a, b) => 
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [groupedNotes.folders]);

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

  if (searchQuery.trim() && (groupedNotes.root.length === 0 && sortedFolderNames.length === 0)) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (groupedNotes.root.length === 0 && sortedFolderNames.length === 0) {
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
        {/* Root notes (no folder) - shown first without header */}
        {groupedNotes.root.map((item) => (
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
        ))}

        {/* Folder groups */}
        {sortedFolderNames.map((folderName) => (
          <div key={folderName} className="flex flex-col">
            {/* Folder header */}
            <div className="px-2 py-1 text-sm font-semibold text-text-muted select-none">
              {folderName}/
            </div>
            {/* Notes in this folder - indented */}
            <div className="pl-4 flex flex-col gap-1">
              {groupedNotes.folders.get(folderName)!.map((item) => (
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
              ))}
            </div>
          </div>
        ))}
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
