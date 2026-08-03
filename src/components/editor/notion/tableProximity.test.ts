import { describe, expect, it } from "vitest";
import { resolveTableProximityTarget } from "./tableProximity";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  right: left + width,
  top,
  bottom: top + height,
  width,
  height,
});

const layout = {
  tableRect: rect(100, 100, 300, 120),
  rowRects: [
    rect(100, 100, 300, 40),
    rect(100, 140, 300, 40),
    rect(100, 180, 300, 40),
  ],
  columnRects: [
    rect(100, 100, 100, 120),
    rect(200, 100, 100, 120),
    rect(300, 100, 100, 120),
  ],
};

describe("table control proximity", () => {
  it("shows no structural handle in the center of a cell", () => {
    expect(resolveTableProximityTarget(layout, { left: 150, top: 120 }))
      .toBeNull();
  });

  it("chooses one row or column handle only near its associated edge", () => {
    expect(resolveTableProximityTarget(layout, { left: 92, top: 160 }))
      .toEqual({ kind: "row", index: 1 });
    expect(resolveTableProximityTarget(layout, { left: 250, top: 92 }))
      .toEqual({ kind: "column", index: 1 });
  });

  it("gives resize separators priority over structural handles", () => {
    expect(resolveTableProximityTarget(layout, { left: 200, top: 110 }))
      .toEqual({ kind: "columnResize", index: 0 });
    expect(resolveTableProximityTarget(layout, { left: 150, top: 140 }))
      .toEqual({ kind: "rowResize", index: 0 });
  });

  it("keeps the last column border available for resizing", () => {
    expect(resolveTableProximityTarget(layout, { left: 400, top: 120 }))
      .toEqual({ kind: "columnResize", index: 2 });
  });

  it("keeps table actions and add controls in dedicated outer zones", () => {
    expect(resolveTableProximityTarget(layout, { left: 72, top: 72 }))
      .toEqual({ kind: "table" });
    expect(resolveTableProximityTarget(layout, { left: 250, top: 236 }))
      .toEqual({ kind: "addRow" });
    expect(resolveTableProximityTarget(layout, { left: 416, top: 160 }))
      .toEqual({ kind: "addColumn" });
  });

  it("uses pointer distance near the upper-left overlap", () => {
    expect(resolveTableProximityTarget(layout, { left: 94, top: 120 }))
      .toEqual({ kind: "row", index: 0 });
    expect(resolveTableProximityTarget(layout, { left: 120, top: 94 }))
      .toEqual({ kind: "column", index: 0 });
  });

  it("returns no control outside all bounded proximity zones", () => {
    expect(resolveTableProximityTarget(layout, { left: 20, top: 160 }))
      .toBeNull();
    expect(resolveTableProximityTarget(layout, { left: 250, top: 300 }))
      .toBeNull();
  });
});
