import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  hasExternalChanges: boolean;
  reloadVersion: number;
}

// Actions context: stable references, rarely causes re-renders
interface NotesActionsContextValue {
  selectNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  saveNote: (content: string, noteId?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  reloadCurrentNote: () => Promise<void>;
  setNotesFolder: (path: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  pinNote: (id: string) => Promise<void>;
  unpinNote: (id: string) => Promise<void>;
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
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  // Increments when user manually refreshes, so Editor knows to reload content
  const [reloadVersion, setReloadVersion] = useState(0);

  // Track recently saved note IDs to ignore file-change events from our own saves
  const recentlySavedRef = useRef<Set<string>>(new Set());
  // Track pending refresh timeout to debounce refreshes during rapid saves
  const refreshTimeoutRef = useRef<number | null>(null);
  // Ref to access selectedNoteId in file watcher without re-registering listener
  const selectedNoteIdRef = useRef<string | null>(null);
  selectedNoteIdRef.current = selectedNoteId;
  // Ref to access notes in search callback without re-creating it on every notes change
  const notesRef = useRef<NoteMetadata[]>([]);
  notesRef.current = notes;
  // Monotonic counter to ignore stale async search responses
  const searchRequestIdRef = useRef(0);

  const refreshNotes = useCallback(async () => {
    if (!notesFolder) return;
    try {
      const notesList = await notesService.listNotes();
      setNotes(notesList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }, [notesFolder]);

  // Debounced refresh - coalesces rapid saves into a single refresh
  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshNotes();
    }, 300);
  }, [refreshNotes]);

  const selectNote = useCallback(async (id: string) => {
    try {
      // Set selected ID immediately for responsive UI
      setSelectedNoteId(id);
      setHasExternalChanges(false);
      const note = await notesService.readNote(id);
      setCurrentNote(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
    }
  }, []);

  const reloadCurrentNote = useCallback(async () => {
    if (!selectedNoteIdRef.current) return;
    try {
      const note = await notesService.readNote(selectedNoteIdRef.current);
      setCurrentNote(note);
      setHasExternalChanges(false);
      setReloadVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload note");
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
    async (content: string, noteId?: string) => {
      // Use provided noteId (for flush saves) or fall back to currentNote.id
      const savingNoteId = noteId || currentNote?.id;
      if (!savingNoteId) return;
      let updatedId: string | null = null;

      try {
        // Mark this note as recently saved to ignore file-change events from our own save
        recentlySavedRef.current.add(savingNoteId);

        const updated = await notesService.saveNote(savingNoteId, content);
        updatedId = updated.id;

        // If the note was renamed (ID changed), also mark the new ID
        if (updated.id !== savingNoteId) {
          recentlySavedRef.current.add(updated.id);

          // Transfer pin status to new ID
          const currentSettings = await notesService.getSettings();
          const pinnedIds = currentSettings.pinnedNoteIds || [];
          if (pinnedIds.includes(savingNoteId)) {
            const updatedSettings = {
              ...currentSettings,
              pinnedNoteIds: pinnedIds.map((id) =>
                id === savingNoteId ? updated.id : id
              ),
            };
            await notesService.updateSettings(updatedSettings);
          }
        }

        // Clear external changes flag - if it was set by our own save, we want to ignore it
        setHasExternalChanges(false);

        // Only update state if we're still on the same note we started saving
        // This prevents race conditions when user switches notes during save
        setSelectedNoteId((prevId) => {
          if (prevId === savingNoteId) {
            // Update to the new ID if the note was renamed
            setCurrentNote(updated);
            return updated.id;
          }
          // User switched to a different note, don't update current note
          return prevId;
        });

        // Schedule refresh with debounce - avoids blocking typing during rapid saves
        scheduleRefresh();

        // Clear the recently saved flag after a short delay
        // (longer than the file watcher debounce of 500ms)
        setTimeout(() => {
          recentlySavedRef.current.delete(savingNoteId);
          if (updatedId) recentlySavedRef.current.delete(updatedId);
        }, 1000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save note");
        // Clean up immediately on error to avoid leaving stale entries
        recentlySavedRef.current.delete(savingNoteId);
        if (updatedId) recentlySavedRef.current.delete(updatedId);
      }
    },
    [currentNote, scheduleRefresh]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        await notesService.deleteNote(id);

        // Clean up pinned status for deleted note
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];
        if (pinnedIds.includes(id)) {
          const updatedSettings = {
            ...currentSettings,
            pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
          };
          await notesService.updateSettings(updatedSettings);
        }

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

  const pinNote = useCallback(
    async (id: string) => {
      try {
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];

        if (!pinnedIds.includes(id)) {
          const updatedSettings = {
            ...currentSettings,
            pinnedNoteIds: [...pinnedIds, id],
          };
          await notesService.updateSettings(updatedSettings);
          await refreshNotes();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to pin note");
      }
    },
    [refreshNotes]
  );

  const unpinNote = useCallback(
    async (id: string) => {
      try {
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];

        const updatedSettings = {
          ...currentSettings,
          pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
        };
        await notesService.updateSettings(updatedSettings);
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to unpin note");
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
    const requestId = ++searchRequestIdRef.current;
    setSearchQuery(query);

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const queryLower = trimmedQuery.toLowerCase();
    // Instant local results for responsive UX while full-text search runs.
    const instantResults: SearchResult[] = notesRef.current
      .filter(
        (note) =>
          note.title.toLowerCase().includes(queryLower) ||
          note.preview.toLowerCase().includes(queryLower),
      )
      .slice(0, 20)
      .map((note) => ({
        id: note.id,
        title: note.title,
        preview: note.preview,
        modified: note.modified,
        score: 0,
      }));

    // Keep previous visible results while typing if there is no instant match yet.
    // This avoids the "loading -> no results -> loading" flicker.
    if (instantResults.length > 0) {
      setSearchResults(instantResults);
    }

    setIsSearching(true);
    try {
      const results = await notesService.searchNotes(trimmedQuery);
      if (requestId !== searchRequestIdRef.current) return;
      if (results.length === 0) {
        // If neither backend nor instant matches found, clear results only now
        // (after async search settles) to avoid transient empty states.
        setSearchResults(instantResults);
      } else {
        // Merge backend + instant results, deduping by note id.
        const merged = [...results];
        const seen = new Set(results.map((result) => result.id));
        for (const result of instantResults) {
          if (!seen.has(result.id)) {
            merged.push(result);
          }
        }
        setSearchResults(merged);
      }
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error("Search failed:", err);
    } finally {
      if (requestId !== searchRequestIdRef.current) return;
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    searchRequestIdRef.current += 1;
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
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

  // Listen for file change events and notify if current note changed externally
  useEffect(() => {
    let isCancelled = false;
    let unlisten: (() => void) | undefined;

    listen<{ changed_ids: string[] }>("file-change", (event) => {
      // Don't process if effect was cleaned up
      if (isCancelled) return;

      const changedIds = event.payload.changed_ids || [];

      // Filter out notes we recently saved ourselves
      const externalChanges = changedIds.filter(
        (id) => !recentlySavedRef.current.has(id)
      );

      // Only refresh if there are external changes
      if (externalChanges.length > 0) {
        refreshNotes();

        // If the currently selected note was changed externally, set flag (don't auto-reload)
        const currentId = selectedNoteIdRef.current;
        if (currentId && externalChanges.includes(currentId)) {
          setHasExternalChanges(true);
        }
      }
    }).then((fn) => {
      if (isCancelled) {
        // Effect was cleaned up before listener registered, clean up immediately
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      isCancelled = true;
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
      hasExternalChanges,
      reloadVersion,
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
      hasExternalChanges,
      reloadVersion,
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
      reloadCurrentNote,
      setNotesFolder,
      search,
      clearSearch,
      pinNote,
      unpinNote,
    }),
    [
      selectNote,
      createNote,
      saveNote,
      deleteNote,
      duplicateNote,
      refreshNotes,
      reloadCurrentNote,
      setNotesFolder,
      search,
      clearSearch,
      pinNote,
      unpinNote,
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
