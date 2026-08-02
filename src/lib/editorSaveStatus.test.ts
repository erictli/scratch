import { describe, expect, it } from "vitest";
import { getEditorSaveStatus } from "./editorSaveStatus";

describe("getEditorSaveStatus", () => {
  it("never reports a dirty debounced draft as saved", () => {
    expect(
      getEditorSaveStatus({
        hasSaveConflict: false,
        hasExternalChanges: false,
        isSaving: false,
        isDirty: true,
      }),
    ).toBe("dirty");
  });

  it("keeps conflict and external-change states ahead of transient save state", () => {
    expect(
      getEditorSaveStatus({
        hasSaveConflict: true,
        hasExternalChanges: true,
        isSaving: true,
        isDirty: true,
      }),
    ).toBe("conflict");

    expect(
      getEditorSaveStatus({
        hasSaveConflict: false,
        hasExternalChanges: true,
        isSaving: true,
        isDirty: true,
      }),
    ).toBe("external");
  });

  it("reports saved only when no write or unresolved draft remains", () => {
    expect(
      getEditorSaveStatus({
        hasSaveConflict: false,
        hasExternalChanges: false,
        isSaving: false,
        isDirty: false,
      }),
    ).toBe("saved");
  });
});
