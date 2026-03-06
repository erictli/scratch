import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { Editor as TiptapEditor } from "@tiptap/react";

interface SourceModeNote {
  id: string;
}

interface UseSourceModeParams {
  editor: TiptapEditor | null;
  currentNote: SourceModeNote | null;
  saveNote: (content: string, noteId?: string) => Promise<void>;
  getMarkdown: (editor: TiptapEditor | null) => string;
  toggleSourceModeSignal: number;
  setIsSaving: (saving: boolean) => void;
  lastSaveRef: MutableRefObject<{ noteId: string; content: string } | null>;
}

export function useSourceMode({
  editor,
  currentNote,
  saveNote,
  getMarkdown,
  toggleSourceModeSignal,
  setIsSaving,
  lastSaveRef,
}: UseSourceModeParams) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  const sourceTimeoutRef = useRef<number | null>(null);
  const lastHandledToggleSignalRef = useRef(0);

  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    if (!sourceMode) {
      setSourceContent(getMarkdown(editor));
      setSourceMode(true);
      return;
    }

    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        const parsed = manager.parse(sourceContent);
        editor.commands.setContent(parsed);
      } catch {
        editor.commands.setContent(sourceContent);
      }
    } else {
      editor.commands.setContent(sourceContent);
    }
    setSourceMode(false);
  }, [editor, sourceMode, sourceContent, getMarkdown]);

  useEffect(() => {
    if (
      toggleSourceModeSignal === 0 ||
      toggleSourceModeSignal === lastHandledToggleSignalRef.current
    ) {
      return;
    }
    lastHandledToggleSignalRef.current = toggleSourceModeSignal;
    toggleSourceMode();
  }, [toggleSourceModeSignal, toggleSourceMode]);

  useEffect(() => {
    return () => {
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
      }
    };
  }, []);

  const handleSourceChange = useCallback(
    (value: string) => {
      setSourceContent(value);
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
      }
      sourceTimeoutRef.current = window.setTimeout(async () => {
        if (!currentNote) return;
        setIsSaving(true);
        try {
          lastSaveRef.current = { noteId: currentNote.id, content: value };
          await saveNote(value, currentNote.id);
        } catch (error) {
          console.error("Failed to save note:", error);
          toast.error("Failed to save note");
        } finally {
          setIsSaving(false);
        }
      }, 300);
    },
    [currentNote, lastSaveRef, saveNote, setIsSaving],
  );

  const resetSourceMode = useCallback(() => {
    setSourceMode(false);
    if (sourceTimeoutRef.current) {
      clearTimeout(sourceTimeoutRef.current);
      sourceTimeoutRef.current = null;
    }
  }, []);

  return {
    sourceMode,
    sourceContent,
    toggleSourceMode,
    handleSourceChange,
    resetSourceMode,
  };
}
