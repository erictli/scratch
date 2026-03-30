export interface HistoryCompareEditorLike {
  setEditable: (editable: boolean) => void;
  commands: {
    setContent: (content: Record<string, unknown>) => void;
  };
}

export function applyHistoryCompareBase(
  editor: HistoryCompareEditorLike,
  afterJSON: Record<string, unknown> | null,
): boolean {
  editor.setEditable(false);

  if (!afterJSON) {
    editor.setEditable(true);
    return false;
  }

  editor.commands.setContent(afterJSON);
  return true;
}
