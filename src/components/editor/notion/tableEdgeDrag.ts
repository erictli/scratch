export type TableEdgeDragAxis = "row" | "column";

interface TableEdgeDragPoint {
  left: number;
  top: number;
}

interface TableEdgeDragInput {
  axis: TableEdgeDragAxis;
  start: TableEdgeDragPoint;
  current: TableEdgeDragPoint;
  itemCount: number;
}

const TABLE_EDGE_DRAG_STEP = 40;

export function resolveTableEdgeDragDelta({
  axis,
  start,
  current,
  itemCount,
}: TableEdgeDragInput): number {
  const distance =
    axis === "row" ? current.top - start.top : current.left - start.left;
  const steps = Math.trunc(distance / TABLE_EDGE_DRAG_STEP);
  const minimum = -(Math.max(1, Math.trunc(itemCount)) - 1);
  const delta = Math.max(minimum, steps);
  return Object.is(delta, -0) ? 0 : delta;
}
