import { describe, expect, it } from "vitest";
import {
  getSlashCommandMenuMaxHeight,
  normalizeSlashCommandReferenceRect,
} from "./SlashCommand";

describe("normalizeSlashCommandReferenceRect", () => {
  it("removes the document zoom already included in cursor coordinates", () => {
    const cursorRect = new DOMRect(50, 457, 10, 41.5);

    const normalized = normalizeSlashCommandReferenceRect(cursorRect, 1.25);

    expect(normalized.x).toBeCloseTo(40);
    expect(normalized.y).toBeCloseTo(365.6);
    expect(normalized.width).toBeCloseTo(8);
    expect(normalized.height).toBeCloseTo(33.2);
    expect(normalized.bottom).toBeCloseTo(398.8);
  });

  it("keeps cursor coordinates unchanged at 100 percent zoom", () => {
    const cursorRect = new DOMRect(50, 457, 10, 41.5);

    const normalized = normalizeSlashCommandReferenceRect(cursorRect, 1);

    expect(normalized.toJSON()).toMatchObject(cursorRect.toJSON());
  });

  it("limits the menu height to the visible space below the cursor", () => {
    const cursorRect = new DOMRect(50, 457, 10, 41.5);

    expect(getSlashCommandMenuMaxHeight(cursorRect, 851, 1.25)).toBe(268);
  });

  it("keeps the standard menu height when enough space is available", () => {
    const cursorRect = new DOMRect(50, 100, 10, 40);

    expect(getSlashCommandMenuMaxHeight(cursorRect, 851, 1)).toBe(320);
  });

  it("never returns a negative menu height at the viewport edge", () => {
    const cursorRect = new DOMRect(50, 820, 10, 30);

    expect(getSlashCommandMenuMaxHeight(cursorRect, 851, 1.25)).toBe(0);
  });
});
