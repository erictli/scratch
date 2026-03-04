import { useEffect, useRef, useCallback, useState, type RefObject } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";

interface UseNoteSavingOptions {
  currentNote: {
    id: string;
    content: string;
    modified: number;
    title: string;
    path?: string;
  } | null;
  saveNote: (content: string, noteId?: string) => Promise<void>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface UseNoteSavingReturn {
  isSaving: boolean;
  setIsSaving: (v: boolean) => void;
  editorRef: RefObject<TiptapEditor | null>;
  isLoadingRef: RefObject<boolean>;
  needsSaveRef: RefObject<boolean>;
  loadedNoteIdRef: RefObject<string | null>;
  loadedModifiedRef: RefObject<number | null>;
  lastSaveRef: RefObject<{ noteId: string; content: string } | null>;
  lastReloadVersionRef: RefObject<number>;
  currentNoteIdRef: RefObject<string | null>;
  saveTimeoutRef: RefObject<number | null>;
  getMarkdown: (editorInstance: TiptapEditor | null) => string;
  scheduleSave: () => void;
  flushPendingSave: () => Promise<void>;
  saveImmediately: (noteId: string, content: string) => Promise<void>;
  // Source mode
  sourceMode: boolean;
  setSourceMode: (v: boolean) => void;
  sourceContent: string;
  setSourceContent: (v: string) => void;
  sourceTimeoutRef: RefObject<number | null>;
  toggleSourceMode: () => void;
  handleSourceChange: (value: string) => void;
}

export function useNoteSaving({
  currentNote,
  saveNote,
  scrollContainerRef,
}: UseNoteSavingOptions): UseNoteSavingReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const sourceTimeoutRef = useRef<number | null>(null);

  const saveTimeoutRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  const needsSaveRef = useRef(false);

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  const loadedModifiedRef = useRef<number | null>(null);
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);
  const lastReloadVersionRef = useRef(0);

  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

  // Get markdown from editor
  const getMarkdown = useCallback(
    (editorInstance: TiptapEditor | null) => {
      if (!editorInstance) return "";
      const manager = editorInstance.storage.markdown?.manager;
      if (manager) {
        let markdown = manager.serialize(editorInstance.getJSON());
        markdown = markdown.replace(/&nbsp;|&#160;/g, " ");
        return markdown;
      }
      return editorInstance.getText();
    },
    [],
  );

  // Immediate save function (used for flushing)
  const saveImmediately = useCallback(
    async (noteId: string, content: string) => {
      setIsSaving(true);
      try {
        lastSaveRef.current = { noteId, content };
        await saveNote(content, noteId);
      } finally {
        setIsSaving(false);
      }
    },
    [saveNote],
  );

  // Flush any pending save immediately (saves to the note currently loaded in editor)
  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (needsSaveRef.current && editorRef.current && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      const markdown = getMarkdown(editorRef.current);
      await saveImmediately(loadedNoteIdRef.current, markdown);
    }
  }, [saveImmediately, getMarkdown]);

  // Schedule a debounced save (markdown computed only when timer fires)
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;

    needsSaveRef.current = true;

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) {
        return;
      }

      if (editorRef.current) {
        needsSaveRef.current = false;
        const markdown = getMarkdown(editorRef.current);
        await saveImmediately(savingNoteId, markdown);
      }
    }, 500);
  }, [saveImmediately, getMarkdown, currentNote?.id]);

  // Scroll to top on mount
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, []);

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (needsSaveRef.current && editorRef.current) {
        needsSaveRef.current = false;
        const manager = editorRef.current.storage.markdown?.manager;
        const markdown = manager
          ? manager.serialize(editorRef.current.getJSON())
          : editorRef.current.getText();
        saveNote(markdown);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle source mode (uses editorRef since editor instance isn't available at hook creation time)
  const toggleSourceMode = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!sourceMode) {
      const md = getMarkdown(ed);
      setSourceContent(md);
      setSourceMode(true);
    } else {
      const manager = ed.storage.markdown?.manager;
      if (manager) {
        try {
          const parsed = manager.parse(sourceContent);
          ed.commands.setContent(parsed);
        } catch {
          ed.commands.setContent(sourceContent);
        }
      } else {
        ed.commands.setContent(sourceContent);
      }
      setSourceMode(false);
    }
  }, [sourceMode, sourceContent, getMarkdown]);

  // Listen for toggle-source-mode custom event (from App.tsx shortcut / command palette)
  useEffect(() => {
    const handler = () => toggleSourceMode();
    window.addEventListener("toggle-source-mode", handler);
    return () => window.removeEventListener("toggle-source-mode", handler);
  }, [toggleSourceMode]);

  // Auto-save in source mode with debounce
  const handleSourceChange = useCallback(
    (value: string) => {
      setSourceContent(value);
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
      }
      sourceTimeoutRef.current = window.setTimeout(async () => {
        if (currentNote) {
          setIsSaving(true);
          try {
            lastSaveRef.current = { noteId: currentNote.id, content: value };
            await saveNote(value, currentNote.id);
          } catch (error) {
            console.error("Failed to save note:", error);
          } finally {
            setIsSaving(false);
          }
        }
      }, 300);
    },
    [currentNote, saveNote],
  );

  return {
    isSaving,
    setIsSaving,
    editorRef,
    isLoadingRef,
    needsSaveRef,
    loadedNoteIdRef,
    loadedModifiedRef,
    lastSaveRef,
    lastReloadVersionRef,
    currentNoteIdRef,
    saveTimeoutRef,
    getMarkdown,
    scheduleSave,
    flushPendingSave,
    saveImmediately,
    sourceMode,
    setSourceMode,
    sourceContent,
    setSourceContent,
    sourceTimeoutRef,
    toggleSourceMode,
    handleSourceChange,
  };
}
