import { describe, expect, it } from "vitest";
import { resolveEditorToolbarVisible } from "./editorToolbar";

describe("resolveEditorToolbarVisible", () => {
  it("hides the toolbar when an existing settings file has no preference", () => {
    expect(resolveEditorToolbarVisible(undefined)).toBe(false);
  });

  it("honors an explicit visibility preference", () => {
    expect(resolveEditorToolbarVisible(false)).toBe(false);
    expect(resolveEditorToolbarVisible(true)).toBe(true);
  });
});
