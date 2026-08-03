import { describe, expect, it } from "vitest";
import { shouldSyncMainFolderLocation } from "./workspace";

describe("workspace event isolation", () => {
  it("applies CLI folder-location changes only to the main window", () => {
    expect(shouldSyncMainFolderLocation("main")).toBe(true);
    expect(shouldSyncMainFolderLocation("workspace-client")).toBe(false);
    expect(shouldSyncMainFolderLocation("preview-external")).toBe(false);
  });
});
