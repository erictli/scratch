export interface NoteMetadata {
  id: string; // Full relative path (e.g., "projects/my-note")
  title: string;
  preview: string;
  modified: number;
  folderPath?: string; // Relative folder path (e.g., "projects") or undefined for root
  fileName: string; // Just the filename without extension (e.g., "my-note")
}

export interface Note {
  id: string; // Full relative path (e.g., "projects/my-note")
  title: string;
  content: string;
  path: string; // Full absolute path
  modified: number;
  folderPath?: string; // Relative folder path (e.g., "projects")
  fileName: string; // Just the filename without extension
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
}

export type FontFamily = "system-sans" | "serif" | "monospace";

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
  lineHeight?: number; // default 1.6
}

// Per-folder settings (stored in .scratch/settings.json)
export interface Settings {
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
  gitEnabled?: boolean;
  pinnedNoteIds?: string[];
}
