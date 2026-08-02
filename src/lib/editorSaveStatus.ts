export type EditorSaveStatus =
  | "conflict"
  | "external"
  | "saving"
  | "dirty"
  | "saved";

export function getEditorSaveStatus(state: {
  hasSaveConflict: boolean;
  hasExternalChanges: boolean;
  isSaving: boolean;
  isDirty: boolean;
}): EditorSaveStatus {
  if (state.hasSaveConflict) return "conflict";
  if (state.hasExternalChanges) return "external";
  if (state.isSaving) return "saving";
  if (state.isDirty) return "dirty";
  return "saved";
}
