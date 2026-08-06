import { useState, useCallback, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import {
  Editor,
  type EditorPersistenceController,
  type PreviewModeData,
} from "../editor/Editor";
import * as filesService from "../../services/files";
import * as notesService from "../../services/notes";
import * as draftCheckpointService from "../../services/draftCheckpoint";
import { createSerializedTaskQueue } from "../../lib/serializedWriter";
import { runSafeWindowClose } from "../../lib/windowClose";
import {
  flushDirtyDraftBeforeReload,
  loadStandalonePreviewState,
} from "../../lib/standaloneReload";
import {
  StandaloneRecreationConflictError,
  recreateDeletedStandaloneDraft,
} from "../../lib/standaloneRecreation";
import {
  runConflictResolution,
  type ConflictResolutionStrategy,
} from "../../lib/conflictResolution";
import {
  closeWindowAfterSave,
  openPreferencesWindow,
  requestWindowClose,
} from "../../services/windowLifecycle";
import { useWindowShortcuts } from "../../lib/useWindowShortcuts";

interface PreviewAppProps {
  filePath: string;
}
export function PreviewApp({ filePath }: PreviewAppProps) {
  useWindowShortcuts({ onOpenPreferences: openPreferencesWindow });
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [modified, setModified] = useState(0);
  const [revision, setRevision] = useState("");
  const recreationConflictRef = useRef<
    { content: string; revision: string } | null
  >(null);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [hasSaveConflict, setHasSaveConflict] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const revisionRef = useRef("");
  const saveQueueRef = useRef(createSerializedTaskQueue());
  const persistenceControllerRef = useRef<EditorPersistenceController | null>(
    null,
  );
  const closeInProgressRef = useRef(false);

  const registerPersistenceController = useCallback(
    (controller: EditorPersistenceController) => {
      persistenceControllerRef.current = controller;
      return () => {
        if (persistenceControllerRef.current === controller) {
          persistenceControllerRef.current = null;
        }
      };
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    appWindow.onCloseRequested((event) => {
      if (closeInProgressRef.current) return;
      event.preventDefault();
      closeInProgressRef.current = true;

      void runSafeWindowClose({
        flushDraft: () =>
          persistenceControllerRef.current?.flush() ?? Promise.resolve(),
        persistRecovery: async () => {
          const draft = persistenceControllerRef.current?.getDraft();
          if (!draft?.dirty) return undefined;
          return notesService.persistRecoverySnapshot({
            noteId: filePath,
            sourcePath: filePath,
            content: draft.content,
            reason: "standalone-window-close",
          });
        },
        closeWindow: closeWindowAfterSave,
      })
        .then((result) => {
          if (result.recoveredTo && !disposed) {
            toast.warning(`Draft recovered to ${result.recoveredTo}`);
          }
        })
        .catch((error) => {
          closeInProgressRef.current = false;
          console.error("Failed to close standalone window safely:", error);
          if (!disposed) {
            toast.error(
              `Window kept open because the draft could not be saved: ${error}`,
            );
          }
        });
    })
      .then((removeListener) => {
        if (disposed) removeListener();
        else unlisten = removeListener;
      })
      .catch((error) => {
        console.error("Failed to register close handler:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [filePath]);

  // Load file on mount
  useEffect(() => {
    let cancelled = false;

    const loadFile = async () => {
      try {
        const loaded = await loadStandalonePreviewState(
          filePath,
          filesService.readFileDirect,
          draftCheckpointService.getDraftCheckpoint,
          () => cancelled,
        );
        if (!loaded) return;
        const { file: result, checkpoint } = loaded;
        const recovered =
          checkpoint && checkpoint.markdown !== result.content
            ? checkpoint.markdown
            : result.content;
        setContent(recovered);
        setTitle(result.title);
        setModified(result.modified);
        revisionRef.current = result.revision;
        setRevision(result.revision);
        if (checkpoint && checkpoint.markdown === result.content) {
          await draftCheckpointService
            .clearDraftCheckpoint(checkpoint.key.noteId)
            .catch(() => undefined);
        } else if (checkpoint) {
          setHasExternalChanges(true);
          setHasSaveConflict(true);
          toast.warning("Recovered an unsaved draft from an interrupted session");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load file:", error);
        toast.error(`Failed to load file: ${error}`);
      }
    };

    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Listen for window focus to detect external changes
  useEffect(() => {
    const handleFocus = async () => {
      try {
        const result = await filesService.readFileDirect(filePath);
        if (result.revision !== revisionRef.current && content !== null) {
          setHasExternalChanges(true);
          if (persistenceControllerRef.current?.getDraft().dirty) {
            setHasSaveConflict(true);
          }
        }
      } catch {
        // File may have been deleted
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath, modified, content]);

  const save = useCallback(
    (newContent: string) =>
      saveQueueRef.current(async () => {
        try {
          if (!revisionRef.current) {
            throw new Error("Missing base revision for standalone note");
          }
          const result = await filesService.saveFileDirect(
            filePath,
            newContent,
            revisionRef.current,
          );
          if (result.status === "conflict") {
            setHasExternalChanges(true);
            setHasSaveConflict(true);
            throw new Error("Save conflict: local draft was preserved");
          }
          revisionRef.current = result.file.revision;
          setRevision(result.file.revision);
          setModified(result.file.modified);
          setTitle(result.file.title);
          setHasExternalChanges(false);
          setHasSaveConflict(false);
        } catch (error) {
          console.error("Failed to save file:", error);
          toast.error(`Failed to save: ${error}`);
          throw error;
        }
      }),
    [filePath],
  );

  const reload = useCallback(async () => {
    try {
      await flushDirtyDraftBeforeReload(persistenceControllerRef.current);
      const result = await filesService.readFileDirect(filePath);
      setContent(result.content);
      setTitle(result.title);
      setModified(result.modified);
      revisionRef.current = result.revision;
      setRevision(result.revision);
      setHasExternalChanges(false);
      setHasSaveConflict(false);
      setReloadVersion((v) => v + 1);
    } catch (error) {
      console.error("Failed to reload file:", error);
      toast.error(`Failed to reload: ${error}`);
    }
  }, [filePath]);

  const resolveConflict = useCallback(
    async (strategy: ConflictResolutionStrategy) => {
      const draft = persistenceControllerRef.current?.getDraft();
      if (!draft) throw new Error("No open draft to resolve");

      let remote: filesService.FileContent | null = null;
      try {
        remote = await filesService.readFileDirect(filePath);
      } catch {
        const concurrent = recreationConflictRef.current;
        remote = concurrent
          ? {
              path: filePath,
              content: concurrent.content,
              title,
              modified,
              revision: concurrent.revision,
            }
          : null;
      }

      const applyFile = (file: filesService.FileContent) => {
        setContent(file.content);
        setTitle(file.title);
        setModified(file.modified);
        revisionRef.current = file.revision;
        setRevision(file.revision);
        setHasExternalChanges(false);
        setHasSaveConflict(false);
        recreationConflictRef.current = null;
        setReloadVersion((version) => version + 1);
      };

      await runConflictResolution(
        strategy,
        { draft, remote },
        {
          persistRecovery: () =>
            notesService.persistRecoverySnapshot({
              noteId: filePath,
              sourcePath: filePath,
              content: draft.content,
              reason: `standalone-conflict-${strategy}`,
            }),
          overwriteRemote: async (localDraft, current) => {
            const result = await filesService.saveFileDirect(
              filePath,
              localDraft.content,
              current.revision,
            );
            if (result.status === "conflict") {
              throw new Error("The disk version changed again; conflict preserved");
            }
            applyFile(result.file);
          },
          recreateDeleted: async (localDraft) => {
            try {
              const recreated = await recreateDeletedStandaloneDraft(
                filePath,
                localDraft.content,
                filesService.recreateFileDirect,
              );
              applyFile(recreated);
            } catch (error) {
              if (error instanceof StandaloneRecreationConflictError) {
                recreationConflictRef.current = error.current;
                setHasExternalChanges(true);
                setHasSaveConflict(true);
              }
              throw error;
            }
          },
          acceptRemote: async (current) => {
            if (!current) {
              throw new Error(
                "Source file was deleted; local changes are safe in recovery storage",
              );
            }
            applyFile(current);
          },
        },
      );
      await draftCheckpointService.clearDraftCheckpoint(filePath);
    },
    [filePath, modified, title],
  );

  // Listen for preview-file-change events
  useEffect(() => {
    const unlisten = listen<string>("preview-file-change", () => {
      setHasExternalChanges(true);
      if (persistenceControllerRef.current?.getDraft().dirty) {
        setHasSaveConflict(true);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Keyboard shortcuts for preview mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;

      // Cmd+Shift+Enter: Toggle focus mode
      if (modKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        setFocusMode((prev) => !prev);
        return;
      }

      // Cmd+Shift+M: Toggle markdown source mode
      if (modKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-source-mode"));
        return;
      }

      // Cmd+Shift+P: Print
      if (modKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("print-note"));
        return;
      }

      // Cmd+P: Block browser print dialog
      if (modKey && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        return;
      }

      // Cmd+R: Reload file from disk
      if (modKey && e.key === "r") {
        e.preventDefault();
        reload();
        return;
      }

      // Escape: Exit focus mode
      if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
        return;
      }

      // Trap Tab to prevent focus leaving editor (only when editor is focused)
      if (e.key === "Tab") {
        const active = document.activeElement;
        const editorEl = document.querySelector(".ProseMirror");
        if (editorEl && editorEl.contains(active)) {
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusMode, reload]);

  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const handleSaveToFolder = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await filesService.importFileToFolder(filePath);
      // Backend emits select-note + focuses main window; close this preview
      await requestWindowClose();
    } catch (error) {
      console.error("Failed to save to folder:", error);
      toast.error(`Failed to save to folder: ${error}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [filePath]);

  const previewData: PreviewModeData = {
    content,
    title,
    filePath,
    modified,
    revision,
    hasExternalChanges,
    hasSaveConflict,
    reloadVersion,
    save,
    reload,
    resolveConflict,
    registerPersistenceController,
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg text-text">
      <Editor
        focusMode={focusMode}
        previewMode={previewData}
        onSaveToFolder={handleSaveToFolder}
        saveToFolderDisabled={isSaving}
      />
    </div>
  );
}
