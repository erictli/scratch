import { describe, expect, it } from "vitest";
import type { NoteMetadata } from "../types/note";
import {
  buildFolderTree,
  getVisibleItemsForFolderSection,
  sortNotesByModified,
} from "./folderTree";

function note(id: string, modified: number): NoteMetadata {
  return {
    id,
    title: id,
    preview: "",
    modified,
  };
}

describe("sortNotesByModified", () => {
  const notes = [note("middle", 20), note("oldest", 10), note("newest", 30)];

  it("sorts newest first without mutating the source list", () => {
    const result = sortNotesByModified(notes, "newest");

    expect(result.map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
    expect(notes.map((item) => item.id)).toEqual([
      "middle",
      "oldest",
      "newest",
    ]);
  });

  it("sorts oldest first with a deterministic filename tie-break", () => {
    const result = sortNotesByModified(
      [note("z-last", 10), note("a-first", 10), note("newest", 30)],
      "oldest",
    );

    expect(result.map((item) => item.id)).toEqual([
      "a-first",
      "z-last",
      "newest",
    ]);
  });
});

describe("buildFolderTree note order", () => {
  it("applies oldest-first ordering inside folders while keeping pinned notes first", () => {
    const tree = buildFolderTree(
      [
        note("docs/newest", 30),
        note("docs/pinned", 20),
        note("docs/oldest", 10),
      ],
      new Set(["docs/pinned"]),
      ["docs"],
      "oldest",
    );

    expect(tree.folders[0]?.notes.map((item) => item.id)).toEqual([
      "docs/pinned",
      "docs/oldest",
      "docs/newest",
    ]);
  });
});

describe("getVisibleItemsForFolderSection", () => {
  it("hides every folder item while keeping root notes keyboard-accessible", () => {
    const pinnedIds = new Set(["pinned"]);
    const tree = buildFolderTree(
      [
        note("pinned", 30),
        note("docs/inside", 20),
        note("recent", 10),
      ],
      pinnedIds,
      ["docs"],
    );

    expect(
      getVisibleItemsForFolderSection(tree, pinnedIds, new Set(), false),
    ).toEqual([
      { type: "note", id: "pinned" },
      { type: "folder", path: "docs" },
      { type: "note", id: "docs/inside" },
      { type: "note", id: "recent" },
    ]);
    expect(
      getVisibleItemsForFolderSection(tree, pinnedIds, new Set(), true),
    ).toEqual([
      { type: "note", id: "pinned" },
      { type: "note", id: "recent" },
    ]);
  });
});
