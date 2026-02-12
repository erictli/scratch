export interface NoteMetadata {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  path: string;
  modified: number;
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
}

export type FontFamily = "system-sans" | "serif" | "monospace";

export type ShortcutAction =
  | "openCommandPalette"
  | "createNote"
  | "reloadCurrentNote"
  | "toggleAlwaysOnTop"
  | "openSettings"
  | "toggleSidebar"
  | "navigateNoteUp"
  | "navigateNoteDown"
  | "addOrEditLink"
  | "bold"
  | "italic"
  | "copyAs"
  | "findInNote"
  | "settingsGeneralTab"
  | "settingsAppearanceTab"
  | "settingsShortcutsTab";

export type ShortcutSettings = Partial<Record<ShortcutAction, string>>;

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
  shortcuts?: ShortcutSettings;
}
