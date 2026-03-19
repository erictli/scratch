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

// Per-folder settings (stored in .scratch/settings.json)
export interface Settings {
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
  gitEnabled?: boolean;
  foldersEnabled?: boolean;
  pinnedNoteIds?: string[];
  textDirection?: TextDirection;
  editorWidth?: EditorWidth;
  customEditorWidthPx?: number;
  defaultNoteName?: string;
  defaultNoteFolder?: string;
  templateFolder?: string;
  defaultTemplate?: string;
  interfaceZoom?: number;
  ollamaModel?: string;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteMetadata[];
}

// Graph view types (mirrors Rust structs in lib.rs)
export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  linkCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface LinkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
