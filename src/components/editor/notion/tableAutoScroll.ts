import type { TableDragAxis, TablePointerPoint } from "./tablePointerDrag";

interface TableAutoScrollViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TableAutoScrollInput {
  axis: TableDragAxis;
  pointer: TablePointerPoint;
  viewport: TableAutoScrollViewport;
}

const AUTO_SCROLL_THRESHOLD = 48;
const AUTO_SCROLL_MAX_DELTA = 18;

function edgeDelta(
  coordinate: number,
  minimum: number,
  maximum: number,
): number {
  if (coordinate < minimum + AUTO_SCROLL_THRESHOLD) {
    const strength = Math.min(
      1,
      (minimum + AUTO_SCROLL_THRESHOLD - coordinate) /
        AUTO_SCROLL_THRESHOLD,
    );
    return -Math.max(1, Math.round(AUTO_SCROLL_MAX_DELTA * strength));
  }
  if (coordinate > maximum - AUTO_SCROLL_THRESHOLD) {
    const strength = Math.min(
      1,
      (coordinate - (maximum - AUTO_SCROLL_THRESHOLD)) /
        AUTO_SCROLL_THRESHOLD,
    );
    return Math.max(1, Math.round(AUTO_SCROLL_MAX_DELTA * strength));
  }
  return 0;
}

export function resolveTableAutoScrollDelta({
  axis,
  pointer,
  viewport,
}: TableAutoScrollInput): number {
  return axis === "row"
    ? edgeDelta(pointer.top, viewport.top, viewport.bottom)
    : edgeDelta(pointer.left, viewport.left, viewport.right);
}
