import { useEffect, useCallback, useState } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { plainTextFromMarkdown } from "../../lib/plainText";
import { downloadPdf, downloadMarkdown } from "../../services/pdf";

interface UseCopyExportOptions {
  editor: TiptapEditor | null;
  currentNote: { id: string; title: string } | null;
  getMarkdown: (editor: TiptapEditor | null) => string;
}

interface UseCopyExportReturn {
  copyMenuOpen: boolean;
  setCopyMenuOpen: (open: boolean) => void;
  handleCopyMarkdown: () => Promise<void>;
  handleCopyPlainText: () => Promise<void>;
  handleCopyHtml: () => Promise<void>;
  handleDownloadPdf: () => Promise<void>;
  handleDownloadMarkdown: () => Promise<void>;
}

export function useCopyExport({
  editor,
  currentNote,
  getMarkdown,
}: UseCopyExportOptions): UseCopyExportReturn {
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);

  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      await invoke("copy_to_clipboard", { text: markdown });
      toast.success("Copied as Markdown");
    } catch (error) {
      console.error("Failed to copy markdown:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyPlainText = useCallback(async () => {
    if (!editor) return;
    try {
      const markdown = getMarkdown(editor);
      const plainText = plainTextFromMarkdown(markdown);
      await invoke("copy_to_clipboard", { text: plainText });
      toast.success("Copied as plain text");
    } catch (error) {
      console.error("Failed to copy plain text:", error);
      toast.error("Failed to copy");
    }
  }, [editor, getMarkdown]);

  const handleCopyHtml = useCallback(async () => {
    if (!editor) return;
    try {
      const html = editor.getHTML();
      await invoke("copy_to_clipboard", { text: html });
      toast.success("Copied as HTML");
    } catch (error) {
      console.error("Failed to copy HTML:", error);
      toast.error("Failed to copy");
    }
  }, [editor]);

  const handleDownloadPdf = useCallback(async () => {
    if (!editor || !currentNote) return;
    try {
      await downloadPdf(editor, currentNote.title);
    } catch (error) {
      console.error("Failed to open print dialog:", error);
      toast.error("Failed to open print dialog");
    }
  }, [editor, currentNote]);

  const handleDownloadMarkdown = useCallback(async () => {
    if (!editor || !currentNote) return;
    try {
      const markdown = getMarkdown(editor);
      const saved = await downloadMarkdown(markdown, currentNote.title);
      if (saved) {
        toast.success("Markdown saved successfully");
      }
    } catch (error) {
      console.error("Failed to download markdown:", error);
      toast.error("Failed to save markdown");
    }
  }, [editor, currentNote, getMarkdown]);

  // Keyboard shortcut for Cmd+Shift+C to open copy menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        setCopyMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    copyMenuOpen,
    setCopyMenuOpen,
    handleCopyMarkdown,
    handleCopyPlainText,
    handleCopyHtml,
    handleDownloadPdf,
    handleDownloadMarkdown,
  };
}
