import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDraftCheckpointScheduler,
  nextCheckpointCaptureDelay,
  reconcileDraftCheckpoint,
  type DraftCheckpoint,
  type DraftCheckpointKey,
} from "./draftCheckpoint";
import type { Note } from "../types/note";

const key: DraftCheckpointKey = {
  windowLabel: "main-window",
  noteId: "notes/plan",
};

function checkpoint(markdown: string, updatedAt: string): DraftCheckpoint {
  return {
    key,
    markdown,
    metadata: {
      sourcePath: "/workspace/Notes/Plan.md",
      baseRevision: "revision-before-edit",
      updatedAt,
    },
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("nextCheckpointCaptureDelay", () => {
  it("keeps a trailing delay but guarantees a checkpoint during continuous typing", () => {
    expect(nextCheckpointCaptureDelay(0, 250, 750)).toBe(250);
    expect(nextCheckpointCaptureDelay(400, 250, 750)).toBe(250);
    expect(nextCheckpointCaptureDelay(600, 250, 750)).toBe(150);
    expect(nextCheckpointCaptureDelay(750, 250, 750)).toBe(0);
  });
});

describe("createDraftCheckpointScheduler", () => {
  it("writes the exact latest dirty draft at the trailing edge", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const scheduler = createDraftCheckpointScheduler(
      { write, clear: vi.fn(async () => undefined) },
      { delayMs: 1_000 },
    );
    const first = checkpoint("first", "2026-08-01T12:00:00Z");
    const latest = checkpoint(
      "# Exact\n\ntrailing spaces  \n☕\n",
      "2026-08-01T12:00:00.700Z",
    );

    scheduler.markDirty(first);
    await vi.advanceTimersByTimeAsync(700);
    scheduler.markDirty(latest);
    latest.markdown = "mutated by caller after scheduling";
    await vi.advanceTimersByTimeAsync(999);
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({
      key,
      markdown: "# Exact\n\ntrailing spaces  \n☕\n",
      metadata: {
        sourcePath: "/workspace/Notes/Plan.md",
        baseRevision: "revision-before-edit",
        updatedAt: "2026-08-01T12:00:00.700Z",
      },
    });
  });

  it("coalesces edits made during an in-flight write without overlapping writes", async () => {
    const firstWrite = deferred();
    const started: string[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const write = vi.fn(async (draft: DraftCheckpoint) => {
      started.push(draft.markdown);
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      if (draft.markdown === "first") await firstWrite.promise;
      activeWrites -= 1;
    });
    const scheduler = createDraftCheckpointScheduler(
      { write, clear: vi.fn(async () => undefined) },
      { delayMs: 1_000 },
    );

    scheduler.markDirty(checkpoint("first", "2026-08-01T12:00:00Z"));
    const firstFlush = scheduler.flush();
    await Promise.resolve();
    scheduler.markDirty(checkpoint("second", "2026-08-01T12:00:01Z"));
    scheduler.markDirty(checkpoint("latest", "2026-08-01T12:00:02Z"));
    const latestFlush = scheduler.flush();

    expect(started).toEqual(["first"]);
    firstWrite.resolve();
    await Promise.all([firstFlush, latestFlush]);

    expect(started).toEqual(["first", "latest"]);
    expect(maximumActiveWrites).toBe(1);
  });

  it("clears the selected checkpoint after a successful normal save", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    const scheduler = createDraftCheckpointScheduler(
      { write, clear },
      { delayMs: 1_000 },
    );
    scheduler.markDirty(checkpoint("saved normally", "2026-08-01T12:00:00Z"));

    await scheduler.handleSaveOutcome("saved", key);
    await vi.runAllTimersAsync();

    expect(clear).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(key);
    expect(write).not.toHaveBeenCalled();
  });

  it("never clears a checkpoint when the normal save conflicts", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    const expected = checkpoint("local conflict", "2026-08-01T12:00:00Z");
    const scheduler = createDraftCheckpointScheduler(
      { write, clear },
      { delayMs: 1_000 },
    );
    scheduler.markDirty(expected);

    await scheduler.handleSaveOutcome("conflict", key);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(clear).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expected);
  });

  it("flushes the pending draft immediately when visibility becomes hidden", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const expected = checkpoint("hidden draft", "2026-08-01T12:00:00Z");
    const scheduler = createDraftCheckpointScheduler(
      { write, clear: vi.fn(async () => undefined) },
      { delayMs: 30_000 },
    );
    scheduler.markDirty(expected);

    await scheduler.handleVisibilityChange("hidden");

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expected);
  });

  it("retains a failed checkpoint so a later flush can retry it exactly", async () => {
    const expected = checkpoint("retry me", "2026-08-01T12:00:00Z");
    const write = vi
      .fn<(draft: DraftCheckpoint) => Promise<void>>()
      .mockRejectedValueOnce(new Error("app data unavailable"))
      .mockResolvedValueOnce(undefined);
    const scheduler = createDraftCheckpointScheduler(
      { write, clear: vi.fn(async () => undefined) },
      { delayMs: 1_000 },
    );
    scheduler.markDirty(expected);

    await expect(scheduler.flush()).rejects.toThrow("app data unavailable");
    await expect(scheduler.flush()).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, expected);
    expect(write).toHaveBeenNthCalledWith(2, expected);
  });

  it("flushes a pending checkpoint before disposal", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const expected = checkpoint("dispose safely", "2026-08-01T12:00:00Z");
    const scheduler = createDraftCheckpointScheduler(
      { write, clear: vi.fn(async () => undefined) },
      { delayMs: 30_000 },
    );
    scheduler.markDirty(expected);

    await scheduler.dispose();
    await vi.runAllTimersAsync();

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expected);
  });
});

describe("reconcileDraftCheckpoint", () => {
  const diskNote: Note = {
    id: "notes/plan",
    title: "Plan",
    content: "# Plan\n\nSaved",
    path: "/workspace/Notes/Plan.md",
    modified: 1,
    revision: "disk-revision",
  };

  it("restores exact unsaved Markdown while retaining disk as conflict authority", () => {
    const recovered = checkpoint(
      "# Plan\n\nUnsaved local text  \n",
      "2026-08-01T12:00:00Z",
    );

    expect(reconcileDraftCheckpoint(diskNote, recovered)).toEqual({
      note: {
        ...diskNote,
        content: "# Plan\n\nUnsaved local text  \n",
      },
      remote: diskNote,
      recovered: true,
      shouldClear: false,
    });
  });

  it("clears a checkpoint already identical to durable Markdown", () => {
    const alreadySaved = checkpoint(
      diskNote.content,
      "2026-08-01T12:00:00Z",
    );

    expect(reconcileDraftCheckpoint(diskNote, alreadySaved)).toEqual({
      note: diskNote,
      remote: null,
      recovered: false,
      shouldClear: true,
    });
  });
});
