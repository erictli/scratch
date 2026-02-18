import type { Editor } from "@tiptap/react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

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

  // Trigger native print dialog
  // The user can choose "Save as PDF" in the print dialog
  window.print();
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
