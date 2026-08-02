import { describe, expect, it } from "vitest";
import { mod, shift } from "./platform";
import { shortcutCategories } from "./shortcuts";

describe("window shortcuts", () => {
  it("documents the native new-window shortcut", () => {
    const shortcut = shortcutCategories
      .flatMap((category) => category.shortcuts)
      .find((entry) => entry.description === "New window");

    expect(shortcut?.keys).toEqual([mod, shift, "N"]);
  });
});
