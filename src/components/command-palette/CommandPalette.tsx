import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { CommandItem } from "../ui";

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

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function CommandPalette({ open, onClose, onOpenSettings }: CommandPaletteProps) {
  const {
    notes,
    selectNote,
    createNote,
    deleteNote,
    currentNote,
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Memoize commands array
  const commands = useMemo<Command[]>(() => [
    {
      id: "new-note",
      label: "New Note",
      shortcut: "⌘N",
      action: () => {
        createNote();
        onClose();
      },
    },
    {
      id: "delete-note",
      label: "Delete Current Note",
      action: () => {
        if (currentNote) {
          deleteNote(currentNote.id);
        }
        onClose();
      },
    },
    {
      id: "settings",
      label: "Settings",
      shortcut: "⌘,",
      action: () => {
        onOpenSettings?.();
        onClose();
      },
    },
    {
      id: "theme-light",
      label: `Theme: Light${theme === "light" ? " ✓" : ""}`,
      action: () => {
        setTheme("light");
        onClose();
      },
    },
    {
      id: "theme-dark",
      label: `Theme: Dark${theme === "dark" ? " ✓" : ""}`,
      action: () => {
        setTheme("dark");
        onClose();
      },
    },
    {
      id: "theme-system",
      label: `Theme: System${theme === "system" ? " ✓" : ""}`,
      action: () => {
        setTheme("system");
        onClose();
      },
    },
  ], [createNote, currentNote, deleteNote, onClose, onOpenSettings, setTheme, theme]);

  // Memoize filtered notes
  const filteredNotes = useMemo(() => {
    if (!query.trim()) return notes;
    const queryLower = query.toLowerCase();
    return notes.filter((note) =>
      note.title.toLowerCase().includes(queryLower)
    );
  }, [query, notes]);

  // Memoize filtered commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const queryLower = query.toLowerCase();
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(queryLower)
    );
  }, [query, commands]);

  // Memoize all items (notes first, then commands)
  const allItems = useMemo(() => [
    ...filteredNotes.slice(0, 10).map((note) => ({
      type: "note" as const,
      id: note.id,
      label: cleanTitle(note.title),
      preview: note.preview,
      action: () => {
        selectNote(note.id);
        onClose();
      },
    })),
    ...filteredCommands.map((cmd) => ({
      type: "command" as const,
      id: cmd.id,
      label: cmd.label,
      shortcut: cmd.shortcut,
      action: cmd.action,
    })),
  ], [filteredNotes, filteredCommands, selectNote, onClose]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedItem = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      selectedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allItems[selectedIndex]) {
            allItems[selectedIndex].action();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [allItems, selectedIndex, onClose]
  );

  if (!open) return null;

  const notesCount = Math.min(filteredNotes.length, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-bg-secondary rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down">
        {/* Search input */}
        <div className="border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes or type a command..."
            className="w-full px-4 py-3 text-lg bg-transparent outline-none text-text placeholder-text-muted"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {allItems.length === 0 ? (
            <div className="p-4 text-center text-text-muted">
              No results found
            </div>
          ) : (
            <>
              {/* Notes section */}
              {filteredNotes.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
                    Notes
                  </div>
                  {filteredNotes.slice(0, 10).map((note, i) => (
                    <div key={note.id} data-index={i}>
                      <CommandItem
                        label={cleanTitle(note.title)}
                        subtitle={note.preview}
                        isSelected={selectedIndex === i}
                        onClick={allItems[i].action}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Commands section */}
              {filteredCommands.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wider border-t border-border">
                    Commands
                  </div>
                  {filteredCommands.map((cmd, i) => {
                    const index = notesCount + i;
                    return (
                      <div key={cmd.id} data-index={index}>
                        <CommandItem
                          label={cmd.label}
                          shortcut={cmd.shortcut}
                          isSelected={selectedIndex === index}
                          onClick={cmd.action}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
