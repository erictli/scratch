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

export interface ThemeColors {
  bg?: string;
  bgSecondary?: string;
  bgMuted?: string;
  bgEmphasis?: string;
  text?: string;
  textMuted?: string;
  textInverse?: string;
  border?: string;
  accent?: string;
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
  customLightColors?: ThemeColors;
  customDarkColors?: ThemeColors;
}

export type FontFamily = "system-sans" | "serif" | "monospace";

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
}

export interface Settings {
  notes_folder: string | null;
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
}
