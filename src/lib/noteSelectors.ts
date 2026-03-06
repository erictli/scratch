import type { NoteMetadata } from "../types/note";
import type { SearchResult } from "../services/notes";

export type DisplayNoteItem = Pick<
  NoteMetadata,
  "id" | "title" | "preview" | "modified"
>;

export function getDisplayItems(
  notes: NoteMetadata[],
  searchQuery: string,
  searchResults: SearchResult[],
): DisplayNoteItem[] {
  if (!searchQuery.trim()) return notes;
  return searchResults.map((result) => ({
    id: result.id,
    title: result.title,
    preview: result.preview,
    modified: result.modified,
  }));
}

