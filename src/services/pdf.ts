import type { Editor } from "@tiptap/react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

/**
 * Triggers the native print dialog for the editor content.
 * Users can save as PDF or print to a physical printer.
 * Uses the browser's native print functionality which produces high-quality PDFs.
 *
 * @param editor - The TipTap editor instance
 * @param _noteTitle - The note title (currently unused, but kept for API consistency)
 */
export async function downloadPdf(
  editor: Editor,
  _noteTitle: string
): Promise<void> {
  if (!editor) throw new Error("Editor not available");

  // Show toast before print dialog. window.print() is synchronous and blocks
  // the main thread, so we need a short delay for the toast to render first.
  toast("Print preview margins may differ from actual output", {
    id: "print-hint",
    duration: 4000,
  });

  await new Promise((r) => setTimeout(r, 150));

  // @page margin handles page margins. The static print CSS in App.css
  // sets .ProseMirror { padding: 0 !important } to zero out the editor's
  // pt-8/pb-24/px-6 utility padding so it doesn't stack with @page margins.
  window.print();

  // Dismiss toast immediately when dialog closes
  toast.dismiss("print-hint");
}

/**
 * Downloads the markdown content as a .md file.
 *
 * @param markdown - The markdown content to save
 * @param noteTitle - The note title for the default filename
 * @returns Promise<boolean> - Returns true if file was saved successfully, false if user cancelled
 */
export async function downloadMarkdown(
  markdown: string,
  noteTitle: string
): Promise<boolean> {
  const sanitizedTitle = sanitizeFilename(noteTitle);

  // Show native save dialog
  const filePath = await save({
    defaultPath: `${sanitizedTitle}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (!filePath) return false; // User cancelled

  // Convert string to bytes and write file using Tauri command
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(markdown);
  await invoke("write_file", {
    path: filePath,
    contents: Array.from(uint8Array)
  });

  return true;
}

/**
 * Sanitizes a filename by removing invalid characters.
 * Replaces filesystem-unsafe characters with dashes.
 *
 * @param name - The filename to sanitize
 * @returns A filesystem-safe filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "note";
}
