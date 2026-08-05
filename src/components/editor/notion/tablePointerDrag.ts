export interface TablePointerPoint {
  left: number;
  top: number;
}

export interface TableDragRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export type TableDragAxis = "row" | "column";

export interface TablePointerDrop {
  targetIndex: number;
  indicatorCoordinate: number;
}

const TABLE_POINTER_DRAG_THRESHOLD = 4;
const TABLE_DROP_CROSS_AXIS_TOLERANCE = 32;
const TABLE_DROP_MAIN_AXIS_TOLERANCE = 24;

export function hasExceededTablePointerDragThreshold(
  start: TablePointerPoint,
  current: TablePointerPoint,
): boolean {
  const horizontalDistance = current.left - start.left;
  const verticalDistance = current.top - start.top;
  return (
    horizontalDistance * horizontalDistance +
      verticalDistance * verticalDistance >=
    TABLE_POINTER_DRAG_THRESHOLD * TABLE_POINTER_DRAG_THRESHOLD
  );
}

export function resolveTablePointerDrop(
  rects: readonly TableDragRect[],
  sourceIndex: number,
  axis: TableDragAxis,
  point: TablePointerPoint,
): TablePointerDrop | null {
  if (
    rects.length === 0 ||
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= rects.length
  ) {
    return null;
  }

  const coordinate = axis === "row" ? point.top : point.left;
  const crossCoordinate = axis === "row" ? point.left : point.top;
  const mainStarts = rects.map((rect) =>
    axis === "row" ? rect.top : rect.left,
  );
  const mainEnds = rects.map((rect) =>
    axis === "row" ? rect.bottom : rect.right,
  );
  const crossStarts = rects.map((rect) =>
    axis === "row" ? rect.left : rect.top,
  );
  const crossEnds = rects.map((rect) =>
    axis === "row" ? rect.right : rect.bottom,
  );
  const mainStart = Math.min(...mainStarts);
  const mainEnd = Math.max(...mainEnds);
  const crossStart = Math.min(...crossStarts);
  const crossEnd = Math.max(...crossEnds);

  if (
    coordinate < mainStart - TABLE_DROP_MAIN_AXIS_TOLERANCE ||
    coordinate > mainEnd + TABLE_DROP_MAIN_AXIS_TOLERANCE ||
    crossCoordinate < crossStart - TABLE_DROP_CROSS_AXIS_TOLERANCE ||
    crossCoordinate > crossEnd + TABLE_DROP_CROSS_AXIS_TOLERANCE
  ) {
    return null;
  }

  let boundaryIndex = 0;
  if (coordinate >= mainEnd) {
    boundaryIndex = rects.length;
  } else if (coordinate > mainStart) {
    const hoveredIndex = rects.findIndex((rect) =>
      axis === "row"
        ? coordinate <= rect.bottom
        : coordinate <= rect.right,
    );
    const resolvedIndex = hoveredIndex < 0 ? rects.length - 1 : hoveredIndex;
    const hoveredRect = rects[resolvedIndex];
    const midpoint =
      axis === "row"
        ? hoveredRect.top + hoveredRect.height / 2
        : hoveredRect.left + hoveredRect.width / 2;
    boundaryIndex = coordinate < midpoint ? resolvedIndex : resolvedIndex + 1;
  }

  const targetIndex =
    boundaryIndex > sourceIndex ? boundaryIndex - 1 : boundaryIndex;
  if (targetIndex === sourceIndex) return null;
  const indicatorCoordinate =
    boundaryIndex === rects.length
      ? mainEnd
      : axis === "row"
        ? rects[boundaryIndex].top
        : rects[boundaryIndex].left;

  return {
    targetIndex,
    indicatorCoordinate,
  };
}
