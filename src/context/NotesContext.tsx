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
import { runWorkspaceSwitch } from "../lib/workspaceSwitch";
import {
  reconcileRemoteNote,
  resolveRemoteNoteId,
  type NoteSyncConflict,
} from "../lib/noteSync";
import { createSerializedTaskQueue } from "../lib/serializedWriter";
import {
  flushDraftBeforeRelocation,
  preserveDraftBeforeDeletion,
} from "../lib/documentMutationSafety";
import {
  runConflictResolution,
  type ConflictResolutionStrategy,
} from "../lib/conflictResolution";
import {
  DEFAULT_RESTORED_WINDOW_SESSION,
  readRestoredNote,
  restoreWindowSession,
  type RestoredWindowSession,
} from "../lib/windowSession";
import { getWindowSession } from "../services/windowSession";
import {
  clearDraftCheckpoint,
  getDraftCheckpoint,
  listDraftCheckpoints,
} from "../services/draftCheckpoint";
import { reconcileDraftCheckpoint } from "../lib/draftCheckpoint";

export interface OpenNoteDraftSnapshot {
  noteId: string | null;
  content: string;
  dirty: boolean;
}

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
  noteConflict: NoteSyncConflict | null;
  reloadVersion: number;
  restoredWindowSession: RestoredWindowSession;
  isWindowSessionRestored: boolean;
}

// Actions context: stable references, rarely causes re-renders
interface NotesActionsContextValue {
  selectNote: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  consumePendingNewNote: (id: string) => boolean;
  saveNote: (content: string, noteId?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  reloadCurrentNote: () => Promise<void>;
  setNotesFolder: (path: string) => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  syncNotesFolder: (path: string) => Promise<void>;
  registerWorkspaceTransitionFlush: (
    handler: () => Promise<void>,
  ) => () => void;
  registerOpenNoteDraft: (
    handler: () => OpenNoteDraftSnapshot,
  ) => () => void;
  flushCurrentDraft: () => Promise<void>;
  persistCurrentDraftRecovery: (
    reason: string,
  ) => Promise<string | undefined>;
  resolveNoteConflict: (
    strategy: ConflictResolutionStrategy,
  ) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  pinNote: (id: string) => Promise<void>;
  unpinNote: (id: string) => Promise<void>;
  createNoteInFolder: (folderPath: string) => Promise<void>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  renameFolder: (oldPath: string, newName: string) => Promise<void>;
  moveNote: (id: string, targetFolder: string) => Promise<void>;
  moveFolder: (path: string, targetParent: string) => Promise<void>;
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
  const [noteConflict, setNoteConflict] = useState<NoteSyncConflict | null>(
    null,
  );
  const noteConflictRef = useRef<NoteSyncConflict | null>(null);
  useEffect(() => {
    noteConflictRef.current = noteConflict;
  }, [noteConflict]);
  // Increments when user manually refreshes, so Editor knows to reload content
  const [reloadVersion, setReloadVersion] = useState(0);
  const [restoredWindowSession, setRestoredWindowSession] =
    useState<RestoredWindowSession>(DEFAULT_RESTORED_WINDOW_SESSION);
  const [isWindowSessionRestored, setIsWindowSessionRestored] = useState(false);

  // Track pending refresh timeout to debounce refreshes during rapid saves
  const refreshTimeoutRef = useRef<number | null>(null);
  // Ref to access selectedNoteId in file watcher without re-registering listener
  const selectedNoteIdRef = useRef<string | null>(null);
  selectedNoteIdRef.current = selectedNoteId;
  const currentNoteRef = useRef<Note | null>(null);
  currentNoteRef.current = currentNote;
  const notesFolderRef = useRef<string | null>(null);
  notesFolderRef.current = notesFolder;
  const noteRevisionByIdRef = useRef<Map<string, string>>(new Map());
  const saveQueueRef = useRef(createSerializedTaskQueue());
  const openNoteDraftRef = useRef<() => OpenNoteDraftSnapshot>(() => ({
    noteId: null,
    content: "",
    dirty: false,
  }));
  // Ref to access notes in search callback without re-creating it on every notes change
  const notesRef = useRef<NoteMetadata[]>([]);
  notesRef.current = notes;
  // Monotonic counter to ignore stale async note selection responses.
  const selectRequestIdRef = useRef(0);
  // Monotonic counter to ignore stale async search responses
  const searchRequestIdRef = useRef(0);
  // Tracks the ID of a newly created note so Editor can focus its title.
  const pendingNewNoteIdRef = useRef<string | null>(null);
  const workspaceTransitionFlushRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const workspaceTransitionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const registerWorkspaceTransitionFlush = useCallback(
    (handler: () => Promise<void>) => {
      workspaceTransitionFlushRef.current = handler;
      return () => {
        if (workspaceTransitionFlushRef.current === handler) {
          workspaceTransitionFlushRef.current = async () => undefined;
        }
      };
    },
    [],
  );

  const registerOpenNoteDraft = useCallback(
    (handler: () => OpenNoteDraftSnapshot) => {
      openNoteDraftRef.current = handler;
      return () => {
        if (openNoteDraftRef.current === handler) {
          openNoteDraftRef.current = () => ({
            noteId: null,
            content: "",
            dirty: false,
          });
        }
      };
    },
    [],
  );

  const flushCurrentDraft = useCallback(
    () => workspaceTransitionFlushRef.current(),
    [],
  );

  const persistCurrentDraftRecovery = useCallback(async (reason: string) => {
    const draft = openNoteDraftRef.current();
    if (!draft.dirty || !draft.noteId) return undefined;
    const note = currentNoteRef.current;
    const sourcePath =
      note && note.id === draft.noteId ? note.path : "";
    return notesService.persistRecoverySnapshot({
      noteId: draft.noteId,
      sourcePath,
      content: draft.content,
      reason,
    });
  }, []);

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
      if (
        selectedNoteIdRef.current &&
        selectedNoteIdRef.current !== id &&
        openNoteDraftRef.current().dirty
      ) {
        await workspaceTransitionFlushRef.current();
      }
      const requestId = ++selectRequestIdRef.current;
      if (pendingNewNoteIdRef.current !== id) {
        pendingNewNoteIdRef.current = null;
      }
      // Set selected ID immediately for responsive UI
      setSelectedNoteId(id);
      setHasExternalChanges(false);
      setNoteConflict(null);
      // Expand parent folders so the note is visible in the tree
      const lastSlash = id.lastIndexOf("/");
      if (lastSlash > 0) {
        window.dispatchEvent(
          new CustomEvent("expand-folder", {
            detail: id.substring(0, lastSlash),
          }),
        );
      }
      const note = await notesService.readNote(id);
      if (requestId !== selectRequestIdRef.current) return;
      noteRevisionByIdRef.current.set(note.id, note.revision);
      currentNoteRef.current = note;
      setCurrentNote(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
    }
  }, []);

  const reloadCurrentNote = useCallback(async () => {
    if (!selectedNoteIdRef.current) return;
    try {
      if (openNoteDraftRef.current().dirty) {
        await workspaceTransitionFlushRef.current();
      }
      const note = await notesService.readNote(selectedNoteIdRef.current);
      noteRevisionByIdRef.current.set(note.id, note.revision);
      currentNoteRef.current = note;
      setCurrentNote(note);
      setHasExternalChanges(false);
      setNoteConflict(null);
      setReloadVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload note");
    }
  }, []);

  const createNote = useCallback(async () => {
    try {
      if (openNoteDraftRef.current().dirty) {
        await workspaceTransitionFlushRef.current();
      }
      // Derive target folder from the selected note's parent path
      let targetFolder: string | undefined;
      if (selectedNoteIdRef.current) {
        const lastSlash = selectedNoteIdRef.current.lastIndexOf("/");
        if (lastSlash > 0) {
          targetFolder = selectedNoteIdRef.current.substring(0, lastSlash);
        }
      }
      const note = await notesService.createNote(targetFolder);
      selectRequestIdRef.current += 1;
      pendingNewNoteIdRef.current = note.id;
      noteRevisionByIdRef.current.set(note.id, note.revision);
      await refreshNotes();
      currentNoteRef.current = note;
      setCurrentNote(note);
      setSelectedNoteId(note.id);
      selectedNoteIdRef.current = note.id;
      setNoteConflict(null);
      // Clear search when creating a new note
      setSearchQuery("");
      setSearchResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    }
  }, [refreshNotes]);

  const consumePendingNewNote = useCallback((id: string) => {
    if (pendingNewNoteIdRef.current !== id) {
      pendingNewNoteIdRef.current = null;
      return false;
    }
    pendingNewNoteIdRef.current = null;
    return true;
  }, []);

  const saveNote = useCallback(
    (content: string, noteId?: string): Promise<void> => {
      const savingNoteId = noteId || currentNoteRef.current?.id;
      if (!savingNoteId) return Promise.resolve();

      return saveQueueRef.current(async () => {
        try {
          const expectedRevision =
            noteRevisionByIdRef.current.get(savingNoteId) ??
            (currentNoteRef.current?.id === savingNoteId
              ? currentNoteRef.current.revision
              : null);
          if (!expectedRevision) {
            console.error(`Missing base revision for ${savingNoteId}`);
            throw new Error(
              "Unable to save: the editor's base revision is missing. Please reload the note and try again.",
            );
          }

          const result = await notesService.saveNote(
            savingNoteId,
            content,
            expectedRevision,
          );
          if (result.status === "conflict") {
            let remote: Note | null = null;
            if (result.current) {
              try {
                remote = await notesService.readNote(savingNoteId);
              } catch {
                remote = null;
              }
            }
            if (selectedNoteIdRef.current === savingNoteId) {
              setNoteConflict(
                remote
                  ? { kind: "modified", remote }
                  : { kind: "deleted", remote: null },
              );
              setHasExternalChanges(true);
            }
            throw new Error(
              remote
                ? "Save conflict: a newer version is already on disk"
                : "Save conflict: the source note was deleted or moved",
            );
          }

          const updated = result.note;
          noteRevisionByIdRef.current.delete(savingNoteId);
          noteRevisionByIdRef.current.set(updated.id, updated.revision);

          if (updated.id !== savingNoteId) {
            const currentSettings = await notesService.getSettings();
            const pinnedIds = currentSettings.pinnedNoteIds || [];
            if (pinnedIds.includes(savingNoteId)) {
              await notesService.updateWorkspaceSettings({
                pinnedNoteIds: pinnedIds.map((id) =>
                  id === savingNoteId ? updated.id : id,
                ),
              });
            }
          }

          if (selectedNoteIdRef.current === savingNoteId) {
            selectedNoteIdRef.current = updated.id;
            currentNoteRef.current = updated;
            setSelectedNoteId(updated.id);
            setCurrentNote(updated);
            setNoteConflict(null);
            setHasExternalChanges(false);
          }
          scheduleRefresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save note");
          throw err;
        }
      });
    },
    [scheduleRefresh],
  );

  const resolveNoteConflict = useCallback(
    async (strategy: ConflictResolutionStrategy) => {
      const conflict = noteConflict;
      if (!conflict) return;
      const draft = openNoteDraftRef.current();
      if (!draft.noteId) {
        throw new Error("No open draft to resolve");
      }

      const applyResolvedNote = (note: Note | null) => {
        noteRevisionByIdRef.current.delete(draft.noteId!);
        currentNoteRef.current = note;
        selectedNoteIdRef.current = note?.id ?? null;
        if (note) {
          noteRevisionByIdRef.current.set(note.id, note.revision);
        }
        setCurrentNote(note);
        setSelectedNoteId(note?.id ?? null);
        setNoteConflict(null);
        setHasExternalChanges(false);
        setReloadVersion((version) => version + 1);
      };

      await runConflictResolution(
        strategy,
        { draft, remote: conflict.remote },
        {
          persistRecovery: () =>
            persistCurrentDraftRecovery(`conflict-${strategy}`),
          overwriteRemote: async (localDraft, remote) => {
            const result = await notesService.saveNote(
              remote.id,
              localDraft.content,
              remote.revision,
            );
            if (result.status === "conflict") {
              throw new Error("The disk version changed again; conflict preserved");
            }
            applyResolvedNote(result.note);
          },
          recreateDeleted: async (localDraft) => {
            const slash = draft.noteId!.lastIndexOf("/");
            const folder = slash > 0 ? draft.noteId!.slice(0, slash) : undefined;
            const created = await notesService.createNote(folder);
            const result = await notesService.saveNote(
              created.id,
              localDraft.content,
              created.revision,
            );
            if (result.status === "conflict") {
              throw new Error("Could not recreate the deleted note safely");
            }
            applyResolvedNote(result.note);
          },
          acceptRemote: async (remote) => {
            applyResolvedNote(remote);
          },
        },
      );
      await clearDraftCheckpoint({
        windowLabel: "",
        noteId: draft.noteId,
      });
      await refreshNotes();
    },
    [noteConflict, persistCurrentDraftRecovery, refreshNotes],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      try {
        const draft = openNoteDraftRef.current();
        await preserveDraftBeforeDeletion(
          draft,
          draft.noteId === id,
          () => persistCurrentDraftRecovery("delete-note"),
        );
        await notesService.deleteNote(id);

        // Clean up pinned status for deleted note
        const currentSettings = await notesService.getSettings();
        const pinnedIds = currentSettings.pinnedNoteIds || [];
        if (pinnedIds.includes(id)) {
          const updatedSettings = {
            pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
          };
          await notesService.updateWorkspaceSettings(updatedSettings);
        }

        // Only clear selection if we're deleting the currently selected note
        if (selectedNoteIdRef.current === id) {
          selectedNoteIdRef.current = null;
          currentNoteRef.current = null;
          setSelectedNoteId(null);
          setCurrentNote(null);
          setNoteConflict(null);
        }
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete note");
      }
    },
    [persistCurrentDraftRecovery, refreshNotes]
  );

  const duplicateNote = useCallback(
    async (id: string) => {
      try {
        if (openNoteDraftRef.current().dirty) {
          await workspaceTransitionFlushRef.current();
        }
        const newNote = await notesService.duplicateNote(id);
        selectRequestIdRef.current += 1;
        noteRevisionByIdRef.current.set(newNote.id, newNote.revision);
        await refreshNotes();
        currentNoteRef.current = newNote;
        selectedNoteIdRef.current = newNote.id;
        setCurrentNote(newNote);
        setSelectedNoteId(newNote.id);
        setNoteConflict(null);
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
            pinnedNoteIds: [...pinnedIds, id],
          };
          await notesService.updateWorkspaceSettings(updatedSettings);
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
          pinnedNoteIds: pinnedIds.filter((pinId) => pinId !== id),
        };
        await notesService.updateWorkspaceSettings(updatedSettings);
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to unpin note");
      }
    },
    [refreshNotes]
  );

  const createNoteInFolder = useCallback(
    async (folderPath: string) => {
      try {
        if (openNoteDraftRef.current().dirty) {
          await workspaceTransitionFlushRef.current();
        }
        const note = await notesService.createNote(folderPath);
        selectRequestIdRef.current += 1;
        pendingNewNoteIdRef.current = note.id;
        noteRevisionByIdRef.current.set(note.id, note.revision);
        await refreshNotes();
        currentNoteRef.current = note;
        selectedNoteIdRef.current = note.id;
        setCurrentNote(note);
        setSelectedNoteId(note.id);
        setNoteConflict(null);
        setSearchQuery("");
        setSearchResults([]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create note"
        );
      }
    },
    [refreshNotes]
  );

  const createFolderAction = useCallback(
    async (parentPath: string, name: string) => {
      try {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        await notesService.createFolder(fullPath);
        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create folder"
        );
      }
    },
    [refreshNotes]
  );

  const deleteFolderAction = useCallback(
    async (path: string) => {
      try {
        const draft = openNoteDraftRef.current();
        await preserveDraftBeforeDeletion(
          draft,
          Boolean(draft.noteId?.startsWith(`${path}/`)),
          () => persistCurrentDraftRecovery("delete-folder"),
        );
        await notesService.deleteFolder(path);
        let shouldClearSelection = false;
        if (selectedNoteIdRef.current && selectedNoteIdRef.current.startsWith(path + "/")) {
          shouldClearSelection = true;
        }
        if (shouldClearSelection) {
          setCurrentNote(null);
          setSelectedNoteId(null);
        }
        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete folder"
        );
      }
    },
    [persistCurrentDraftRecovery, refreshNotes]
  );

  const renameFolderAction = useCallback(
    async (oldPath: string, newName: string) => {
      try {
        const draft = openNoteDraftRef.current();
        await flushDraftBeforeRelocation(
          draft,
          Boolean(draft.noteId?.startsWith(`${oldPath}/`)),
          () => workspaceTransitionFlushRef.current(),
        );
        await notesService.renameFolder(oldPath, newName);

        // Compute new folder path
        const lastSlash = oldPath.lastIndexOf("/");
        const newPath =
          lastSlash >= 0
            ? `${oldPath.substring(0, lastSlash)}/${newName}`
            : newName;
        const oldPrefix = oldPath + "/";
        const newPrefix = newPath + "/";

        // Update selectedNoteId if it was inside the renamed folder
        const selectedId = selectedNoteIdRef.current;
        if (selectedId && selectedId.startsWith(oldPrefix)) {
          const newId = newPrefix + selectedId.substring(oldPrefix.length);
          setSelectedNoteId(newId);
          notesService.readNote(newId).then((note) => {
            setCurrentNote(note);
          }).catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to read renamed note");
          });
        }

        await refreshNotes();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to rename folder"
        );
      }
    },
    [refreshNotes]
  );

  const moveNoteAction = useCallback(
    async (id: string, targetFolder: string) => {
      try {
        const draft = openNoteDraftRef.current();
        await flushDraftBeforeRelocation(
          draft,
          draft.noteId === id,
          () => workspaceTransitionFlushRef.current(),
        );
        const newId = await notesService.moveNote(id, targetFolder);
        // Update selection if we moved the selected note
        if (selectedNoteIdRef.current === id) {
          setSelectedNoteId(newId);
          notesService.readNote(newId).then((note) => {
            setCurrentNote(note);
          }).catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to read moved note");
          });
        }
        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move note");
      }
    },
    [refreshNotes]
  );

  const moveFolderAction = useCallback(
    async (path: string, targetParent: string) => {
      try {
        const draft = openNoteDraftRef.current();
        await flushDraftBeforeRelocation(
          draft,
          Boolean(draft.noteId?.startsWith(`${path}/`)),
          () => workspaceTransitionFlushRef.current(),
        );
        await notesService.moveFolder(path, targetParent);

        // Compute new folder path
        const folderName = path.includes("/")
          ? path.substring(path.lastIndexOf("/") + 1)
          : path;
        const newPath = targetParent
          ? `${targetParent}/${folderName}`
          : folderName;
        const oldPrefix = path + "/";
        const newPrefix = newPath + "/";

        // Update selectedNoteId if it was inside the moved folder
        const selectedId = selectedNoteIdRef.current;
        if (selectedId && selectedId.startsWith(oldPrefix)) {
          const newId = newPrefix + selectedId.substring(oldPrefix.length);
          setSelectedNoteId(newId);
          notesService.readNote(newId).then((note) => {
            setCurrentNote(note);
          }).catch((err) => {
            setError(err instanceof Error ? err.message : "Failed to read moved note");
          });
        }

        await refreshNotes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move folder");
      }
    },
    [refreshNotes]
  );

  const restoreWorkspaceSession = useCallback(
    async (workspace: string, notesList: readonly NoteMetadata[]) => {
      setIsWindowSessionRestored(false);
      const restored = await restoreWindowSession({
        isPreview: false,
        workspace,
        noteIds: notesList.map((note) => note.id),
        load: getWindowSession,
      });
      const diskNote = await readRestoredNote(
        restored.selectedNoteId,
        notesService.readNote,
      );
      let restoredNote = diskNote;
      let recoveredRemote: Note | null = null;
      if (diskNote) {
        const checkpoint = await getDraftCheckpoint(diskNote.id).catch(
          () => null,
        );
        if (checkpoint) {
          const reconciled = reconcileDraftCheckpoint(diskNote, checkpoint);
          restoredNote = reconciled.note;
          recoveredRemote = reconciled.remote;
          if (reconciled.shouldClear) {
            await clearDraftCheckpoint(checkpoint.key).catch(() => undefined);
          }
        }
      } else {
        const orphaned = await listDraftCheckpoints().catch(() => []);
        if (orphaned.length > 0) {
          setError(
            `${orphaned.length} recovered draft${orphaned.length === 1 ? " is" : "s are"} available from a previous interrupted session`,
          );
        }
      }

      const appliedSession = restoredNote
        ? restored
        : { ...restored, selectedNoteId: null, focusMode: false };

      selectRequestIdRef.current += 1;
      selectedNoteIdRef.current = restoredNote?.id ?? null;
      currentNoteRef.current = restoredNote;
      setSelectedNoteId(restoredNote?.id ?? null);
      setCurrentNote(restoredNote);
      setNoteConflict(
        recoveredRemote ? { kind: "modified", remote: recoveredRemote } : null,
      );
      setHasExternalChanges(Boolean(recoveredRemote));
      if (restoredNote) {
        noteRevisionByIdRef.current.set(
          restoredNote.id,
          restoredNote.revision,
        );
      }
      setRestoredWindowSession(appliedSession);
      setIsWindowSessionRestored(true);
    },
    [],
  );

  const loadWorkspaceState = useCallback(async (path: string) => {
    setIsWindowSessionRestored(false);
    selectRequestIdRef.current += 1;
    searchRequestIdRef.current += 1;
    pendingNewNoteIdRef.current = null;
    noteRevisionByIdRef.current.clear();
    currentNoteRef.current = null;
    selectedNoteIdRef.current = null;
    setNotesFolderState(path);
    setSelectedNoteId(null);
    setCurrentNote(null);
    setNotes([]);
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
    setHasExternalChanges(false);
    setNoteConflict(null);

    const notesList = await notesService.listNotes();
    setNotes(notesList);
    await restoreWorkspaceSession(path, notesList);
    await notesService.startFileWatcher();
  }, [restoreWorkspaceSession]);

  const queueWorkspaceTransition = useCallback(
    (
      path: string,
      switchBackendWorkspace: (path: string) => Promise<string>,
    ) => {
      const transition = workspaceTransitionQueueRef.current.then(async () => {
        await runWorkspaceSwitch(path, {
          flushCurrentDraft: () => workspaceTransitionFlushRef.current(),
          switchBackendWorkspace,
          loadWorkspace: loadWorkspaceState,
        });
      });
      workspaceTransitionQueueRef.current = transition.catch(() => undefined);
      return transition;
    },
    [loadWorkspaceState],
  );

  const setNotesFolder = useCallback(
    async (path: string) => {
      try {
        await queueWorkspaceTransition(path, async (requestedPath) => {
          await notesService.setNotesFolder(requestedPath);
          return (await notesService.getNotesFolder()) ?? requestedPath;
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to set notes folder",
        );
        throw err;
      }
    },
    [queueWorkspaceTransition],
  );

  const switchWorkspace = useCallback(
    async (path: string) => {
      try {
        await queueWorkspaceTransition(path, notesService.switchWorkspace);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to switch workspace",
        );
        throw err;
      }
    },
    [queueWorkspaceTransition],
  );

  // Update local state only (backend already initialized the folder).
  // Used when the CLI sets the notes folder and emits an event.
  const syncNotesFolder = useCallback(async (path: string) => {
    try {
      await workspaceTransitionFlushRef.current();
      await loadWorkspaceState(path);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sync notes folder"
      );
      throw err;
    }
  }, [loadWorkspaceState]);

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

    // Show instant local matches immediately; clear stale results if none match.
    setSearchResults(instantResults);

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
      console.error("Search failed:", err);
    }
    if (requestId !== searchRequestIdRef.current) return;
    setIsSearching(false);
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
          await restoreWorkspaceSession(folder, notesList);
          // Start file watcher
          await notesService.startFileWatcher();
        } else {
          setRestoredWindowSession(DEFAULT_RESTORED_WINDOW_SESSION);
          setIsWindowSessionRestored(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [restoreWorkspaceSession]);

  // Reconcile watcher events by workspace + revision. A clean editor reloads
  // immediately; a dirty editor keeps its exact draft and enters conflict.
  useEffect(() => {
    let isCancelled = false;
    let unlisten: (() => void) | undefined;

    listen<{
      workspace?: string;
      kind: string;
      changed_ids: string[];
      previous_id?: string | null;
      current_id?: string | null;
    }>("file-change", (event) => {
      if (isCancelled) return;
      if (
        event.payload.workspace &&
        event.payload.workspace !== notesFolderRef.current
      ) {
        return;
      }

      const changedIds = event.payload.changed_ids || [];
      if (changedIds.length === 0) return;
      void refreshNotes();

      const current = currentNoteRef.current;
      if (!current) return;
      const remoteId = resolveRemoteNoteId(current.id, {
        ...event.payload,
        changed_ids: changedIds,
      });
      if (remoteId === undefined) return;
      const observedId = current.id;

      void (async () => {
        let remote: Note | null = null;
        if (remoteId !== null) {
          try {
            remote = await notesService.readNote(remoteId);
          } catch {
            remote = null;
          }
        }
        if (
          isCancelled ||
          selectedNoteIdRef.current !== observedId ||
          currentNoteRef.current?.id !== observedId
        ) {
          return;
        }

        const draft = openNoteDraftRef.current();
        const syncState = {
          note: currentNoteRef.current,
          draft:
            draft.noteId === observedId ? draft.content : current.content,
          dirty: draft.noteId === observedId && draft.dirty,
          conflict: noteConflictRef.current,
        };
        const next = reconcileRemoteNote(syncState, remote);
        if (next === syncState) return;

        if (next.conflict) {
          setNoteConflict(next.conflict);
          setHasExternalChanges(true);
          return;
        }

        noteRevisionByIdRef.current.delete(observedId);
        if (!next.note) {
          selectedNoteIdRef.current = null;
          currentNoteRef.current = null;
          setSelectedNoteId(null);
          setCurrentNote(null);
          setNoteConflict(null);
          setHasExternalChanges(false);
          return;
        }

        currentNoteRef.current = next.note;
        noteRevisionByIdRef.current.set(next.note.id, next.note.revision);
        if (next.note.id !== observedId) {
          selectedNoteIdRef.current = next.note.id;
          setSelectedNoteId(next.note.id);
        }
        setCurrentNote(next.note);
        setNoteConflict(null);
        setHasExternalChanges(false);
        setReloadVersion((version) => version + 1);
      })();
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

  // Listen for "select-note" events from the backend (CLI, drag-drop, Open With, import from preview)
  useEffect(() => {
    const unlisten = listen<string>("select-note", (event) => {
      // Refresh the notes list so the sidebar shows the new note immediately
      refreshNotes();
      selectNote(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectNote, refreshNotes]);

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
      noteConflict,
      reloadVersion,
      restoredWindowSession,
      isWindowSessionRestored,
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
      noteConflict,
      reloadVersion,
      restoredWindowSession,
      isWindowSessionRestored,
    ]
  );

  // Memoize actions context value - these are stable callbacks
  const actionsValue = useMemo<NotesActionsContextValue>(
    () => ({
      selectNote,
      createNote,
      consumePendingNewNote,
      saveNote,
      deleteNote,
      duplicateNote,
      refreshNotes,
      reloadCurrentNote,
      setNotesFolder,
      switchWorkspace,
      syncNotesFolder,
      registerWorkspaceTransitionFlush,
      registerOpenNoteDraft,
      flushCurrentDraft,
      persistCurrentDraftRecovery,
      resolveNoteConflict,
      search,
      clearSearch,
      pinNote,
      unpinNote,
      createNoteInFolder,
      createFolder: createFolderAction,
      deleteFolder: deleteFolderAction,
      renameFolder: renameFolderAction,
      moveNote: moveNoteAction,
      moveFolder: moveFolderAction,
    }),
    [
      selectNote,
      createNote,
      consumePendingNewNote,
      saveNote,
      deleteNote,
      duplicateNote,
      refreshNotes,
      reloadCurrentNote,
      setNotesFolder,
      switchWorkspace,
      syncNotesFolder,
      registerWorkspaceTransitionFlush,
      registerOpenNoteDraft,
      flushCurrentDraft,
      persistCurrentDraftRecovery,
      resolveNoteConflict,
      search,
      clearSearch,
      pinNote,
      unpinNote,
      createNoteInFolder,
      createFolderAction,
      deleteFolderAction,
      renameFolderAction,
      moveNoteAction,
      moveFolderAction,
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

// Optional hook that returns null when outside a NotesProvider (for preview mode)
export function useOptionalNotes() {
  const data = useContext(NotesDataContext);
  const actions = useContext(NotesActionsContext);
  if (!data || !actions) return null;
  return { ...data, ...actions };
}
