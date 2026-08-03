import { describe, expect, it, vi } from "vitest";
import { flushDirtyDraftBeforeReload } from "./standaloneReload";

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
