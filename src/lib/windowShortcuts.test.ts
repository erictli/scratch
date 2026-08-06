import { describe, expect, it } from "vitest";
import { resolveWindowShortcut } from "./windowShortcuts";

describe("resolveWindowShortcut", () => {
  it.each([
    ["=", false, "zoom-in"],
    ["+", true, "zoom-in"],
    ["-", false, "zoom-out"],
    ["_", true, "zoom-out"],
    ["0", false, "zoom-reset"],
    [",", false, "preferences"],
  ] as const)("maps Cmd+%s to %s", (key, shiftKey, expected) => {
    expect(
      resolveWindowShortcut({
        key,
        metaKey: true,
        ctrlKey: false,
        shiftKey,
        altKey: false,
      }),
    ).toBe(expected);
  });

  it("ignores unmodified keys and Option-modified commands", () => {
    expect(
      resolveWindowShortcut({
        key: "+",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      resolveWindowShortcut({
        key: "+",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: true,
      }),
    ).toBeNull();
  });

  it("maps Ctrl+plus to zoom in", () => {
    expect(
      resolveWindowShortcut({
        key: "+",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe("zoom-in");
  });

  it.each([
    ["Equal", "zoom-in"],
    ["NumpadAdd", "zoom-in"],
    ["Minus", "zoom-out"],
    ["NumpadSubtract", "zoom-out"],
    ["Digit0", "zoom-reset"],
    ["Numpad0", "zoom-reset"],
  ] as const)("uses physical %s as a keyboard-layout fallback", (code, expected) => {
    expect(
      resolveWindowShortcut({
        key: "Dead",
        code,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(expected);
  });
});
