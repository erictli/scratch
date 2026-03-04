import { useEffect, useRef, useState, useCallback } from "react";
import { EditorContent } from "@tiptap/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { mod, isMac } from "../../lib/platform";
import { useOptionalNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { SearchToolbar } from "./SearchToolbar";
import { type WikilinkStorage } from "./Wikilink";
import { EditorWidthHandles } from "./EditorWidthHandle";
import { Button } from "../ui";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";
import { SpinnerIcon } from "../icons";
import { FormatBar } from "./FormatBar";
import { EditorTopBar } from "./EditorTopBar";
import { useNoteSaving } from "./useNoteSaving";
import { useEditorExtensions } from "./useEditorExtensions";
import { useEditorSearch } from "./useEditorSearch";
import { usePopupManager } from "./usePopupManager";
import { useCopyExport } from "./useCopyExport";
import { useTableContextMenu } from "./useTableContextMenu";

// Validate URL scheme for safe opening
function isAllowedUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Data source for preview mode — bypasses NotesContext
export interface PreviewModeData {
  content: string | null;
  title: string;
  filePath: string;
  modified: number;
  hasExternalChanges: boolean;
  reloadVersion: number;
  save: (content: string) => Promise<void>;
  reload: () => Promise<void>;
}

interface EditorProps {
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  focusMode?: boolean;
  previewMode?: PreviewModeData;
  onEditorReady?: (editor: import("@tiptap/react").Editor | null) => void;
  onSaveToFolder?: () => void;
  saveToFolderDisabled?: boolean;
}

export function Editor({
  onToggleSidebar,
  sidebarVisible,
  focusMode,
  onEditorReady,
  previewMode,
  onSaveToFolder,
  saveToFolderDisabled,
}: EditorProps) {
  // Always call the hook (rules of hooks), but it returns null outside NotesProvider
  const notesCtx = useOptionalNotes();

  const currentNote = previewMode
    ? previewMode.content !== null
      ? {
          id: previewMode.filePath,
          title: previewMode.title,
          content: previewMode.content,
          path: previewMode.filePath,
          modified: previewMode.modified,
        }
      : null
    : (notesCtx?.currentNote ?? null);

  const saveNote = previewMode
    ? async (content: string, _noteId?: string) => {
        await previewMode.save(content);
      }
    : notesCtx!.saveNote;

  const createNote = notesCtx?.createNote;
  const hasExternalChanges = previewMode
    ? previewMode.hasExternalChanges
    : notesCtx!.hasExternalChanges;
  const reloadCurrentNote = previewMode
    ? previewMode.reload
    : notesCtx!.reloadCurrentNote;
  const reloadVersion = previewMode
    ? previewMode.reloadVersion
    : notesCtx!.reloadVersion;
  const pinNote = notesCtx?.pinNote;
  const unpinNote = notesCtx?.unpinNote;
  const notes = notesCtx?.notes;
  const { textDirection } = useTheme();

  const [settings, setSettings] = useState<Settings | null>(null);
  // Force re-render when selection changes to update toolbar active states
  const [, setSelectionKey] = useState(0);
  // Delay transition classes until after initial mount to avoid format bar height animation on note load
  const [hasTransitioned, setHasTransitioned] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Stable refs for wikilink click handler
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const notesCtxRef = useRef(notesCtx);
  notesCtxRef.current = notesCtx;

  useEffect(() => {
    if (!hasTransitioned && currentNote) {
      const id = requestAnimationFrame(() => setHasTransitioned(true));
      return () => cancelAnimationFrame(id);
    }
  }, [hasTransitioned, currentNote]);

  // --- Custom hooks ---

  // 1. Note saving (provides refs and save callbacks)
  const saving = useNoteSaving({
    currentNote,
    saveNote,
    scrollContainerRef,
  });

  // 2. Popup manager (uses editorRef from saving)
  const popups = usePopupManager({
    editorRef: saving.editorRef,
  });

  // 3. Editor extensions (uses refs from saving, handlers from popups)
  const editor = useEditorExtensions({
    isLoadingRef: saving.isLoadingRef,
    editorRef: saving.editorRef,
    scheduleSave: saving.scheduleSave,
    handleEditBlockMath: popups.handleEditBlockMath,
    onSelectionUpdate: () => setSelectionKey((k) => k + 1),
  });

  // 4. Search (uses editor)
  const search = useEditorSearch({
    editor,
    currentNoteId: currentNote?.id,
  });

  // 5. Copy/Export (uses editor)
  const copyExport = useCopyExport({
    editor,
    currentNote,
    getMarkdown: saving.getMarkdown,
  });

  // 6. Table context menu (uses editor)
  const tableContextMenu = useTableContextMenu(editor);

  // --- Remaining effects ---

  // Notify parent when editor is ready
  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // Load settings when note changes
  useEffect(() => {
    if (currentNote?.id && !previewMode) {
      notesService
        .getSettings()
        .then(setSettings)
        .catch((error) => {
          console.error("Failed to load settings:", error);
        });
    }
  }, [currentNote?.id, notes, previewMode]);

  const isPinned =
    settings?.pinnedNoteIds?.includes(currentNote?.id || "") || false;

  const handleSettingsReload = useCallback(async () => {
    const updatedSettings = await notesService.getSettings();
    setSettings(updatedSettings);
  }, []);

  // Sync notes list into editor storage for wikilink autocomplete
  useEffect(() => {
    if (!editor || !notes) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = (editor.storage as any).wikilink as
      | WikilinkStorage
      | undefined;
    if (storage) storage.notes = notes;
  }, [editor, notes]);

  // Handle clicks on wikilinks and external links
  useEffect(() => {
    if (!editor) return;

    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      const wikilinkEl = target.closest("[data-wikilink]");
      if (wikilinkEl) {
        e.preventDefault();
        const noteTitle = wikilinkEl.getAttribute("data-note-title");
        const currentNotes = notesRef.current;
        if (noteTitle && currentNotes) {
          const note = currentNotes.find(
            (n) => n.title.toLowerCase() === noteTitle.toLowerCase(),
          );
          if (note) {
            notesCtxRef.current?.selectNote(note.id);
          } else {
            toast.info(`Note "${noteTitle}" does not exist yet`);
          }
        }
        return;
      }

      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && link.href) {
          if (isAllowedUrlScheme(link.href)) {
            openUrl(link.href).catch((error) =>
              console.error("Failed to open link:", error),
            );
          } else {
            toast.error("Cannot open links with this URL scheme");
          }
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleEditorClick);

    return () => {
      editorElement.removeEventListener("click", handleEditorClick);
    };
  }, [editor]);

  // Load note content when the current note changes
  useEffect(() => {
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === saving.loadedNoteIdRef.current;

    // Detect rename BEFORE flush to prevent stale-ID saves from creating duplicates.
    if (!isSameNote) {
      const lastSave = saving.lastSaveRef.current;
      if (
        lastSave?.noteId === saving.loadedNoteIdRef.current &&
        lastSave?.content === currentNote.content
      ) {
        saving.loadedNoteIdRef.current = currentNote.id;
        saving.loadedModifiedRef.current = currentNote.modified;
        saving.lastSaveRef.current = null;
        if (saving.needsSaveRef.current) {
          saving.flushPendingSave();
        }
        return;
      }
    }

    // Flush any pending save before switching to a different note
    if (!isSameNote && saving.needsSaveRef.current) {
      saving.flushPendingSave();
    }
    // Reset source mode when genuinely switching notes (renames return early above)
    if (!isSameNote) {
      saving.setSourceMode(false);
      if (saving.sourceTimeoutRef.current) {
        clearTimeout(saving.sourceTimeoutRef.current);
        saving.sourceTimeoutRef.current = null;
      }
    }
    // Check if this is a manual reload (user clicked Refresh button or pressed Cmd+R)
    const isManualReload = reloadVersion !== saving.lastReloadVersionRef.current;

    if (isSameNote) {
      if (isManualReload) {
        // Manual reload - update the editor content
        saving.lastReloadVersionRef.current = reloadVersion;
        saving.loadedModifiedRef.current = currentNote.modified;
        saving.isLoadingRef.current = true;
        const manager = editor.storage.markdown?.manager;
        if (manager) {
          try {
            const parsed = manager.parse(currentNote.content);
            editor.commands.setContent(parsed);
          } catch {
            editor.commands.setContent(currentNote.content);
          }
        } else {
          editor.commands.setContent(currentNote.content);
        }
        saving.isLoadingRef.current = false;
        return;
      }
      // Just a save - update refs but don't reload content
      saving.loadedModifiedRef.current = currentNote.modified;
      return;
    }

    const isNewNote = saving.loadedNoteIdRef.current === null;
    const wasEmpty = !isNewNote && currentNote.content?.trim() === "";
    const loadingNoteId = currentNote.id;

    saving.loadedNoteIdRef.current = loadingNoteId;
    saving.loadedModifiedRef.current = currentNote.modified;

    saving.isLoadingRef.current = true;

    // Blur editor before setting content to prevent ghost cursor
    editor.commands.blur();

    // Parse markdown and set content
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        const parsed = manager.parse(currentNote.content);
        editor.commands.setContent(parsed);
      } catch {
        // Fallback to plain text if parsing fails
        editor.commands.setContent(currentNote.content);
      }
    } else {
      editor.commands.setContent(currentNote.content);
    }

    // Scroll to top after content is set (must be after setContent to work reliably)
    scrollContainerRef.current?.scrollTo(0, 0);

    // Capture note ID to check in RAF callback - prevents race condition
    // if user switches notes quickly before RAF fires
    requestAnimationFrame(() => {
      // Bail if a different note started loading
      if (saving.loadedNoteIdRef.current !== loadingNoteId) {
        return;
      }

      // Scroll again in RAF to ensure it takes effect after DOM updates
      scrollContainerRef.current?.scrollTo(0, 0);

      saving.isLoadingRef.current = false;

      // For brand new empty notes, focus and select all so user can start typing
      if ((isNewNote || wasEmpty) && currentNote.content.trim() === "") {
        editor.commands.focus("start");
        editor.commands.selectAll();
      }
      // For existing notes, don't auto-focus - let user click where they want
    });
  }, [currentNote, editor, saving.flushPendingSave, reloadVersion]);

  // --- Empty states ---

  if (!currentNote) {
    if (previewMode) {
      return (
        <div className="flex-1 flex flex-col bg-bg">
          <div
            className="h-10 shrink-0 flex items-end px-4 pb-1"
            data-tauri-drag-region
          ></div>
          <div className="flex-1 flex items-center justify-center">
            <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        </div>
      );
    }

    if (notesCtx?.selectedNoteId) {
      return (
        <div className="flex-1 flex flex-col bg-bg">
          <div
            className="h-10 shrink-0 flex items-end px-4 pb-1"
            data-tauri-drag-region
          ></div>
          <div className="flex-1 flex items-center justify-center">
            <SpinnerIcon className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col bg-bg">
        <div
          className="h-10 shrink-0 flex items-end px-4 pb-1"
          data-tauri-drag-region
        ></div>
        <div className="flex-1 flex items-center justify-center pb-8">
          <div className="text-center text-text-muted select-none">
            <img
              src="/note-dark.png"
              alt="Note"
              className="w-42 h-auto mx-auto mb-1 invert dark:invert-0"
            />
            <h1 className="text-2xl text-text font-serif mb-1 tracking-[-0.01em] ">
              What's on your mind?
            </h1>
            <p className="text-sm">
              Pick up where you left off, or start something new
            </p>
            {createNote && (
              <Button
                onClick={createNote}
                variant="secondary"
                size="md"
                className="mt-4"
              >
                New Note{" "}
                <span className="text-text-muted ml-1">
                  {mod}
                  {isMac ? "" : "+"}N
                </span>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Main editor ---

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      <EditorTopBar
        currentNote={currentNote}
        sidebarVisible={sidebarVisible}
        focusMode={focusMode}
        onToggleSidebar={onToggleSidebar}
        isSaving={saving.isSaving}
        hasExternalChanges={hasExternalChanges}
        onReload={reloadCurrentNote}
        isPinned={isPinned}
        pinNote={pinNote}
        unpinNote={unpinNote}
        onSettingsReload={handleSettingsReload}
        onOpenSearch={search.openEditorSearch}
        sourceMode={saving.sourceMode}
        onToggleSourceMode={saving.toggleSourceMode}
        copyMenuOpen={copyExport.copyMenuOpen}
        onCopyMenuOpenChange={copyExport.setCopyMenuOpen}
        onCopyMarkdown={copyExport.handleCopyMarkdown}
        onCopyPlainText={copyExport.handleCopyPlainText}
        onCopyHtml={copyExport.handleCopyHtml}
        onDownloadPdf={copyExport.handleDownloadPdf}
        onDownloadMarkdown={copyExport.handleDownloadMarkdown}
        onSaveToFolder={onSaveToFolder}
        saveToFolderDisabled={saveToFolderDisabled}
      />

      {/* Format Bar – transition only after initial mount to avoid height animation on note load */}
      <div
        className={`${focusMode || saving.sourceMode ? "opacity-0 max-h-0 overflow-hidden pointer-events-none" : "opacity-100 max-h-20"} ${hasTransitioned ? "transition-all duration-1000 delay-500" : ""}`}
      >
        <FormatBar
          editor={editor}
          onAddLink={popups.handleAddLink}
          onAddBlockMath={popups.handleAddBlockMath}
          onAddImage={popups.handleAddImage}
        />
      </div>

      {/* Editor content area with resize handles overlay */}
      <div className="flex-1 relative overflow-hidden">
        {!focusMode && !saving.sourceMode && (
          <EditorWidthHandles containerRef={scrollContainerRef} />
        )}
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          dir={textDirection}
        >
          {saving.sourceMode ? (
            <div className="h-full">
              <textarea
                value={saving.sourceContent}
                onChange={(e) => saving.handleSourceChange(e.target.value)}
                dir={textDirection}
                className="w-full h-full bg-transparent text-text focus:outline-none resize-none px-6 pt-8 pb-24 mx-auto block"
                style={{
                  maxWidth: "var(--editor-max-width, 48rem)",
                  fontFamily:
                    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
                  fontSize: "0.875em",
                  lineHeight: "var(--editor-line-height)",
                  tabSize: 2,
                }}
                spellCheck={false}
              />
            </div>
          ) : (
            <>
              {search.searchOpen && (
                <div className="sticky top-2 z-10 animate-in fade-in slide-in-from-top-4 duration-200 pointer-events-none pr-2 flex justify-end">
                  <div className="pointer-events-auto">
                    <SearchToolbar
                      inputRef={search.searchInputRef}
                      query={search.searchQuery}
                      onChange={search.handleSearchChange}
                      onNext={search.goToNextMatch}
                      onPrevious={search.goToPreviousMatch}
                      onClose={search.closeSearch}
                      currentMatch={
                        search.searchMatches.length === 0
                          ? 0
                          : search.currentMatchIndex + 1
                      }
                      totalMatches={search.searchMatches.length}
                    />
                  </div>
                </div>
              )}
              <div className="h-full" onContextMenu={tableContextMenu}>
                <EditorContent editor={editor} className="h-full text-text" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
