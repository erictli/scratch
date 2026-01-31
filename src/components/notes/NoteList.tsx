import { useRef, useState, useEffect, useCallback, useMemo, memo } from "react";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import { ListItem } from "../ui";

// Clean title - remove nbsp and other invisible characters
function cleanTitle(title: string | undefined): string {
  if (!title) return "Untitled";
  const cleaned = title
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .trim();
  return cleaned || "Untitled";
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 24 hours
  if (diff < 86400000) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Less than 7 days
  if (diff < 604800000) {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  // Otherwise show date
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Memoized note item component
interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  enableAnimation: boolean;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const NoteItem = memo(function NoteItem({
  id,
  title,
  preview,
  modified,
  isSelected,
  enableAnimation,
  onSelect,
  onContextMenu,
}: NoteItemProps) {
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  return (
    <ListItem
      title={cleanTitle(title)}
      subtitle={preview}
      meta={formatDate(modified)}
      isSelected={isSelected}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      animateTitle={enableAnimation && isSelected}
    />
  );
});

export function NoteList() {
  const {
    notes,
    selectedNoteId,
    selectNote,
    deleteNote,
    duplicateNote,
    isLoading,
    searchQuery,
    searchResults,
  } = useNotes();

  // Track previous selection to detect switches vs edits
  const prevSelectedIdRef = useRef<string | null>(null);
  const [enableAnimation, setEnableAnimation] = useState(false);

  const handleContextMenu = useCallback(async (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();

    const menu = await Menu.new({
      items: [
        await MenuItem.new({
          text: "Duplicate",
          action: () => duplicateNote(noteId),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          text: "Delete",
          action: () => deleteNote(noteId),
        }),
      ],
    });

    await menu.popup();
  }, [duplicateNote, deleteNote]);

  // Disable animation when switching notes, enable after a delay
  useEffect(() => {
    if (selectedNoteId !== prevSelectedIdRef.current) {
      // Switched to a different note - disable animation temporarily
      setEnableAnimation(false);
      prevSelectedIdRef.current = selectedNoteId;

      // Re-enable animation after a brief delay
      const timer = setTimeout(() => setEnableAnimation(true), 150);
      return () => clearTimeout(timer);
    }
  }, [selectedNoteId]);

  // Memoize display items to prevent recalculation on every render
  const displayItems = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.preview,
        modified: r.modified,
      }));
    }
    return notes;
  }, [searchQuery, searchResults, notes]);

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted">
        Loading...
      </div>
    );
  }

  if (searchQuery.trim() && displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted">
        No results found
      </div>
    );
  }

  if (displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted">
        No notes yet
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {displayItems.map((item) => (
        <NoteItem
          key={item.id}
          id={item.id}
          title={item.title}
          preview={item.preview}
          modified={item.modified}
          isSelected={selectedNoteId === item.id}
          enableAnimation={enableAnimation}
          onSelect={selectNote}
          onContextMenu={handleContextMenu}
        />
      ))}
    </div>
  );
}
