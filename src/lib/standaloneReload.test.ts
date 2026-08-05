import { describe, expect, it, vi } from "vitest";
import type { DraftCheckpoint } from "./draftCheckpoint";
import {
  createLatestRequestGuard,
  flushDirtyDraftBeforeReload,
  standaloneRecoveryBaseRevision,
} from "./standaloneReload";

describe("createLatestRequestGuard", () => {
  it("lets only the newest asynchronous file load update state", () => {
    const guard = createLatestRequestGuard();
    const firstIsCurrent = guard.begin();
    const secondIsCurrent = guard.begin();

    expect(firstIsCurrent()).toBe(false);
    expect(secondIsCurrent()).toBe(true);

    guard.invalidate();
    expect(secondIsCurrent()).toBe(false);
  });
});

function checkpoint(markdown: string, baseRevision: string | null): DraftCheckpoint {
  return {
    key: { windowLabel: "preview-note", noteId: "/note.md" },
    markdown,
    metadata: {
      sourcePath: "/note.md",
      baseRevision,
      updatedAt: "2026-08-04T12:00:00.000Z",
    },
  };
}

describe("flushDirtyDraftBeforeReload", () => {
  it("flushes a dirty standalone draft before disk content may replace it", async () => {
    const flush = vi.fn(async () => undefined);

    await flushDirtyDraftBeforeReload({
      flush,
      getDraft: () => ({ noteId: "/note.md", content: "local", dirty: true }),
    });

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not manufacture a write for a clean standalone note", async () => {
    const flush = vi.fn(async () => undefined);

    await flushDirtyDraftBeforeReload({
      flush,
      getDraft: () => ({ noteId: "/note.md", content: "disk", dirty: false }),
    });

    expect(flush).not.toHaveBeenCalled();
  });

  it("propagates a revision conflict so caller cannot reload over local text", async () => {
    await expect(
      flushDirtyDraftBeforeReload({
        flush: async () => {
          throw new Error("revision conflict");
        },
        getDraft: () => ({ noteId: "/note.md", content: "local", dirty: true }),
      }),
    ).rejects.toThrow("revision conflict");
  });
});

describe("standaloneRecoveryBaseRevision", () => {
  it("keeps the checkpoint base when recovered content differs from disk", () => {
    expect(
      standaloneRecoveryBaseRevision(
        "current-disk-revision",
        "external content",
        checkpoint("local recovered content", "draft-base-revision"),
      ),
    ).toBe("draft-base-revision");
  });

  it("blocks direct saves when a recovered checkpoint has no base revision", () => {
    expect(
      standaloneRecoveryBaseRevision(
        "current-disk-revision",
        "external content",
        checkpoint("local recovered content", null),
      ),
    ).toBe("");
  });

  it("uses the disk revision when no divergent recovery is applied", () => {
    expect(
      standaloneRecoveryBaseRevision(
        "current-disk-revision",
        "same content",
        checkpoint("same content", "older-revision"),
      ),
    ).toBe("current-disk-revision");
  });
});
