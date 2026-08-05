import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  clearDraftCheckpoint,
  getDraftCheckpoint,
  listDraftCheckpoints,
  writeDraftCheckpoint,
} from "./draftCheckpoint";

const checkpoint = {
  key: { windowLabel: "main", noteId: "Plan" },
  markdown: "# Plan\n\nUnsaved",
  metadata: {
    sourcePath: "/notes/Plan.md",
    baseRevision: "revision-1",
    updatedAt: "2026-08-01T12:00:00.000Z",
  },
};

describe("draft checkpoint service", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("lets backend derive trusted window identity from the caller", async () => {
    await writeDraftCheckpoint(checkpoint);

    expect(invokeMock).toHaveBeenCalledWith("write_draft_checkpoint", {
      noteId: "Plan",
      markdown: checkpoint.markdown,
      metadata: checkpoint.metadata,
    });
  });

  it("reads and clears only the caller's checkpoint for one note", async () => {
    await getDraftCheckpoint("Plan");
    await clearDraftCheckpoint("Plan");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_draft_checkpoint", {
      noteId: "Plan",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "clear_draft_checkpoint", {
      noteId: "Plan",
    });
  });

  it("lists only checkpoints scoped by backend to the caller window", async () => {
    await listDraftCheckpoints();

    expect(invokeMock).toHaveBeenCalledWith("list_draft_checkpoints");
  });
});
