import { invoke } from "@tauri-apps/api/core";

export interface ClaudeResult {
  success: boolean;
  output: string | null;
  error: string | null;
  sessionUrl: string | null;
}

export async function isClaudeAvailable(): Promise<boolean> {
  return invoke("claude_is_available");
}

export async function claudeEditNote(
  noteId: string,
  prompt: string
): Promise<ClaudeResult> {
  return invoke("claude_edit_note", { noteId, prompt });
}
