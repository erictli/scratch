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
export type TextDirection = "auto" | "ltr" | "rtl";
export type EditorWidth = "narrow" | "normal" | "wide" | "full" | "custom";

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
  lineHeight?: number; // default 1.6
}

// Customizable theme color keys (maps to CSS --color-* variables)
export type ThemeColorKey =
  | "bg"
  | "bg-secondary"
  | "bg-muted"
  | "bg-emphasis"
  | "text"
  | "text-muted"
  | "border"
  | "accent"
  | "selection";

// Partial map of color overrides (hex strings)
export type CustomColors = Partial<Record<ThemeColorKey, string>>;

// Global settings – shared across all notes folders ({APP_CONFIG_DIR}/settings.json)
export interface GlobalSettings {
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
  textDirection?: TextDirection;
  editorWidth?: EditorWidth;
  customEditorWidthPx?: number;
  interfaceZoom?: number;
  ollamaModel?: string;
  foldersEnabled?: boolean;
  ignoredPatterns?: string[];
  customColorsLight?: CustomColors;
  customColorsDark?: CustomColors;
}

// Local settings – specific to the active notes folder (.scratch/settings.json)
export interface LocalSettings {
  gitEnabled?: boolean;
  pinnedNoteIds?: string[];
  defaultNoteName?: string;
}

// Combined settings – API contract with the backend (unchanged shape)
export interface Settings extends GlobalSettings, LocalSettings {}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteMetadata[];
}
