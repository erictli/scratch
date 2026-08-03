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
});
