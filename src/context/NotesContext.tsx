import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import type { Note, NoteMetadata } from "../types/note";
import * as notesService from "../services/notes";
import type { SearchResult } from "../services/notes";

// Separate contexts to prevent unnecessary re-renders
// Data context: changes frequently, only subscribed by components that need the data
interface NotesDataContextValue {
  notes: NoteMetadata[];
  selectedNoteId: string | null;
  currentNote: Note | null;
  notesFolder: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
}

// Actions context: stable references, rarely causes re-renders
interface NotesActionsContextValue {
  selectNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  setNotesFolder: (path: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
}

const NotesDataContext = createContext<NotesDataContextValue | null>(null);
const NotesActionsContext = createContext<NotesActionsContextValue | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [notesFolder, setNotesFolderState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const refreshNotes = useCallback(async () => {
    if (!notesFolder) return;
    try {
      const notesList = await notesService.listNotes();
      setNotes(notesList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }, [notesFolder]);

  const selectNote = useCallback(async (id: string) => {
    try {
      // Set selected ID immediately for responsive UI
      setSelectedNoteId(id);
      const note = await notesService.readNote(id);
      setCurrentNote(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
    }
  }, []);

  const createNote = useCallback(async () => {
    try {
      const note = await notesService.createNote();
      await refreshNotes();
      setCurrentNote(note);
      setSelectedNoteId(note.id);
      // Clear search when creating a new note
      setSearchQuery("");
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    }
  }, [refreshNotes]);

  const saveNote = useCallback(
    async (content: string) => {
      if (!currentNote) return;
      try {
        const updated = await notesService.saveNote(currentNote.id, content);
        setCurrentNote(updated);
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save note");
      }
    },
    [currentNote, refreshNotes]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await notesService.deleteNote(id);
        // Only clear selection if we're deleting the currently selected note
        setSelectedNoteId((prevId) => {
          if (prevId === id) {
            setCurrentNote(null);
            return null;
          }
          return prevId;
        });
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete note");
      }
    },
    [refreshNotes]
  );

  const duplicateNote = useCallback(
    async (id: string) => {
      try {
        const newNote = await notesService.duplicateNote(id);
        await refreshNotes();
        setCurrentNote(newNote);
        setSelectedNoteId(newNote.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to duplicate note");
      }
    },
    [refreshNotes]
  );

  const setNotesFolder = useCallback(async (path: string) => {
    try {
      await notesService.setNotesFolder(path);
      setNotesFolderState(path);
      // Start file watcher after setting folder
      await notesService.startFileWatcher();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set notes folder"
      );
    }
  }, []);

  const search = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await notesService.searchNotes(query);
      setSearchResults(results);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Load initial state
  useEffect(() => {
    async function init() {
      try {
        const folder = await notesService.getNotesFolder();
        setNotesFolderState(folder);
        if (folder) {
          const notesList = await notesService.listNotes();
          setNotes(notesList);
          // Start file watcher
          await notesService.startFileWatcher();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Listen for file change events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen("file-change", () => {
      // Refresh notes when files change externally
      refreshNotes();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshNotes]);

  // Refresh notes when folder changes
  useEffect(() => {
    if (notesFolder) {
      refreshNotes();
    }
  }, [notesFolder, refreshNotes]);

  // Memoize data context value to prevent unnecessary re-renders
  const dataValue = useMemo<NotesDataContextValue>(
    () => ({
      notes,
      selectedNoteId,
      currentNote,
      notesFolder,
      isLoading,
      error,
      searchQuery,
      searchResults,
      isSearching,
    }),
    [
      notes,
      selectedNoteId,
      currentNote,
      notesFolder,
      isLoading,
      error,
      searchQuery,
      searchResults,
      isSearching,
    ]
  );

  // Memoize actions context value - these are stable callbacks
  const actionsValue = useMemo<NotesActionsContextValue>(
    () => ({
      selectNote,
      createNote,
      saveNote,
      deleteNote,
      duplicateNote,
      refreshNotes,
      setNotesFolder,
      search,
      clearSearch,
    }),
    [
      selectNote,
      createNote,
      saveNote,
      deleteNote,
      duplicateNote,
      refreshNotes,
      setNotesFolder,
      search,
      clearSearch,
    ]
  );

  return (
    <NotesActionsContext.Provider value={actionsValue}>
      <NotesDataContext.Provider value={dataValue}>
        {children}
      </NotesDataContext.Provider>
    </NotesActionsContext.Provider>
  );
}

// Hook to get notes data (subscribes to data changes)
export function useNotesData() {
  const context = useContext(NotesDataContext);
  if (!context) {
    throw new Error("useNotesData must be used within a NotesProvider");
  }
  return context;
}

// Hook to get notes actions (stable references, rarely causes re-renders)
export function useNotesActions() {
  const context = useContext(NotesActionsContext);
  if (!context) {
    throw new Error("useNotesActions must be used within a NotesProvider");
  }
  return context;
}

// Combined hook for convenience (backward compatible)
export function useNotes() {
  const data = useNotesData();
  const actions = useNotesActions();
  return { ...data, ...actions };
}
