import { describe, expect, it } from "vitest";
import {
  hasExceededTablePointerDragThreshold,
  resolveTablePointerDrop,
} from "./tablePointerDrag";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  right: left + width,
  top,
  bottom: top + height,
  width,
  height,
});

describe("table pointer drag", () => {
  it("starts only after a four-pixel pointer movement", () => {
    const start = { left: 10, top: 10 };

    expect(
      hasExceededTablePointerDragThreshold(start, { left: 13, top: 10 }),
    ).toBe(false);
    expect(
      hasExceededTablePointerDragThreshold(start, { left: 14, top: 10 }),
    ).toBe(true);
    expect(
      hasExceededTablePointerDragThreshold(start, { left: 13, top: 13 }),
    ).toBe(true);
  });

  it("resolves a row move and its horizontal drop indicator", () => {
    const rows = [
      rect(100, 100, 300, 40),
      rect(100, 140, 300, 60),
      rect(100, 200, 300, 80),
    ];

    expect(
      resolveTablePointerDrop(rows, 1, "row", { left: 90, top: 110 }),
    ).toEqual({ targetIndex: 0, indicatorCoordinate: 100 });
    expect(
      resolveTablePointerDrop(rows, 0, "row", { left: 90, top: 250 }),
    ).toEqual({ targetIndex: 2, indicatorCoordinate: 280 });
    expect(
      resolveTablePointerDrop(rows, 1, "row", { left: 90, top: 170 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop(rows, 1, "row", { left: 110, top: 135 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop(rows, 1, "row", { left: 110, top: 145 }),
    ).toBeNull();
  });

  it("resolves a column move and its vertical drop indicator", () => {
    const columns = [
      rect(100, 100, 80, 200),
      rect(180, 100, 120, 200),
      rect(300, 100, 160, 200),
    ];

    expect(
      resolveTablePointerDrop(columns, 2, "column", { left: 115, top: 90 }),
    ).toEqual({ targetIndex: 0, indicatorCoordinate: 100 });
    expect(
      resolveTablePointerDrop(columns, 0, "column", { left: 420, top: 90 }),
    ).toEqual({ targetIndex: 2, indicatorCoordinate: 460 });
  });

  it("rejects invalid or empty geometry", () => {
    expect(
      resolveTablePointerDrop([], 0, "row", { left: 0, top: 0 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop([rect(0, 0, 10, 10)], 2, "row", {
        left: 0,
        top: 0,
      }),
    ).toBeNull();
  });

  it("rejects row and column drops outside the table proximity", () => {
    const rows = [rect(100, 100, 300, 40), rect(100, 140, 300, 40)];
    const columns = [rect(100, 100, 150, 80), rect(250, 100, 150, 80)];

    expect(
      resolveTablePointerDrop(rows, 0, "row", { left: -500, top: 170 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop(rows, 0, "row", { left: 150, top: 800 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop(columns, 0, "column", { left: 350, top: 800 }),
    ).toBeNull();
    expect(
      resolveTablePointerDrop(columns, 0, "column", { left: 900, top: 130 }),
    ).toBeNull();
  });
});
