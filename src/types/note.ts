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

export interface Settings {
  notes_folder: string | null;
  theme: ThemeSettings;
}
