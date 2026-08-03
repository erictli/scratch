import { describe, expect, it } from "vitest";
import {
  reconcileRemoteNote,
  resolveRemoteNoteId,
  type OpenNoteSyncState,
} from "./noteSync";
import type { Note } from "../types/note";

function note(content: string, revision: string): Note {
  return {
    id: "Plan",
    title: "Plan",
    content,
    path: "/notes/Plan.md",
    modified: 1,
    revision,
  };
}

describe("reconcileRemoteNote", () => {
  it("reloads a clean editor immediately when another window saves", () => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nOriginal", "revision-1"),
      draft: "# Plan\n\nOriginal",
      dirty: false,
      conflict: null,
    };

    expect(
      reconcileRemoteNote(state, note("# Plan\n\nWindow B", "revision-2")),
    ).toEqual({
      note: note("# Plan\n\nWindow B", "revision-2"),
      draft: "# Plan\n\nWindow B",
      dirty: false,
      conflict: null,
    });
  });

  it.each([
    ["plain text", "# Plan\n\nWindow B"],
    ["task check", "# Plan\n\n- [x] shipped"],
    ["link edit", "# Plan\n\n[Scratch](https://example.com)"],
  ])("synchronizes %s through the same revision contract", (_kind, content) => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nOriginal", "revision-1"),
      draft: "# Plan\n\nOriginal",
      dirty: false,
      conflict: null,
    };

    expect(reconcileRemoteNote(state, note(content, "revision-2"))).toMatchObject({
      note: { content, revision: "revision-2" },
      draft: content,
      dirty: false,
      conflict: null,
    });
  });

  it("keeps a dirty local draft and records the remote version as a conflict", () => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nOriginal", "revision-1"),
      draft: "# Plan\n\nUnsaved local edit",
      dirty: true,
      conflict: null,
    };
    const remote = note("# Plan\n\nWindow B", "revision-2");

    expect(reconcileRemoteNote(state, remote)).toEqual({
      ...state,
      conflict: { kind: "modified", remote },
    });
  });

  it("ignores duplicate watcher events for the already loaded revision", () => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nCurrent", "revision-2"),
      draft: "# Plan\n\nCurrent",
      dirty: false,
      conflict: null,
    };

    expect(
      reconcileRemoteNote(state, note("# Plan\n\nCurrent", "revision-2")),
    ).toBe(state);
  });

  it("keeps a dirty draft when the source file is deleted", () => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nOriginal", "revision-1"),
      draft: "# Plan\n\nUnsaved local edit",
      dirty: true,
      conflict: null,
    };

    expect(reconcileRemoteNote(state, null)).toEqual({
      ...state,
      conflict: { kind: "deleted", remote: null },
    });
  });

  it("clears a clean editor when its file is deleted in another window", () => {
    const state: OpenNoteSyncState = {
      note: note("# Plan\n\nOriginal", "revision-1"),
      draft: "# Plan\n\nOriginal",
      dirty: false,
      conflict: null,
    };

    expect(reconcileRemoteNote(state, null)).toEqual({
      note: null,
      draft: "",
      dirty: false,
      conflict: null,
    });
  });
});

describe("resolveRemoteNoteId", () => {
  it("follows a semantic rename or move from old id to new id", () => {
    expect(
      resolveRemoteNoteId("Projects/Plan", {
        kind: "moved",
        changed_ids: ["Projects/Plan", "Archive/Plan"],
        previous_id: "Projects/Plan",
        current_id: "Archive/Plan",
      }),
    ).toBe("Archive/Plan");
  });

  it("maps semantic deletion to a missing remote note", () => {
    expect(
      resolveRemoteNoteId("Plan", {
        kind: "deleted",
        changed_ids: ["Plan"],
        previous_id: "Plan",
        current_id: null,
      }),
    ).toBeNull();
  });

  it("ignores unrelated workspace note events", () => {
    expect(
      resolveRemoteNoteId("Plan", {
        kind: "modified",
        changed_ids: ["Other"],
        previous_id: null,
        current_id: "Other",
      }),
    ).toBeUndefined();
  });
});
