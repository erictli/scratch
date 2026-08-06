import { describe, expect, it, vi } from "vitest";
import {
  flushDraftBeforeRelocation,
  preserveDraftBeforeDeletion,
} from "./documentMutationSafety";

const dirtyDraft = {
  noteId: "Projects/Plan",
  content: "# Plan\n\nUnsaved",
  dirty: true,
};

describe("document mutation safety", () => {
  it("flushes a dirty affected note before moving or renaming it", async () => {
    const flush = vi.fn(async () => undefined);

    await flushDraftBeforeRelocation(dirtyDraft, true, flush);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not delay an unrelated move", async () => {
    const flush = vi.fn(async () => undefined);

    await flushDraftBeforeRelocation(dirtyDraft, false, flush);

    expect(flush).not.toHaveBeenCalled();
  });

  it("requires a durable recovery copy before deleting a dirty affected note", async () => {
    const persist = vi.fn(async () => "/recovery/Plan.md");

    await expect(
      preserveDraftBeforeDeletion(dirtyDraft, true, persist),
    ).resolves.toBe("/recovery/Plan.md");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion if a dirty affected draft cannot be recovered", async () => {
    await expect(
      preserveDraftBeforeDeletion(dirtyDraft, true, async () => undefined),
    ).rejects.toThrow("Recovery snapshot was not created");
  });
});
