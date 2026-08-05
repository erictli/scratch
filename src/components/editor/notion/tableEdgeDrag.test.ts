import { describe, expect, it } from "vitest";
import { resolveTableEdgeDragDelta } from "./tableEdgeDrag";

describe("table edge drag", () => {
  it("resolves row growth from logical vertical movement in 40px steps", () => {
    expect(
      resolveTableEdgeDragDelta({
        axis: "row",
        start: { left: 100, top: 200 },
        current: { left: 900, top: 280 },
        itemCount: 2,
      }),
    ).toBe(2);
  });

  it("resolves column growth from logical horizontal movement in 40px steps", () => {
    expect(
      resolveTableEdgeDragDelta({
        axis: "column",
        start: { left: 100, top: 200 },
        current: { left: 180, top: 900 },
        itemCount: 2,
      }),
    ).toBe(2);
  });

  it("returns zero below one complete logical step in either direction", () => {
    expect(
      resolveTableEdgeDragDelta({
        axis: "row",
        start: { left: 0, top: 100 },
        current: { left: 500, top: 139 },
        itemCount: 2,
      }),
    ).toBe(0);
    expect(
      resolveTableEdgeDragDelta({
        axis: "column",
        start: { left: 100, top: 0 },
        current: { left: 61, top: 500 },
        itemCount: 2,
      }),
    ).toBe(0);
  });

  it("clamps shrinkage so at least one row or column remains", () => {
    expect(
      resolveTableEdgeDragDelta({
        axis: "row",
        start: { left: 0, top: 200 },
        current: { left: 0, top: -200 },
        itemCount: 3,
      }),
    ).toBe(-2);
    expect(
      resolveTableEdgeDragDelta({
        axis: "column",
        start: { left: 200, top: 0 },
        current: { left: -200, top: 0 },
        itemCount: 1,
      }),
    ).toBe(0);
  });
});
