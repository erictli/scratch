import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../types/note";
import { createSettingsPatchQueue } from "./settingsUpdateQueue";

function settings(): Settings {
  return { theme: { mode: "system" } };
}

describe("createSettingsPatchQueue", () => {
  it("reloads settings after each queued save so concurrent patches are retained", async () => {
    let stored = settings();
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const loadSettings = vi.fn(async () => ({ ...stored }));
    const saveSettings = vi.fn(async (next: Settings) => {
      if (saveSettings.mock.calls.length === 1) {
        await firstSaveBlocked;
      }
      stored = next;
    });
    const patchSettings = createSettingsPatchQueue(loadSettings, saveSettings);

    const resizeUpdate = patchSettings({ editorWidthResizeEnabled: false });
    const toolbarUpdate = patchSettings({ editorToolbarVisible: true });
    await Promise.resolve();

    expect(loadSettings).toHaveBeenCalledTimes(1);
    releaseFirstSave?.();
    await Promise.all([resizeUpdate, toolbarUpdate]);

    expect(loadSettings).toHaveBeenCalledTimes(2);
    expect(stored.editorWidthResizeEnabled).toBe(false);
    expect(stored.editorToolbarVisible).toBe(true);
  });

  it("continues processing after a failed save", async () => {
    let stored = settings();
    const loadSettings = vi.fn(async () => ({ ...stored }));
    const saveSettings = vi
      .fn<(next: Settings) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementationOnce(async (next) => {
        stored = next;
      });
    const patchSettings = createSettingsPatchQueue(loadSettings, saveSettings);

    const failedUpdate = patchSettings({ editorToolbarVisible: true });
    const nextUpdate = patchSettings({ editorWidthResizeEnabled: false });

    await expect(failedUpdate).rejects.toThrow("disk unavailable");
    await expect(nextUpdate).resolves.toBeUndefined();
    expect(stored.editorWidthResizeEnabled).toBe(false);
  });
});
