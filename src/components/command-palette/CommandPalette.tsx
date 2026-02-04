import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { useGit } from "../../context/GitContext";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";
import {
  CommandItem,
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
import { duplicateNote } from "../../services/notes";
import {
  CopyIcon,
  SettingsIcon,
  SwatchIcon,
  GitCommitIcon,
  UploadIcon,
  AddNoteIcon,
  TrashIcon,
  PinIcon,
} from "../icons";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
}: CommandPaletteProps) {
  const {
    notes,
    selectNote,
    createNote,
    deleteNote,
    currentNote,
    refreshNotes,
    pinNote,
    unpinNote,
  } = useNotes();
  const { theme, setTheme } = useTheme();
  const { status, gitAvailable, commit, push } = useGit();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [localSearchResults, setLocalSearchResults] = useState<
    { id: string; title: string; preview: string; modified: number }[]
  >([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load settings when palette opens or current note changes
  useEffect(() => {
    if (open) {
      notesService.getSettings().then(setSettings);
    }
  }, [open, currentNote?.id]);

  // Memoize commands array
  const commands = useMemo<Command[]>(() => {
    const baseCommands: Command[] = [
      {
        id: "new-note",
        label: "New Note",
        shortcut: "⌘ N",
        icon: <AddNoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          createNote();
          onClose();
        },
      },
      {
        id: "settings",
        label: "Settings",
        shortcut: "⌘ ,",
        icon: <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          onOpenSettings?.();
          onClose();
        },
      },
      {
        id: "theme-light",
        label: `Switch Theme to Light Mode`,
        icon: <SwatchIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          setTheme("light");
          onClose();
        },
      },
      {
        id: "theme-dark",
        label: `Switch Theme to Dark Mode`,
        icon: <SwatchIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          setTheme("dark");
          onClose();
        },
      },
      {
        id: "theme-system",
        label: `Switch Theme to System Mode`,
        icon: <SwatchIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
        action: () => {
          setTheme("system");
          onClose();
        },
      },
    ];

    // Add note-specific commands if a note is selected
    if (currentNote) {
      const isPinned = settings?.pinnedNoteIds?.includes(currentNote.id) || false;

      baseCommands.push(
        {
          id: isPinned ? "unpin-note" : "pin-note",
          label: isPinned ? "Unpin Current Note" : "Pin Current Note",
          icon: <PinIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              if (isPinned) {
                await unpinNote(currentNote.id);
              } else {
                await pinNote(currentNote.id);
              }
              onClose();
            } catch (error) {
              console.error("Failed to pin/unpin note:", error);
              toast.error(`Failed to ${isPinned ? "unpin" : "pin"} note`);
            }
          },
        },
        {
          id: "duplicate-note",
          label: "Duplicate Current Note",
          icon: <CopyIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              const newNote = await duplicateNote(currentNote.id);
              await refreshNotes();
              selectNote(newNote.id);
              onClose();
            } catch (error) {
              console.error("Failed to duplicate note:", error);
            }
          },
        },
        {
          id: "delete-note",
          label: "Delete Current Note",
          icon: <TrashIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: () => {
            setNoteToDelete(currentNote.id);
            setDeleteDialogOpen(true);
          },
        },
        {
          id: "copy-markdown",
          label: "Copy Note as Markdown",
          icon: <CopyIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              await invoke("copy_to_clipboard", { text: currentNote.content });
              toast.success("Copied as Markdown");
              onClose();
            } catch (error) {
              console.error("Failed to copy markdown:", error);
              toast.error("Failed to copy");
            }
          },
        },
        {
          id: "copy-plain",
          label: "Copy Note as Plain Text",
          icon: <CopyIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              // Remove markdown formatting for plain text
              const plainText = currentNote.content
                .replace(/^#{1,6}\s+/gm, "") // Remove headers
                .replace(/\*\*(.+?)\*\*/g, "$1") // Remove bold
                .replace(/\*(.+?)\*/g, "$1") // Remove italic
                .replace(/\[(.+?)\]\(.+?\)/g, "$1") // Remove links, keep text
                .replace(/`(.+?)`/g, "$1") // Remove inline code
                .replace(/^[-*+]\s+/gm, "") // Remove list markers
                .replace(/^\d+\.\s+/gm, "") // Remove numbered list markers
                .replace(/^>\s+/gm, ""); // Remove blockquotes
              await invoke("copy_to_clipboard", { text: plainText });
              toast.success("Copied as plain text");
              onClose();
            } catch (error) {
              console.error("Failed to copy plain text:", error);
              toast.error("Failed to copy");
            }
          },
        }
      );
    }

    // Add git commands if git is available and initialized
    if (gitAvailable && status?.isRepo) {
      const hasChanges = (status?.changedCount ?? 0) > 0;
      const canPush = status?.hasRemote && (status?.aheadCount ?? 0) > 0;

      if (hasChanges) {
        baseCommands.push({
          id: "git-commit",
          label: "Git: Quick Commit",
          icon: <GitCommitIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              await commit("Quick commit from Scratch");
              toast.success("Changes committed");
              onClose();
            } catch (error) {
              console.error("Failed to commit:", error);
              toast.error("Failed to commit");
            }
          },
        });
      }

      if (canPush) {
        baseCommands.push({
          id: "git-push",
          label: `Git: Push (${status?.aheadCount} commit${
            status?.aheadCount === 1 ? "" : "s"
          })`,
          icon: <UploadIcon className="w-4.5 h-4.5 stroke-[1.5]" />,
          action: async () => {
            try {
              await push();
              toast.success("Pushed to remote");
              onClose();
            } catch (error) {
              console.error("Failed to push:", error);
              toast.error("Failed to push");
            }
          },
        });
      }
    }

    return baseCommands;
  }, [
    createNote,
    currentNote,
    deleteNote,
    onClose,
    onOpenSettings,
    setTheme,
    theme,
    gitAvailable,
    status,
    commit,
    push,
    selectNote,
    refreshNotes,
    settings,
    pinNote,
    unpinNote,
  ]);

  // Debounced search using Tantivy (local state, doesn't affect sidebar)
  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setLocalSearchResults([]);
      return;
    }

    // Debounce search calls
    const timer = setTimeout(async () => {
      try {
        const results = await invoke<
          { id: string; title: string; preview: string; modified: number; score: number }[]
        >("search_notes", { query: trimmed });
        setLocalSearchResults(results);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, open]);

  // Clear local search when palette closes
  useEffect(() => {
    if (!open) {
      setLocalSearchResults([]);
    }
  }, [open]);

  // Use search results when searching, otherwise show all notes
  const filteredNotes = useMemo(() => {
    if (!query.trim()) return notes;
    return localSearchResults;
  }, [query, notes, localSearchResults]);

  // Memoize filtered commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const queryLower = query.toLowerCase();
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(queryLower)
    );
  }, [query, commands]);

  // Memoize all items (notes first, then commands)
  const allItems = useMemo(
    () => [
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
        icon: cmd.icon,
        action: cmd.action,
      })),
    ],
    [filteredNotes, filteredCommands, selectNote, onClose]
  );

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
      selectedItem?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const handleDeleteConfirm = useCallback(async () => {
    if (noteToDelete) {
      try {
        await deleteNote(noteToDelete);
        setNoteToDelete(null);
        setDeleteDialogOpen(false);
        onClose();
      } catch (error) {
        console.error("Failed to delete note:", error);
        toast.error("Failed to delete note");
      }
    }
  }, [noteToDelete, deleteNote, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (allItems[selectedIndex]) {
            allItems[selectedIndex].action();
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [allItems, selectedIndex, onClose]
  );

  if (!open) return null;

  const notesCount = Math.min(filteredNotes.length, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center py-11 px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full h-full max-h-108 max-w-2xl bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down flex flex-col">
        {/* Search input */}
        <div className="border-b border-border flex-none">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes or type a command..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full px-4.5 py-3.5 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto h-full p-2.5 flex-1">
          {allItems.length === 0 ? (
            <div className="text-sm font-medium opacity-50 text-text-muted p-2">
              No results found
            </div>
          ) : (
            <>
              {/* Notes section */}
              {filteredNotes.length > 0 && (
                <div className="space-y-0.5 mb-5">
                  <div className="text-sm font-medium text-text-muted px-2.5 py-1.5">
                    Notes
                  </div>
                  {filteredNotes.slice(0, 10).map((note, i) => {
                    const title = cleanTitle(note.title);
                    const firstLetter = title.charAt(0).toUpperCase();
                    // Clean subtitle: treat whitespace-only or &nbsp; as empty
                    const cleanSubtitle = note.preview
                      ?.replace(/&nbsp;/g, " ")
                      .replace(/\u00A0/g, " ")
                      .trim();
                    return (
                      <div key={note.id} data-index={i}>
                        <CommandItem
                          label={title}
                          subtitle={cleanSubtitle}
                          iconText={firstLetter}
                          variant="note"
                          isSelected={selectedIndex === i}
                          onClick={allItems[i].action}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Commands section */}
              {filteredCommands.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-text-muted px-2.5 py-1.5">
                    Commands
                  </div>
                  {filteredCommands.map((cmd, i) => {
                    const index = notesCount + i;
                    return (
                      <div key={cmd.id} data-index={index}>
                        <CommandItem
                          label={cmd.label}
                          shortcut={cmd.shortcut}
                          icon={cmd.icon}
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
    </div>
  );
}
