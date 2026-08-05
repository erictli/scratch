import { describe, expect, it } from "vitest";
import { getWindowMode } from "./windowMode";

describe("getWindowMode", () => {
  it("decodes an encoded standalone path exactly once", () => {
    expect(
      getWindowMode("?mode=preview&file=%2Ftmp%2F100%25.md"),
    ).toEqual({
      isPreview: true,
      isPreferences: false,
      previewFile: "/tmp/100%.md",
    });
  });

  it("recognizes a dedicated Preferences window", () => {
    expect(getWindowMode("?mode=preferences")).toEqual({
      isPreview: false,
      isPreferences: true,
      previewFile: null,
    });
  });
});
