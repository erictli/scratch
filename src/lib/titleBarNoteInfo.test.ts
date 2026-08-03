import { describe, expect, it } from "vitest";
import {
  getFilenameFromPath,
  getTitleBarNoteInfoText,
  resolveTitleBarNoteInfoVisibility,
  updateTitleBarNoteInfoVisibility,
} from "./titleBarNoteInfo";

describe("resolveTitleBarNoteInfoVisibility", () => {
  it("preserves the existing modification-date behavior by default", () => {
    expect(resolveTitleBarNoteInfoVisibility(undefined, undefined)).toEqual({
      modifiedDateVisible: true,
      filenameVisible: false,
    });
  });

  it("allows both title-bar values to be hidden", () => {
    expect(resolveTitleBarNoteInfoVisibility(false, false)).toEqual({
      modifiedDateVisible: false,
      filenameVisible: false,
    });
  });

  it("gives filename priority if an old settings file enables both", () => {
    expect(resolveTitleBarNoteInfoVisibility(true, true)).toEqual({
      modifiedDateVisible: false,
      filenameVisible: true,
    });
  });
});

describe("updateTitleBarNoteInfoVisibility", () => {
  it("replaces the modification date when filename is enabled", () => {
    expect(
      updateTitleBarNoteInfoVisibility(
        { modifiedDateVisible: true, filenameVisible: false },
        "filename",
        true,
      ),
    ).toEqual({ modifiedDateVisible: false, filenameVisible: true });
  });

  it("replaces filename when the modification date is enabled", () => {
    expect(
      updateTitleBarNoteInfoVisibility(
        { modifiedDateVisible: false, filenameVisible: true },
        "modifiedDate",
        true,
      ),
    ).toEqual({ modifiedDateVisible: true, filenameVisible: false });
  });

  it("can leave both values hidden", () => {
    expect(
      updateTitleBarNoteInfoVisibility(
        { modifiedDateVisible: true, filenameVisible: false },
        "modifiedDate",
        false,
      ),
    ).toEqual({ modifiedDateVisible: false, filenameVisible: false });
  });
});

describe("getFilenameFromPath", () => {
  it("returns the Markdown filename without its extension from macOS and Windows paths", () => {
    expect(getFilenameFromPath("/Users/marie/Notes/Project plan.md")).toBe(
      "Project plan",
    );
    expect(getFilenameFromPath("C:\\Users\\marie\\Notes\\Project plan.md")).toBe(
      "Project plan",
    );
  });

  it("only removes a final Markdown extension", () => {
    expect(getFilenameFromPath("/Users/marie/Notes/Project plan.md.backup")).toBe(
      "Project plan.md.backup",
    );
  });
});

describe("getTitleBarNoteInfoText", () => {
  const note = {
    path: "/Users/marie/Notes/Project plan.md",
    modified: 42,
  };
  const formatModifiedDate = (timestamp: number) => `modified:${timestamp}`;

  it("returns the formatted modification date", () => {
    expect(
      getTitleBarNoteInfoText(
        { modifiedDateVisible: true, filenameVisible: false },
        note,
        formatModifiedDate,
      ),
    ).toBe("modified:42");
  });

  it("returns filename instead of the modification date", () => {
    expect(
      getTitleBarNoteInfoText(
        { modifiedDateVisible: false, filenameVisible: true },
        note,
        formatModifiedDate,
      ),
    ).toBe("Project plan");
  });

  it("returns null when both values are hidden", () => {
    expect(
      getTitleBarNoteInfoText(
        { modifiedDateVisible: false, filenameVisible: false },
        note,
        formatModifiedDate,
      ),
    ).toBeNull();
  });
});
