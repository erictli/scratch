export interface TitleBarNoteInfoVisibility {
  modifiedDateVisible: boolean;
  filenameVisible: boolean;
}

export type TitleBarNoteInfoKind = "modifiedDate" | "filename";

export const DEFAULT_TITLE_BAR_NOTE_INFO_VISIBILITY: TitleBarNoteInfoVisibility = {
  modifiedDateVisible: true,
  filenameVisible: false,
};

export function resolveTitleBarNoteInfoVisibility(
  modifiedDateVisible: boolean | undefined,
  filenameVisible: boolean | undefined,
): TitleBarNoteInfoVisibility {
  if (filenameVisible === true) {
    return { modifiedDateVisible: false, filenameVisible: true };
  }

  return {
    modifiedDateVisible: modifiedDateVisible !== false,
    filenameVisible: false,
  };
}

export function updateTitleBarNoteInfoVisibility(
  current: TitleBarNoteInfoVisibility,
  kind: TitleBarNoteInfoKind,
  visible: boolean,
): TitleBarNoteInfoVisibility {
  if (kind === "filename") {
    return {
      modifiedDateVisible: visible ? false : current.modifiedDateVisible,
      filenameVisible: visible,
    };
  }

  return {
    modifiedDateVisible: visible,
    filenameVisible: visible ? false : current.filenameVisible,
  };
}

export function getFilenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const filename = parts[parts.length - 1] ?? "";
  return filename.replace(/\.md$/, "");
}

interface TitleBarNote {
  path: string;
  modified: number;
}

export function getTitleBarNoteInfoText(
  visibility: TitleBarNoteInfoVisibility,
  note: TitleBarNote,
  formatModifiedDate: (timestamp: number) => string,
): string | null {
  if (visibility.filenameVisible) {
    return getFilenameFromPath(note.path);
  }

  if (visibility.modifiedDateVisible) {
    return formatModifiedDate(note.modified);
  }

  return null;
}
