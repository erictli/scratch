import type { TableDragRect, TablePointerPoint } from "./tablePointerDrag";

export interface TableProximityLayout {
  tableRect: TableDragRect;
  rowRects: readonly TableDragRect[];
  columnRects: readonly TableDragRect[];
}

export type TableProximityTarget =
  | { kind: "table" }
  | { kind: "row"; index: number }
  | { kind: "column"; index: number }
  | { kind: "rowResize"; index: number }
  | { kind: "columnResize"; index: number }
  | { kind: "addRow" }
  | { kind: "addColumn" };

export const TABLE_AXIS_STRUCTURAL_OUTER_PROXIMITY = 32;
const STRUCTURAL_INNER_PROXIMITY = 10;
const RESIZE_PROXIMITY = 4;
const ADD_CONTROL_MIN_OFFSET = 5;
const ADD_CONTROL_MAX_OFFSET = 24;
const TABLE_CONTROL_OUTER_OFFSET = 48;
const TABLE_CONTROL_INNER_OFFSET = 18;

function between(value: number, minimum: number, maximum: number): boolean {
  return value >= minimum && value <= maximum;
}

export function resolveTableProximityTarget(
  layout: TableProximityLayout,
  point: TablePointerPoint,
): TableProximityTarget | null {
  const { tableRect, rowRects, columnRects } = layout;

  const columnResizeIndex = columnRects.findIndex(
    (rect) =>
      Math.abs(point.left - rect.right) <= RESIZE_PROXIMITY &&
      between(point.top, tableRect.top, tableRect.bottom),
  );
  if (columnResizeIndex >= 0) {
    return { kind: "columnResize", index: columnResizeIndex };
  }

  const rowResizeIndex = rowRects.findIndex(
    (rect) =>
      Math.abs(point.top - rect.bottom) <= RESIZE_PROXIMITY &&
      between(point.left, tableRect.left, tableRect.right),
  );
  if (rowResizeIndex >= 0) {
    return { kind: "rowResize", index: rowResizeIndex };
  }

  const rowIndex = rowRects.findIndex(
    (rect) =>
      between(point.top, rect.top, rect.bottom) &&
      between(
        point.left,
        tableRect.left - TABLE_AXIS_STRUCTURAL_OUTER_PROXIMITY,
        tableRect.left + STRUCTURAL_INNER_PROXIMITY,
      ),
  );
  if (rowIndex >= 0) return { kind: "row", index: rowIndex };

  const columnIndex = columnRects.findIndex(
    (rect) =>
      between(point.left, rect.left, rect.right) &&
      between(
        point.top,
        tableRect.top - TABLE_AXIS_STRUCTURAL_OUTER_PROXIMITY,
        tableRect.top + STRUCTURAL_INNER_PROXIMITY,
      ),
  );
  if (columnIndex >= 0) return { kind: "column", index: columnIndex };

  if (
    between(
      point.left,
      tableRect.left - TABLE_CONTROL_OUTER_OFFSET,
      tableRect.left - TABLE_CONTROL_INNER_OFFSET,
    ) &&
    between(
      point.top,
      tableRect.top - TABLE_CONTROL_OUTER_OFFSET,
      tableRect.top - TABLE_CONTROL_INNER_OFFSET,
    )
  ) {
    return { kind: "table" };
  }

  if (
    between(point.left, tableRect.left, tableRect.right) &&
    between(
      point.top,
      tableRect.bottom + ADD_CONTROL_MIN_OFFSET,
      tableRect.bottom + ADD_CONTROL_MAX_OFFSET,
    )
  ) {
    return { kind: "addRow" };
  }

  if (
    between(point.top, tableRect.top, tableRect.bottom) &&
    between(
      point.left,
      tableRect.right + ADD_CONTROL_MIN_OFFSET,
      tableRect.right + ADD_CONTROL_MAX_OFFSET,
    )
  ) {
    return { kind: "addColumn" };
  }

  return null;
}
