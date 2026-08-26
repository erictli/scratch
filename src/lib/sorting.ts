import type { NoteMetadata, FolderNode, SortOrder } from "../types/note";

export interface SortStrategy {
  id: SortOrder;
  label: string;
  description: string;
  compareNotes: (a: NoteMetadata, b: NoteMetadata) => number;
  compareFolders?: (a: FolderNode, b: FolderNode) => number;
}

// Natural collation for human-friendly sorting (e.g. "1 - Note", "2 - Note", "10 - Note")
const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const naturalCompare = (a: string, b: string) =>
  naturalCollator.compare(a, b) || a.localeCompare(b);

export const SORT_STRATEGIES: Record<SortOrder, SortStrategy> = {
  "title-asc": {
    id: "title-asc",
    label: "Alphabetical / Folder Structure (A–Z)",
    description: "Sorted by note title and natural number order",
    compareNotes: (a, b) => naturalCompare(a.title || a.id, b.title || b.id),
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "modified-desc": {
    id: "modified-desc",
    label: "Last Modified (Newest First)",
    description: "Recently edited notes appear at the top",
    compareNotes: (a, b) => b.modified - a.modified,
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "modified-asc": {
    id: "modified-asc",
    label: "Last Modified (Oldest First)",
    description: "Oldest edited notes appear at the top",
    compareNotes: (a, b) => a.modified - b.modified,
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "title-desc": {
    id: "title-desc",
    label: "Alphabetical (Z–A)",
    description: "Reverse alphabetical order",
    compareNotes: (a, b) => naturalCompare(b.title || b.id, a.title || a.id),
    compareFolders: (a, b) => naturalCompare(b.name, a.name),
  },
};

export const DEFAULT_SORT_ORDER: SortOrder = "modified-desc";

export function getSortStrategy(sortOrder?: string | null): SortStrategy {
  if (sortOrder && Object.hasOwn(SORT_STRATEGIES, sortOrder)) {
    return SORT_STRATEGIES[sortOrder as SortOrder];
  }
  return SORT_STRATEGIES[DEFAULT_SORT_ORDER];
}
