import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWindowSessionPatchWriter,
  readRestoredNote,
  restoreWindowSession,
  type WindowSession,
  type WindowSessionPatch,
} from "./windowSession";

const savedSession: WindowSession = {
  workspace: "/notes/work",
  selectedNoteId: "projects/plan",
  sidebarVisible: false,
  focusMode: true,
  geometry: { x: 120, y: 80, width: 1280, height: 800 },
};

describe("restoreWindowSession", () => {
  it("bypasses persistence entirely for a standalone preview window", async () => {
    const load = vi.fn(async () => savedSession);

    const restored = await restoreWindowSession({
      isPreview: true,
      workspace: "/notes/work",
      noteIds: ["projects/plan"],
      load,
    });

    expect(load).not.toHaveBeenCalled();
    expect(restored).toEqual({
      selectedNoteId: null,
      sidebarVisible: true,
      focusMode: false,
      geometry: null,
    });
  });

  it("restores a full window session when its selected note still exists", async () => {
    const restored = await restoreWindowSession({
      isPreview: false,
      workspace: "/notes/work",
      noteIds: ["inbox", "projects/plan"],
      load: async () => savedSession,
    });

    expect(restored).toEqual({
      selectedNoteId: "projects/plan",
      sidebarVisible: false,
      focusMode: true,
      geometry: { x: 120, y: 80, width: 1280, height: 800 },
    });
  });

  it("falls back to an empty selection when the saved note is missing", async () => {
    const restored = await restoreWindowSession({
      isPreview: false,
      workspace: "/notes/work",
      noteIds: ["inbox"],
      load: async () => savedSession,
    });

    expect(restored).toEqual({
      selectedNoteId: null,
      sidebarVisible: false,
      focusMode: false,
      geometry: { x: 120, y: 80, width: 1280, height: 800 },
    });
  });

  it("uses safe defaults when the session cannot be loaded", async () => {
    const restored = await restoreWindowSession({
      isPreview: false,
      workspace: "/notes/work",
      noteIds: ["projects/plan"],
      load: async () => {
        throw new Error("backend unavailable");
      },
    });

    expect(restored).toEqual({
      selectedNoteId: null,
      sidebarVisible: true,
      focusMode: false,
      geometry: null,
    });
  });

  it("uses safe defaults when the saved session belongs to another workspace", async () => {
    const restored = await restoreWindowSession({
      isPreview: false,
      workspace: "/notes/current",
      noteIds: ["projects/plan"],
      load: async () => savedSession,
    });

    expect(restored).toEqual({
      selectedNoteId: null,
      sidebarVisible: true,
      focusMode: false,
      geometry: null,
    });
  });

  it("defaults missing booleans while preserving explicit false values", async () => {
    const missingFields = {
      workspace: "/notes/work",
      selectedNoteId: "projects/plan",
      geometry: null,
    } as WindowSession;
    const explicitFalse = {
      ...missingFields,
      sidebarVisible: false,
      focusMode: false,
    };

    await expect(
      restoreWindowSession({
        isPreview: false,
        workspace: "/notes/work",
        noteIds: ["projects/plan"],
        load: async () => missingFields,
      }),
    ).resolves.toMatchObject({ sidebarVisible: true, focusMode: false });
    await expect(
      restoreWindowSession({
        isPreview: false,
        workspace: "/notes/work",
        noteIds: ["projects/plan"],
        load: async () => explicitFalse,
      }),
    ).resolves.toMatchObject({ sidebarVisible: false, focusMode: false });
  });

  it.each([
    { x: Number.NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 100, height: 100 },
    { x: 0, y: 0, width: 0, height: 100 },
    { x: 0, y: 0, width: 100, height: -1 },
    { x: 0, y: 0, width: 100 } as unknown as WindowSession["geometry"],
    { x: "0", y: 0, width: 100, height: 100 } as unknown as WindowSession["geometry"],
  ])("drops malformed restored geometry %#", async (geometry) => {
    const restored = await restoreWindowSession({
      isPreview: false,
      workspace: "/notes/work",
      noteIds: ["projects/plan"],
      load: async () => ({ ...savedSession, geometry }),
    });

    expect(restored.geometry).toBeNull();
  });
});

describe("readRestoredNote", () => {
  it("returns no note when a saved selection disappears before it is read", async () => {
    const read = vi.fn(async (_id: string) => {
      throw new Error("note disappeared");
    });

    const note = await readRestoredNote("projects/plan", read);

    expect(note).toBeNull();
    expect(read).toHaveBeenCalledWith("projects/plan");
  });
});

describe("createWindowSessionPatchWriter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid updates and coalesces them into the latest complete patch", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_patch: WindowSessionPatch) => undefined);
    const writer = createWindowSessionPatchWriter(write, { delayMs: 200 });

    writer.queue({ sidebarVisible: false });
    writer.queue({ focusMode: true });
    writer.queue({
      geometry: { x: 10, y: 20, width: 900, height: 600 },
    });
    writer.queue({
      geometry: { x: 30, y: 40, width: 1200, height: 760 },
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      sidebarVisible: false,
      focusMode: true,
      geometry: { x: 30, y: 40, width: 1200, height: 760 },
    });

    writer.cancel();
  });

  it("automatically retries a failed write without another queue call", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const write = vi
      .fn<(patch: WindowSessionPatch) => Promise<void>>()
      .mockRejectedValueOnce(new Error("session unavailable"))
      .mockResolvedValueOnce(undefined);
    const writer = createWindowSessionPatchWriter(write, {
      delayMs: 200,
      onError,
    });

    writer.queue({ sidebarVisible: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(write).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(199);
    expect(write).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({ sidebarVisible: false });
  });

  it("merges newer pending fields over a failed older patch before retry", async () => {
    vi.useFakeTimers();
    let rejectFirst: (error: Error) => void = () => undefined;
    const firstWrite = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const write = vi
      .fn<(patch: WindowSessionPatch) => Promise<void>>()
      .mockImplementationOnce(async () => firstWrite)
      .mockResolvedValueOnce(undefined);
    const writer = createWindowSessionPatchWriter(write, {
      delayMs: 200,
      onError: vi.fn(),
    });

    writer.queue({ sidebarVisible: false, focusMode: false });
    await vi.advanceTimersByTimeAsync(200);
    writer.queue({ focusMode: true });
    rejectFirst(new Error("first write failed"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({
      sidebarVisible: false,
      focusMode: true,
    });
  });

  it("cancels a scheduled retry and ignores queues after cancellation", async () => {
    vi.useFakeTimers();
    const write = vi
      .fn<(patch: WindowSessionPatch) => Promise<void>>()
      .mockRejectedValueOnce(new Error("session unavailable"));
    const writer = createWindowSessionPatchWriter(write, {
      delayMs: 200,
      onError: vi.fn(),
    });

    writer.queue({ sidebarVisible: false });
    await vi.advanceTimersByTimeAsync(200);
    writer.cancel();
    writer.queue({ focusMode: true });
    await vi.runAllTimersAsync();

    expect(write).toHaveBeenCalledOnce();
  });
});
