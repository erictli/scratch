import { describe, expect, it, vi } from "vitest";
import {
  flushDirtyDraftBeforeReload,
  loadStandalonePreviewState,
} from "./standaloneReload";

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

describe("loadStandalonePreviewState", () => {
  it("drops a stale file load after its effect is cancelled", async () => {
    let cancelled = false;
    let resolveRead: (value: { content: string }) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<{ content: string }>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const getCheckpoint = vi.fn(async () => ({ markdown: "checkpoint A" }));

    const load = loadStandalonePreviewState(
      "/A.md",
      read,
      getCheckpoint,
      () => cancelled,
    );
    cancelled = true;
    resolveRead({ content: "disk A" });

    await expect(load).resolves.toBeNull();
    expect(getCheckpoint).not.toHaveBeenCalled();
  });

  it("returns only the current file and its checkpoint", async () => {
    await expect(
      loadStandalonePreviewState(
        "/B.md",
        async () => ({ content: "disk B" }),
        async () => ({ markdown: "checkpoint B" }),
        () => false,
      ),
    ).resolves.toEqual({
      file: { content: "disk B" },
      checkpoint: { markdown: "checkpoint B" },
    });
  });

  it("drops a load cancelled while its checkpoint is pending", async () => {
    let cancelled = false;
    let resolveCheckpoint: (value: { markdown: string }) => void = () => undefined;
    const checkpointPromise = new Promise<{ markdown: string }>((resolve) => {
      resolveCheckpoint = resolve;
    });

    const load = loadStandalonePreviewState(
      "/A.md",
      async () => ({ content: "disk A" }),
      async () => checkpointPromise,
      () => cancelled,
    );
    await Promise.resolve();
    cancelled = true;
    resolveCheckpoint({ markdown: "checkpoint A" });

    await expect(load).resolves.toBeNull();
  });
});
