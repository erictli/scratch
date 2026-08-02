import { describe, expect, it } from "vitest";
import { resolveTableAutoScrollDelta } from "./tableAutoScroll";

const viewport = { left: 0, top: 0, right: 600, bottom: 400 };

describe("table drag auto-scroll", () => {
  it("scrolls vertically only near the top or bottom edge during a row drag", () => {
    expect(
      resolveTableAutoScrollDelta({
        axis: "row",
        pointer: { left: 300, top: 8 },
        viewport,
      }),
    ).toBeLessThan(0);
    expect(
      resolveTableAutoScrollDelta({
        axis: "row",
        pointer: { left: 300, top: 392 },
        viewport,
      }),
    ).toBeGreaterThan(0);
    expect(
      resolveTableAutoScrollDelta({
        axis: "row",
        pointer: { left: 8, top: 200 },
        viewport,
      }),
    ).toBe(0);
  });

  it("scrolls horizontally only near the left or right edge during a column drag", () => {
    expect(
      resolveTableAutoScrollDelta({
        axis: "column",
        pointer: { left: 8, top: 200 },
        viewport,
      }),
    ).toBeLessThan(0);
    expect(
      resolveTableAutoScrollDelta({
        axis: "column",
        pointer: { left: 592, top: 200 },
        viewport,
      }),
    ).toBeGreaterThan(0);
    expect(
      resolveTableAutoScrollDelta({
        axis: "column",
        pointer: { left: 300, top: 8 },
        viewport,
      }),
    ).toBe(0);
  });

  it("stays bounded when the pointer moves beyond the viewport", () => {
    expect(
      resolveTableAutoScrollDelta({
        axis: "row",
        pointer: { left: 300, top: 900 },
        viewport,
      }),
    ).toBe(18);
    expect(
      resolveTableAutoScrollDelta({
        axis: "column",
        pointer: { left: -500, top: 200 },
        viewport,
      }),
    ).toBe(-18);
  });
});
