import { describe, expect, it } from "vitest";
import { resolveEditorWidthResizeEnabled } from "./editorWidthResize";

describe("resolveEditorWidthResizeEnabled", () => {
  it("keeps mouse width resizing enabled for existing settings", () => {
    expect(resolveEditorWidthResizeEnabled(undefined)).toBe(true);
  });

  it("honors an explicit disabled setting", () => {
    expect(resolveEditorWidthResizeEnabled(false)).toBe(false);
    expect(resolveEditorWidthResizeEnabled(true)).toBe(true);
  });
});
