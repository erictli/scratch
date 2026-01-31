import { invoke } from "@tauri-apps/api/core";
import type { Note, NoteMetadata, Settings, AgentEdits } from "../types/note";

export async function getNotesFolder(): Promise<string | null> {
  return invoke("get_notes_folder");
}

export async function setNotesFolder(path: string): Promise<void> {
  return invoke("set_notes_folder", { path });
}

export async function listNotes(): Promise<NoteMetadata[]> {
  return invoke("list_notes");
}

export async function readNote(id: string): Promise<Note> {
  return invoke("read_note", { id });
}

export async function saveNote(id: string | null, content: string): Promise<Note> {
  return invoke("save_note", { id, content });
}

export async function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

export async function createNote(): Promise<Note> {
  return invoke("create_note");
}

export async function duplicateNote(id: string): Promise<Note> {
  // Read the original note, then create a new one with the same content
  const original = await readNote(id);
  const newNote = await createNote();
  // Save with the original content (title will be extracted from content)
  const duplicatedContent = original.content.replace(/^# (.+)$/m, (_, title) => `# ${title} (Copy)`);
  return saveNote(newNote.id, duplicatedContent || original.content);
}

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: Settings): Promise<void> {
  return invoke("update_settings", { newSettings: settings });
}

export interface SearchResult {
  id: string;
  title: string;
  preview: string;
  modified: number;
  score: number;
}

export async function searchNotes(query: string): Promise<SearchResult[]> {
  return invoke("search_notes", { query });
}

export async function startFileWatcher(): Promise<void> {
  return invoke("start_file_watcher");
}

export async function getAgentEdits(): Promise<AgentEdits> {
  return invoke("get_agent_edits");
}
