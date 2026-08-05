import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpToLineIcon,
} from "../../icons";
import {
  clearTableColumn,
  clearTableRow,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  fitTableColumnsToWidth,
  hasPinnedTableHeaderColumn,
  hasPinnedTableHeaderRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  setTableColumnBackgroundColor,
  setTableColumnWidths,
  setTableRowBackgroundColor,
  setTableRowHeight,
  resizeTableAtEnd,
  toggleTableHeaderColumn,
  toggleTableHeaderRow,
} from "./tableTransactions";
import {
  MIN_TABLE_COLUMN_WIDTH,
  TABLE_BACKGROUND_COLOR_OPTIONS,
} from "./tableMetadata";
import { createScratchTableColumnResizePreview } from "./tableView";
import {
  hasExceededTablePointerDragThreshold,
  resolveTablePointerDrop,
  type TableDragAxis,
  type TablePointerPoint,
  type TablePointerDrop,
} from "./tablePointerDrag";
import {
  resolveTableProximityTarget,
  type TableProximityTarget,
} from "./tableProximity";
import {
  createTableRowResizePreview,
  getTableRowResizeHeight,
} from "./tableRowResize";
import {
  getInterfaceZoom,
  viewportValueToInterface,
} from "./interfaceGeometry";
import {
  resolveTableEdgeDragDelta,
  type TableEdgeDragAxis,
} from "./tableEdgeDrag";
import { resolveTableAutoScrollDelta } from "./tableAutoScroll";

interface TableSelectionContext {
  tablePos: number;
  rowIndex: number;
  columnIndex: number;
}

interface TableLayout extends TableSelectionContext {
  tableRect: DOMRect;
  rowRects: DOMRect[];
  columnRects: DOMRect[];
  rowElements: HTMLTableRowElement[];
}

interface TableDragIndicator {
  axis: TableDragAxis;
  left: number;
  top: number;
  width: number;
  height: number;
}

const TABLE_BACKGROUND_COLOR_NAMES = [
  "Gray",
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Blue",
  "Purple",
  "Pink",
] as const;

// Row/column reorder grips and edge add controls are intentionally withheld
// from the product UI until their pointer interactions are stable enough to
// ship without conflicting with text editing or native table resizing.
const TABLE_STRUCTURE_CONTROLS_VISIBLE = false;

function sameProximityTarget(
  current: TableProximityTarget | null,
  next: TableProximityTarget | null,
): boolean {
  if (current === next) return true;
  if (!current || !next || current.kind !== next.kind) return false;
  return (
    !("index" in current) ||
    !("index" in next) ||
    current.index === next.index
  );
}

function getTableSelectionContext(editor: Editor): TableSelectionContext | null {
  const { $anchor } = editor.state.selection;
  let tableDepth = -1;
  let rowDepth = -1;

  for (let depth = $anchor.depth; depth > 0; depth -= 1) {
    const name = $anchor.node(depth).type.name;
    if (rowDepth < 0 && name === "tableRow") rowDepth = depth;
    if (name === "table") {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0) return null;
  return {
    tablePos: $anchor.before(tableDepth),
    rowIndex: $anchor.index(tableDepth),
    columnIndex: $anchor.index(rowDepth),
  };
}

function findTableElement(editor: Editor, tablePos: number): HTMLTableElement | null {
  const nodeDom = editor.view.nodeDOM(tablePos);
  if (nodeDom instanceof HTMLTableElement) return nodeDom;
  if (nodeDom instanceof HTMLElement) return nodeDom.querySelector("table");
  return null;
}

function getTableCellPosition(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
): number | null {
  const table = editor.state.doc.nodeAt(tablePos);
  if (
    !table ||
    table.type.name !== "table" ||
    rowIndex < 0 ||
    rowIndex >= table.childCount
  ) {
    return null;
  }

  let rowPos = tablePos + 1;
  for (let index = 0; index < rowIndex; index += 1) {
    rowPos += table.child(index).nodeSize;
  }

  const row = table.child(rowIndex);
  if (columnIndex < 0 || columnIndex >= row.childCount) return null;

  let cellPos = rowPos + 1;
  for (let index = 0; index < columnIndex; index += 1) {
    cellPos += row.child(index).nodeSize;
  }
  return cellPos;
}

function selectTableAxis(
  editor: Editor,
  layout: TableLayout,
  axis: TableDragAxis,
  index: number,
): boolean {
  const table = editor.state.doc.nodeAt(layout.tablePos);
  if (!table || table.type.name !== "table" || table.childCount === 0) {
    return false;
  }
  const columnCount = table.firstChild?.childCount ?? 0;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    (axis === "row" ? index >= table.childCount : index >= columnCount)
  ) {
    return false;
  }

  const anchorPos =
    axis === "row"
      ? getTableCellPosition(editor, layout.tablePos, index, 0)
      : getTableCellPosition(editor, layout.tablePos, 0, index);
  const headPos =
    axis === "row"
      ? getTableCellPosition(
          editor,
          layout.tablePos,
          index,
          table.child(index)?.childCount - 1,
        )
      : getTableCellPosition(
          editor,
          layout.tablePos,
          table.childCount - 1,
          index,
        );
  if (anchorPos === null || headPos === null) return false;

  const $anchorCell = editor.state.doc.resolve(anchorPos);
  const $headCell = editor.state.doc.resolve(headPos);
  const selection =
    axis === "row"
      ? CellSelection.rowSelection($anchorCell, $headCell)
      : CellSelection.colSelection($anchorCell, $headCell);
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

function applyTableEdgeDelta(
  editor: Editor,
  layout: TableLayout,
  axis: TableEdgeDragAxis,
  delta: number,
): boolean {
  return resizeTableAtEnd(editor, layout.tablePos, axis, delta);
}

function autoScrollTableDrag(
  editor: Editor,
  axis: TableDragAxis,
  pointer: TablePointerPoint,
): boolean {
  const scrollElement = editor.view.dom.closest<HTMLElement>(
    "[data-editor-scroll]",
  );
  if (!scrollElement) return false;

  const delta = resolveTableAutoScrollDelta({
    axis,
    pointer,
    viewport: scrollElement.getBoundingClientRect(),
  });
  if (delta === 0) return false;

  const previousPosition =
    axis === "column" ? scrollElement.scrollLeft : scrollElement.scrollTop;
  scrollElement.scrollBy({
    left: axis === "column" ? delta : 0,
    top: axis === "row" ? delta : 0,
    behavior: "auto",
  });
  const currentPosition =
    axis === "column" ? scrollElement.scrollLeft : scrollElement.scrollTop;
  return currentPosition !== previousPosition;
}

function getAvailableTableWidth(editor: Editor, layout: TableLayout): number {
  const tableElement = layout.rowElements[0]?.closest("table");
  const wrapperWidth = tableElement
    ?.closest<HTMLElement>(".tableWrapper")
    ?.getBoundingClientRect().width;
  if (wrapperWidth && wrapperWidth > 0) return wrapperWidth;

  const editorWidth = editor.view.dom.getBoundingClientRect().width;
  return editorWidth > 0 ? editorWidth : layout.tableRect.width;
}

function measureTable(editor: Editor): TableLayout | null {
  const context = getTableSelectionContext(editor);
  if (!context) return null;
  const tableElement = findTableElement(editor, context.tablePos);
  return tableElement ? measureTableElement(editor, tableElement, context) : null;
}

function tablePositionFromDom(
  editor: Editor,
  tableElement: HTMLTableElement,
): number | null {
  const domCandidates: Node[] = [tableElement];
  if (tableElement.parentNode) domCandidates.push(tableElement.parentNode);

  for (const dom of domCandidates) {
    let position: number;
    try {
      position = editor.view.posAtDOM(dom, 0);
    } catch {
      continue;
    }
    const boundedPosition = Math.max(
      0,
      Math.min(position, editor.state.doc.content.size),
    );
    const directNode = editor.state.doc.nodeAt(boundedPosition);
    if (directNode?.type.name === "table") return boundedPosition;

    const $position = editor.state.doc.resolve(boundedPosition);
    for (let depth = $position.depth; depth > 0; depth -= 1) {
      if ($position.node(depth).type.name === "table") {
        return $position.before(depth);
      }
    }
    if ($position.nodeAfter?.type.name === "table") return boundedPosition;
    if ($position.nodeBefore?.type.name === "table") {
      return boundedPosition - $position.nodeBefore.nodeSize;
    }
  }

  return null;
}

function measureTableElement(
  editor: Editor,
  tableElement: HTMLTableElement,
  selectedContext = getTableSelectionContext(editor),
): TableLayout | null {
  const tablePos = tablePositionFromDom(editor, tableElement);
  if (tablePos === null) return null;

  const rowElements = Array.from(tableElement.rows);
  const firstRow = rowElements[0];
  if (!firstRow) return null;

  const context =
    selectedContext?.tablePos === tablePos
      ? selectedContext
      : { tablePos, rowIndex: 0, columnIndex: 0 };

  return {
    ...context,
    tableRect: tableElement.getBoundingClientRect(),
    rowRects: rowElements.map((row) => row.getBoundingClientRect()),
    columnRects: Array.from(firstRow.cells).map((cell) =>
      cell.getBoundingClientRect(),
    ),
    rowElements,
  };
}

function distanceToRect(rect: DOMRect, point: TablePointerPoint): number {
  const horizontal =
    point.left < rect.left
      ? rect.left - point.left
      : point.left > rect.right
        ? point.left - rect.right
        : 0;
  const vertical =
    point.top < rect.top
      ? rect.top - point.top
      : point.top > rect.bottom
        ? point.top - rect.bottom
        : 0;
  return horizontal * horizontal + vertical * vertical;
}

function findTableAtPointer(
  editor: Editor,
  point: TablePointerPoint,
  currentLayout: TableLayout | null,
): { layout: TableLayout; target: TableProximityTarget } | null {
  const selectedContext = getTableSelectionContext(editor);
  if (currentLayout) {
    const currentElement = findTableElement(editor, currentLayout.tablePos);
    const refreshedLayout = currentElement
      ? measureTableElement(editor, currentElement, selectedContext)
      : null;
    const currentTarget = refreshedLayout
      ? resolveTableProximityTarget(refreshedLayout, point)
      : null;
    if (refreshedLayout && currentTarget) {
      return { layout: refreshedLayout, target: currentTarget };
    }
  }

  let best:
    | { layout: TableLayout; target: TableProximityTarget; distance: number }
    | null = null;

  for (const tableElement of Array.from(
    editor.view.dom.querySelectorAll<HTMLTableElement>("table"),
  )) {
    const candidateLayout = measureTableElement(
      editor,
      tableElement,
      selectedContext,
    );
    if (!candidateLayout || candidateLayout.tablePos === currentLayout?.tablePos) {
      continue;
    }
    const target = resolveTableProximityTarget(candidateLayout, point);
    if (!target) continue;
    const distance = distanceToRect(candidateLayout.tableRect, point);
    if (!best || distance < best.distance) {
      best = { layout: candidateLayout, target, distance };
    }
  }

  return best ? { layout: best.layout, target: best.target } : null;
}

function ActionButton({
  label,
  disabled = false,
  hidden = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  hidden?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (hidden) return null;

  return (
    <button
      type="button"
      className="notion-table-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TableControls({ editor }: { editor: Editor }) {
  const [layout, setLayout] = useState<TableLayout | null>(null);
  const [proximityTarget, setProximityTarget] =
    useState<TableProximityTarget | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionQuery, setActionQuery] = useState("");
  const [colorTarget, setColorTarget] = useState<"row" | "column" | null>(
    null,
  );
  const [dragIndicator, setDragIndicator] =
    useState<TableDragIndicator | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const layoutRef = useRef<TableLayout | null>(null);
  const proximityTargetRef = useRef<TableProximityTarget | null>(null);
  const activeInteractionRef = useRef<TableProximityTarget | null>(null);
  const lastPointerRef = useRef<{ left: number; top: number } | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const keyboardFocusRowRef = useRef<number | null>(null);
  const actionTokens = actionQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const actionMatches = (...labels: string[]) =>
    actionTokens.length === 0 ||
    actionTokens.every((token) =>
      labels.some((label) => label.toLocaleLowerCase().includes(token)),
    );

  useEffect(() => {
    if (actionsOpen) return;
    setActionQuery("");
    setColorTarget(null);
  }, [actionsOpen]);

  const showProximityTarget = useCallback(
    (nextTarget: TableProximityTarget | null) => {
      if (sameProximityTarget(proximityTargetRef.current, nextTarget)) return;
      proximityTargetRef.current = nextTarget;
      setProximityTarget(nextTarget);
    },
    [],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const resolveLastPointer = useCallback(() => {
    if (activeInteractionRef.current) {
      showProximityTarget(activeInteractionRef.current);
      return;
    }
    const currentLayout = layoutRef.current;
    const point = lastPointerRef.current;
    showProximityTarget(
      currentLayout && point
        ? resolveTableProximityTarget(currentLayout, point)
        : null,
    );
  }, [showProximityTarget]);

  const update = useCallback(() => {
    if (editor.isDestroyed) return null;
    // Pointer-resize sessions own their geometry until commit/cancel. An
    // observer frame queued just before pointerdown must not replace the
    // portal layout with transient measurements while the table is previewed.
    if (activeInteractionRef.current?.kind === "rowResize" ||
        activeInteractionRef.current?.kind === "columnResize") {
      return layoutRef.current;
    }
    const selectedLayout = measureTable(editor);
    const pointerCandidate = lastPointerRef.current
      ? findTableAtPointer(editor, lastPointerRef.current, selectedLayout)
      : null;
    const nextLayout = pointerCandidate?.layout ?? selectedLayout;
    layoutRef.current = nextLayout;
    setLayout(nextLayout);
    if (!nextLayout) {
      setActionsOpen(false);
      showProximityTarget(null);
    } else if (
      actionsOpen &&
      !(editor.state.selection instanceof CellSelection)
    ) {
      setActionsOpen(false);
    } else if (activeInteractionRef.current) {
      showProximityTarget(activeInteractionRef.current);
    } else {
      showProximityTarget(pointerCandidate?.target ?? null);
    }
    return nextLayout;
  }, [actionsOpen, editor, showProximityTarget]);

  useEffect(() => {
    const evaluatePointer = () => {
      pointerFrameRef.current = null;
      if (activeInteractionRef.current || !lastPointerRef.current) return;
      const pointerCandidate = findTableAtPointer(
        editor,
        lastPointerRef.current,
        layoutRef.current,
      );
      clearHideTimer();
      if (pointerCandidate) {
        if (pointerCandidate.layout.tablePos !== layoutRef.current?.tablePos) {
          layoutRef.current = pointerCandidate.layout;
          setLayout(pointerCandidate.layout);
          setActionsOpen(false);
        }
        showProximityTarget(pointerCandidate.target);
        return;
      }

      // Small dismissal tolerance avoids flicker at adjacent zones without
      // delaying the appearance of the next valid control.
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        if (!activeInteractionRef.current) showProximityTarget(null);
      }, 50);
    };
    const onPointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { left: event.clientX, top: event.clientY };
      if (
        activeInteractionRef.current ||
        pointerFrameRef.current !== null
      ) {
        return;
      }
      pointerFrameRef.current = requestAnimationFrame(evaluatePointer);
    };
    const onWindowBlur = () => {
      clearHideTimer();
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      lastPointerRef.current = null;
      if (!activeInteractionRef.current) showProximityTarget(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      clearHideTimer();
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [clearHideTimer, editor, showProximityTarget]);

  useEffect(() => {
    const revealSelectedRowActions = (event: KeyboardEvent) => {
      if (!TABLE_STRUCTURE_CONTROLS_VISIBLE) return;
      const isTableShortcut =
        event.code === "KeyT" ||
        (!event.code && event.key.toLocaleLowerCase() === "t");
      if (
        !isTableShortcut ||
        !event.altKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        activeInteractionRef.current
      ) {
        return;
      }
      const selectedLayout = measureTable(editor);
      if (!selectedLayout) return;

      event.preventDefault();
      clearHideTimer();
      layoutRef.current = selectedLayout;
      setLayout(selectedLayout);
      keyboardFocusRowRef.current = selectedLayout.rowIndex;
      showProximityTarget({ kind: "row", index: selectedLayout.rowIndex });
    };

    editor.view.dom.addEventListener(
      "keydown",
      revealSelectedRowActions,
      true,
    );
    return () =>
      editor.view.dom.removeEventListener(
        "keydown",
        revealSelectedRowActions,
        true,
      );
  }, [clearHideTimer, editor, showProximityTarget]);

  useEffect(() => {
    const rowIndex = keyboardFocusRowRef.current;
    if (
      rowIndex === null ||
      proximityTarget?.kind !== "row" ||
      proximityTarget.index !== rowIndex
    ) {
      return;
    }
    const handle = document.querySelector<HTMLButtonElement>(
      `.notion-table-row-handle[aria-label="Drag row ${rowIndex + 1}"]`,
    );
    if (!handle) return;
    keyboardFocusRowRef.current = null;
    handle.focus();
  }, [layout, proximityTarget]);

  useEffect(() => {
    let frame = 0;
    let observedTable: HTMLTableElement | null = null;
    let observedShape = "";
    let horizontalScrollElement: HTMLElement | null = null;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureAndObserve);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (!resizeCleanupRef.current) scheduleUpdate();
    });
    function measureAndObserve() {
      const nextLayout = update();
      const nextTable =
        nextLayout?.rowElements[0]?.closest("table") ?? null;
      const nextShape = nextTable
        ? `${nextTable.rows.length}:${nextTable.rows[0]?.cells.length ?? 0}`
        : "";
      if (nextTable === observedTable && nextShape === observedShape) return;

      resizeObserver.disconnect();
      horizontalScrollElement?.removeEventListener("scroll", scheduleUpdate);
      observedTable = nextTable;
      observedShape = nextShape;
      horizontalScrollElement = null;
      if (!nextTable || !(nextTable instanceof HTMLTableElement)) return;

      horizontalScrollElement = nextTable.closest<HTMLElement>(".tableWrapper");
      horizontalScrollElement?.addEventListener("scroll", scheduleUpdate, {
        passive: true,
      });

      const positioningContainers = new Set<Element>([
        editor.view.dom,
        nextTable,
      ]);
      if (horizontalScrollElement) positioningContainers.add(horizontalScrollElement);
      if (nextTable.offsetParent instanceof Element) {
        positioningContainers.add(nextTable.offsetParent);
      }
      positioningContainers.forEach((element) => resizeObserver.observe(element));
      resizeObserver.observe(nextTable);
      nextLayout?.rowElements.forEach((row) => resizeObserver.observe(row));
      Array.from(nextTable.rows[0]?.cells ?? []).forEach((cell) =>
        resizeObserver.observe(cell),
      );
    }
    const scrollElement = editor.view.dom.closest("[data-editor-scroll]");
    const mutationObserver = new MutationObserver((records) => {
      const tableStructureChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches("table, tr, td, th") ||
              Boolean(node.querySelector("table, tr, td, th"))),
        ),
      );
      if (tableStructureChanged) scheduleUpdate();
    });

    editor.on("selectionUpdate", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    scrollElement?.addEventListener("scroll", scheduleUpdate, { passive: true });
    mutationObserver.observe(editor.view.dom, { childList: true, subtree: true });
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      editor.off("selectionUpdate", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      scrollElement?.removeEventListener("scroll", scheduleUpdate);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      horizontalScrollElement?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [editor, update]);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      dragCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const { selection } = editor.state;
      if (!actionsOpen && !(selection instanceof CellSelection)) return;

      setActionsOpen(false);
      if (!(selection instanceof CellSelection)) return;

      const cellContentStart = selection.$anchorCell.pos + 1;
      editor.view.dispatch(
        editor.state.tr
          .setSelection(
            TextSelection.near(
              editor.state.doc.resolve(cellContentStart),
              1,
            ),
          )
          .scrollIntoView(),
      );
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [actionsOpen, editor]);

  const resizeRow = (
    event: React.PointerEvent<HTMLButtonElement>,
    rowIndex: number,
  ) => {
    if (
      !layout ||
      event.button !== 0 ||
      !event.isPrimary ||
      resizeCleanupRef.current
    ) {
      return;
    }

    const rowElement = layout.rowElements[rowIndex];
    const table = editor.state.doc.nodeAt(layout.tablePos);
    if (!rowElement || !table || rowIndex >= table.childCount) return;

    const zoom = getInterfaceZoom();
    const startY = event.clientY / zoom;
    const startHeight = (layout.rowRects[rowIndex]?.height ?? 28) / zoom;
    const preview = createTableRowResizePreview(rowElement);

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    activeInteractionRef.current = { kind: "rowResize", index: rowIndex };
    showProximityTarget(activeInteractionRef.current);
    const origin = event.currentTarget;
    const pointerId = event.pointerId;
    const ownerDocument = origin.ownerDocument;
    const initialHandleTop = origin.style.top;
    let previewFrame = 0;
    let latestClientY = startY;

    const applyPreview = (clientY: number) => {
      const height = preview.apply(getTableRowResizeHeight(
        startHeight,
        startY,
        clientY,
      ));
      origin.style.top = `${
        layout.rowRects[rowIndex].bottom / zoom + height - startHeight - 8
      }px`;
    };
    const cancelPreviewFrame = () => {
      if (!previewFrame) return;
      cancelAnimationFrame(previewFrame);
      previewFrame = 0;
    };
    const schedulePreview = () => {
      if (previewFrame) return;
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0;
        applyPreview(latestClientY);
      });
    };
    const preventSelectionOrDrag = (interactionEvent: Event) => {
      interactionEvent.preventDefault();
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      latestClientY = moveEvent.clientY / zoom;
      schedulePreview();
    };
    const finishSession = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("selectstart", preventSelectionOrDrag, true);
      window.removeEventListener("dragstart", preventSelectionOrDrag, true);
      cancelPreviewFrame();
      preview.restore();
      editor.view.dom.removeAttribute("data-table-row-resizing");
      ownerDocument.body.classList.remove("notion-table-row-resizing");
      origin.removeAttribute("data-resizing");
      origin.style.top = initialHandleTop;
      if (origin.hasPointerCapture?.(pointerId)) {
        origin.releasePointerCapture(pointerId);
      }
      resizeCleanupRef.current = null;
      activeInteractionRef.current = null;
      resolveLastPointer();
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      upEvent.preventDefault();
      upEvent.stopPropagation();
      latestClientY = upEvent.clientY / zoom;
      cancelPreviewFrame();
      const height = getTableRowResizeHeight(
        startHeight,
        startY,
        latestClientY,
      );
      finishSession();
      setTableRowHeight(editor, layout.tablePos, rowIndex, height);
      requestAnimationFrame(update);
    };
    const onCancel = (cancelEvent?: Event) => {
      if (
        cancelEvent instanceof PointerEvent &&
        cancelEvent.pointerId !== pointerId
      ) {
        return;
      }
      finishSession();
      requestAnimationFrame(update);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      onCancel();
    };

    editor.view.dom.setAttribute("data-table-row-resizing", "true");
    ownerDocument.body.classList.add("notion-table-row-resizing");
    origin.setAttribute("data-resizing", "true");
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("selectstart", preventSelectionOrDrag, true);
    window.addEventListener("dragstart", preventSelectionOrDrag, true);
    resizeCleanupRef.current = () => onCancel();
    try {
      origin.setPointerCapture(pointerId);
    } catch {
      // Window listeners still complete the resize if capture is unavailable.
    }
  };

  const resizeColumn = (
    event: React.PointerEvent<HTMLButtonElement>,
    columnIndex: number,
  ) => {
    if (
      !layout ||
      event.button !== 0 ||
      !event.isPrimary ||
      resizeCleanupRef.current
    ) {
      return;
    }

    const tableElement = layout.rowElements[0]?.closest("table");
    if (!tableElement || columnIndex >= layout.columnRects.length) return;
    const zoom = getInterfaceZoom();
    const baselineWidths = layout.columnRects.map((rect) => rect.width / zoom);
    const preview = createScratchTableColumnResizePreview(
      tableElement,
      baselineWidths,
      columnIndex,
      MIN_TABLE_COLUMN_WIDTH,
    );
    if (!preview) return;

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    activeInteractionRef.current = { kind: "columnResize", index: columnIndex };
    showProximityTarget(activeInteractionRef.current);
    const origin = event.currentTarget;
    const pointerId = event.pointerId;
    const ownerDocument = origin.ownerDocument;
    const startX = event.clientX / zoom;
    const startWidth = baselineWidths[columnIndex];
    const initialHandleLeft = origin.style.left;
    const initialBoundary = layout.columnRects[columnIndex].right / zoom;
    let latestX = startX;
    let previewFrame = 0;

    const applyPreview = (clientX: number): number => {
      const width = preview.apply(startWidth + clientX - startX);
      origin.style.left = `${initialBoundary + width - startWidth - 8}px`;
      return width;
    };
    applyPreview(startX);

    const cancelPreviewFrame = () => {
      if (!previewFrame) return;
      cancelAnimationFrame(previewFrame);
      previewFrame = 0;
    };
    const schedulePreview = () => {
      if (previewFrame) return;
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0;
        applyPreview(latestX);
      });
    };
    const preventSelectionOrDrag = (interactionEvent: Event) => {
      interactionEvent.preventDefault();
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      latestX = moveEvent.clientX / zoom;
      schedulePreview();
    };
    const finishSession = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("selectstart", preventSelectionOrDrag, true);
      window.removeEventListener("dragstart", preventSelectionOrDrag, true);
      cancelPreviewFrame();
      preview.restore();
      editor.view.dom.removeAttribute("data-table-column-resizing");
      ownerDocument.body.classList.remove("notion-table-column-resizing");
      origin.removeAttribute("data-resizing");
      origin.style.left = initialHandleLeft;
      if (origin.hasPointerCapture?.(pointerId)) {
        origin.releasePointerCapture(pointerId);
      }
      resizeCleanupRef.current = null;
      activeInteractionRef.current = null;
      resolveLastPointer();
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      upEvent.preventDefault();
      upEvent.stopPropagation();
      latestX = upEvent.clientX / zoom;
      cancelPreviewFrame();
      const width = applyPreview(latestX);
      const committedWidths = baselineWidths.map((baseline, index) =>
        index === columnIndex ? width : baseline,
      );
      finishSession();
      if (setTableColumnWidths(editor, layout.tablePos, committedWidths)) {
        setAnnouncement(`Column ${columnIndex + 1} resized to ${width}px`);
      }
      requestAnimationFrame(update);
    };
    const onCancel = (cancelEvent?: Event) => {
      if (
        cancelEvent instanceof PointerEvent &&
        cancelEvent.pointerId !== pointerId
      ) {
        return;
      }
      finishSession();
      requestAnimationFrame(update);
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      onCancel();
    };

    editor.view.dom.setAttribute("data-table-column-resizing", "true");
    ownerDocument.body.classList.add("notion-table-column-resizing");
    origin.setAttribute("data-resizing", "true");
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("selectstart", preventSelectionOrDrag, true);
    window.addEventListener("dragstart", preventSelectionOrDrag, true);
    resizeCleanupRef.current = () => onCancel();
    try {
      origin.setPointerCapture(pointerId);
    } catch {
      // Window listeners still complete the resize if capture is unavailable.
    }
  };

  const beginPointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    axis: TableDragAxis,
    sourceIndex: number,
  ) => {
    if (
      !layout ||
      event.button !== 0 ||
      !event.isPrimary ||
      dragCleanupRef.current
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    activeInteractionRef.current = {
      kind: axis,
      index: sourceIndex,
    };
    showProximityTarget(activeInteractionRef.current);
    const origin = event.currentTarget;
    const pointerId = event.pointerId;
    const startPoint = { left: event.clientX, top: event.clientY };
    const initialDoc = editor.state.doc;
    const tablePos = layout.tablePos;
    const currentTable = editor.state.doc.nodeAt(tablePos);
    const indexOffset =
      axis === "row" &&
      currentTable &&
      hasPinnedTableHeaderRow(currentTable)
        ? 1
        : 0;
    if (sourceIndex < indexOffset) return;
    const pointerSourceIndex = sourceIndex - indexOffset;
    let active = false;
    let lastDrop: TablePointerDrop | null = null;
    let latestPoint = startPoint;
    let autoScrollFrame = 0;

    const clearListeners = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      editor.view.dom.removeAttribute("data-table-pointer-dragging");
      if (autoScrollFrame !== 0) {
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = 0;
      }
      setDragIndicator(null);
      if (origin.hasPointerCapture?.(pointerId)) {
        origin.releasePointerCapture(pointerId);
      }
      dragCleanupRef.current = null;
      activeInteractionRef.current = null;
      resolveLastPointer();
    };
    const resolveDropAtPoint = (point: TablePointerPoint) => {
      const tableElement = findTableElement(editor, tablePos);
      const currentLayout = tableElement
        ? measureTableElement(editor, tableElement)
        : null;
      if (!currentLayout) {
        lastDrop = null;
        setDragIndicator(null);
        return;
      }
      const rects =
        axis === "row"
          ? currentLayout.rowRects.slice(indexOffset)
          : currentLayout.columnRects;
      const resolvedDrop = resolveTablePointerDrop(
        rects,
        pointerSourceIndex,
        axis,
        point,
      );
      lastDrop = resolvedDrop
        ? {
            ...resolvedDrop,
            targetIndex: resolvedDrop.targetIndex + indexOffset,
          }
        : null;
      if (!lastDrop) {
        setDragIndicator(null);
        return;
      }

      setDragIndicator(
        axis === "row"
          ? {
              axis,
              left: currentLayout.tableRect.left,
              top: lastDrop.indicatorCoordinate - 1,
              width: currentLayout.tableRect.width,
              height: 3,
            }
          : {
              axis,
              left: lastDrop.indicatorCoordinate - 1,
              top: currentLayout.tableRect.top,
              width: 3,
              height: currentLayout.tableRect.height,
            },
      );
    };
    const continueAutoScroll = () => {
      autoScrollFrame = 0;
      if (!active || !autoScrollTableDrag(editor, axis, latestPoint)) return;
      resolveDropAtPoint(latestPoint);
      autoScrollFrame = requestAnimationFrame(continueAutoScroll);
    };
    const scheduleAutoScroll = () => {
      if (autoScrollFrame !== 0) return;
      if (!autoScrollTableDrag(editor, axis, latestPoint)) return;
      resolveDropAtPoint(latestPoint);
      autoScrollFrame = requestAnimationFrame(continueAutoScroll);
    };
    const updateDrop = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const point = { left: moveEvent.clientX, top: moveEvent.clientY };
      latestPoint = point;
      if (
        !active &&
        hasExceededTablePointerDragThreshold(startPoint, point)
      ) {
        active = true;
        editor.view.dom.setAttribute("data-table-pointer-dragging", axis);
      }
      if (!active) return;

      moveEvent.preventDefault();
      resolveDropAtPoint(point);
      scheduleAutoScroll();
    };
    const onMove = (moveEvent: PointerEvent) => updateDrop(moveEvent);
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      updateDrop(upEvent);
      const drop = lastDrop;
      const shouldMove =
        active && drop !== null && editor.state.doc.eq(initialDoc);
      clearListeners();
      if (!shouldMove) return;

      const moved =
        axis === "row"
          ? moveTableRow(editor, tablePos, sourceIndex, drop.targetIndex)
          : moveTableColumn(editor, tablePos, sourceIndex, drop.targetIndex);
      if (moved) {
        setAnnouncement(
          `${axis === "row" ? "Row" : "Column"} ${sourceIndex + 1} moved to position ${drop.targetIndex + 1}`,
        );
        requestAnimationFrame(update);
      }
    };
    const onCancel = () => clearListeners();
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") clearListeners();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    dragCleanupRef.current = clearListeners;
    try {
      origin.setPointerCapture(pointerId);
    } catch {
      // Window listeners still finish the gesture when capture is unavailable.
    }
  };

  const beginTableEdgeDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    axis: TableEdgeDragAxis,
  ) => {
    if (
      !layout ||
      event.button !== 0 ||
      !event.isPrimary ||
      resizeCleanupRef.current
    ) {
      return;
    }

    const table = editor.state.doc.nodeAt(layout.tablePos);
    if (!table || table.type.name !== "table" || table.childCount === 0) {
      return;
    }
    const itemCount =
      axis === "row" ? table.childCount : table.firstChild?.childCount ?? 0;
    if (itemCount < 1) return;

    event.preventDefault();
    event.stopPropagation();
    clearHideTimer();
    const activeTarget: TableProximityTarget = {
      kind: axis === "row" ? "addRow" : "addColumn",
    };
    activeInteractionRef.current = activeTarget;
    showProximityTarget(activeTarget);

    const origin = event.currentTarget;
    const pointerId = event.pointerId;
    const zoom = getInterfaceZoom();
    const start = {
      left: event.clientX / zoom,
      top: event.clientY / zoom,
    };
    const initialDoc = editor.state.doc;
    const tablePos = layout.tablePos;
    let current = start;

    const finishSession = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      origin.removeAttribute("data-resizing");
      if (origin.hasPointerCapture?.(pointerId)) {
        origin.releasePointerCapture(pointerId);
      }
      resizeCleanupRef.current = null;
      activeInteractionRef.current = null;
      resolveLastPointer();
    };
    const updatePoint = (pointerEvent: PointerEvent) => {
      current = {
        left: pointerEvent.clientX / zoom,
        top: pointerEvent.clientY / zoom,
      };
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      updatePoint(moveEvent);
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      upEvent.preventDefault();
      upEvent.stopPropagation();
      updatePoint(upEvent);
      const delta = resolveTableEdgeDragDelta({
        axis,
        start,
        current,
        itemCount,
      });
      finishSession();
      if (delta === 0 || !editor.state.doc.eq(initialDoc)) return;

      const currentLayout = layoutRef.current;
      if (!currentLayout || currentLayout.tablePos !== tablePos) return;
      if (!applyTableEdgeDelta(editor, currentLayout, axis, delta)) {
        return;
      }

      const unit = axis === "row" ? "row" : "column";
      setAnnouncement(
        `${Math.abs(delta)} ${unit}${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "added" : "removed"}`,
      );
      requestAnimationFrame(update);
    };
    const onCancel = (cancelEvent?: Event) => {
      if (
        cancelEvent instanceof PointerEvent &&
        cancelEvent.pointerId !== pointerId
      ) {
        return;
      }
      finishSession();
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      onCancel();
    };

    origin.setAttribute("data-resizing", "true");
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    resizeCleanupRef.current = () => onCancel();
    try {
      origin.setPointerCapture(pointerId);
    } catch {
      // Window listeners still complete the gesture when capture is unavailable.
    }
  };

  if (!layout || typeof document === "undefined") return null;

  const moveRow = (from: number, to: number) => {
    if (moveTableRow(editor, layout.tablePos, from, to)) {
      setAnnouncement(`Row ${from + 1} moved to position ${to + 1}`);
      requestAnimationFrame(update);
    }
  };
  const moveColumn = (from: number, to: number) => {
    if (moveTableColumn(editor, layout.tablePos, from, to)) {
      setAnnouncement(`Column ${from + 1} moved to position ${to + 1}`);
      requestAnimationFrame(update);
    }
  };
  const openAxisActions = (axis: TableDragAxis, index: number) => {
    if (selectTableAxis(editor, layout, axis, index)) {
      setAnnouncement(
        `${axis === "row" ? "Row" : "Column"} ${index + 1} selected`,
      );
    }
    setActionsOpen(true);
  };
  const tableNode = editor.state.doc.nodeAt(layout.tablePos);
  const hasPinnedHeader = Boolean(
    tableNode && hasPinnedTableHeaderRow(tableNode),
  );
  const hasPinnedHeaderColumn = Boolean(
    tableNode && hasPinnedTableHeaderColumn(tableNode),
  );
  const columnResizeIndex =
    proximityTarget?.kind === "columnResize"
      ? proximityTarget.index
      : null;
  const columnResizeRect =
    columnResizeIndex === null
      ? null
      : layout.columnRects[columnResizeIndex] ?? null;

  return createPortal(
    <div className="notion-table-controls" aria-label="Table controls">
      {actionsOpen && (
        <div
          className="notion-table-actionbar"
          style={{
            left: Math.max(8, viewportValueToInterface(layout.tableRect.left)),
            top: Math.max(
              8,
              viewportValueToInterface(layout.tableRect.top) - 68,
            ),
          }}
        >
        <input
          type="search"
          className="notion-table-action-search"
          aria-label="Search table actions"
          placeholder="Search actions"
          value={actionQuery}
          onChange={(event) => {
            setActionQuery(event.currentTarget.value);
            setColorTarget(null);
          }}
        />
        <span className="notion-table-action-label">Table</span>
        <ActionButton
          label="Fit table to width"
          hidden={!actionMatches("Fit table to width")}
          pressed={tableNode?.attrs.fitToWidth === true}
          onClick={() => {
            if (
              fitTableColumnsToWidth(
                editor,
                layout.tablePos,
                getAvailableTableWidth(editor, layout),
              )
            ) {
              selectTableAxis(editor, layout, "row", layout.rowIndex);
              setAnnouncement("Table fitted to width");
              requestAnimationFrame(update);
            }
          }}
        >
          ↔
        </ActionButton>
        <ActionButton
          label="Toggle header row"
          hidden={!actionMatches("Toggle header row")}
          pressed={hasPinnedHeader}
          onClick={() => {
            if (toggleTableHeaderRow(editor, layout.tablePos)) {
              selectTableAxis(editor, layout, "row", layout.rowIndex);
              setAnnouncement("Header row toggled");
              requestAnimationFrame(update);
            }
          }}
        >
          H↔
        </ActionButton>
        <ActionButton
          label="Toggle header column"
          hidden={!actionMatches("Toggle header column")}
          pressed={hasPinnedHeaderColumn}
          onClick={() => {
            if (toggleTableHeaderColumn(editor, layout.tablePos)) {
              selectTableAxis(editor, layout, "column", layout.columnIndex);
              setAnnouncement("Header column toggled");
              requestAnimationFrame(update);
            }
          }}
        >
          H↕
        </ActionButton>
        <span className="notion-table-action-separator" />
        <span className="notion-table-action-label">Row</span>
        <ActionButton
          label="Move row up"
          hidden={!actionMatches("Move row up")}
          disabled={
            layout.rowIndex === 0 ||
            (hasPinnedHeader && layout.rowIndex === 1)
          }
          onClick={() => moveRow(layout.rowIndex, layout.rowIndex - 1)}
        >
          ↑
        </ActionButton>
        <ActionButton
          label="Move row down"
          hidden={!actionMatches("Move row down")}
          disabled={
            layout.rowIndex >= layout.rowRects.length - 1 ||
            (hasPinnedHeader && layout.rowIndex === 0)
          }
          onClick={() => moveRow(layout.rowIndex, layout.rowIndex + 1)}
        >
          ↓
        </ActionButton>
        <ActionButton
          label="Duplicate row"
          hidden={!actionMatches("Duplicate row")}
          disabled={hasPinnedHeader && layout.rowIndex === 0}
          onClick={() => duplicateTableRow(editor, layout.tablePos, layout.rowIndex)}
        >
          ⧉
        </ActionButton>
        <ActionButton
          label="Clear row contents"
          hidden={!actionMatches("Clear row contents")}
          disabled={hasPinnedHeader && layout.rowIndex === 0}
          onClick={() => {
            if (
              clearTableRow(editor, layout.tablePos, layout.rowIndex)
            ) {
              setAnnouncement(`Row ${layout.rowIndex + 1} cleared`);
              requestAnimationFrame(update);
            }
          }}
        >
          Tx
        </ActionButton>
        <ActionButton
          label="Add row above"
          hidden={!actionMatches("Add row above", "Insert above")}
          onClick={() => {
            if (insertTableRow(editor, layout.tablePos, layout.rowIndex)) {
              selectTableAxis(editor, layout, "row", layout.rowIndex);
              setAnnouncement(`Row added above row ${layout.rowIndex + 1}`);
              requestAnimationFrame(update);
            }
          }}
        >
          <ArrowUpToLineIcon className="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label="Add row below"
          hidden={!actionMatches("Add row below", "Insert below")}
          onClick={() => {
            if (insertTableRow(editor, layout.tablePos, layout.rowIndex + 1)) {
              selectTableAxis(editor, layout, "row", layout.rowIndex + 1);
              setAnnouncement(`Row added below row ${layout.rowIndex + 1}`);
              requestAnimationFrame(update);
            }
          }}
        >
          <ArrowDownToLineIcon className="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label="Set row background"
          hidden={!actionMatches("Set row background", "Color row")}
          onClick={() =>
            setColorTarget((current) => (current === "row" ? null : "row"))
          }
        >
          <span className="notion-table-color-chip" aria-hidden="true" />
        </ActionButton>
        <ActionButton
          label="Delete row"
          hidden={!actionMatches("Delete row")}
          disabled={
            layout.rowRects.length <= 1 ||
            (hasPinnedHeader && layout.rowIndex === 0)
          }
          onClick={() => {
            if (deleteTableRow(editor, layout.tablePos, layout.rowIndex)) {
              selectTableAxis(
                editor,
                layout,
                "row",
                Math.min(layout.rowIndex, layout.rowRects.length - 2),
              );
              requestAnimationFrame(update);
            }
          }}
        >
          −
        </ActionButton>
        <span className="notion-table-action-separator" />
        <span className="notion-table-action-label">Column</span>
        <ActionButton
          label="Move column left"
          hidden={!actionMatches("Move column left")}
          disabled={layout.columnIndex === 0}
          onClick={() => moveColumn(layout.columnIndex, layout.columnIndex - 1)}
        >
          ←
        </ActionButton>
        <ActionButton
          label="Move column right"
          hidden={!actionMatches("Move column right")}
          disabled={layout.columnIndex >= layout.columnRects.length - 1}
          onClick={() => moveColumn(layout.columnIndex, layout.columnIndex + 1)}
        >
          →
        </ActionButton>
        <ActionButton
          label="Duplicate column"
          hidden={!actionMatches("Duplicate column")}
          onClick={() =>
            duplicateTableColumn(editor, layout.tablePos, layout.columnIndex)
          }
        >
          ⧉
        </ActionButton>
        <ActionButton
          label="Clear column contents"
          hidden={!actionMatches("Clear column contents")}
          onClick={() => {
            if (
              clearTableColumn(
                editor,
                layout.tablePos,
                layout.columnIndex,
              )
            ) {
              setAnnouncement(`Column ${layout.columnIndex + 1} cleared`);
              requestAnimationFrame(update);
            }
          }}
        >
          Tx
        </ActionButton>
        <ActionButton
          label="Add column before"
          hidden={!actionMatches("Add column before", "Insert left")}
          onClick={() => {
            if (
              insertTableColumn(editor, layout.tablePos, layout.columnIndex)
            ) {
              selectTableAxis(editor, layout, "column", layout.columnIndex);
              setAnnouncement(
                `Column added before column ${layout.columnIndex + 1}`,
              );
              requestAnimationFrame(update);
            }
          }}
        >
          <ArrowLeftToLineIcon className="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label="Add column after"
          hidden={!actionMatches("Add column after", "Insert right")}
          onClick={() => {
            if (
              insertTableColumn(
                editor,
                layout.tablePos,
                layout.columnIndex + 1,
              )
            ) {
              selectTableAxis(
                editor,
                layout,
                "column",
                layout.columnIndex + 1,
              );
              setAnnouncement(
                `Column added after column ${layout.columnIndex + 1}`,
              );
              requestAnimationFrame(update);
            }
          }}
        >
          <ArrowRightToLineIcon className="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label="Set column background"
          hidden={!actionMatches("Set column background", "Color column")}
          onClick={() =>
            setColorTarget((current) =>
              current === "column" ? null : "column",
            )
          }
        >
          <span className="notion-table-color-chip" aria-hidden="true" />
        </ActionButton>
        <ActionButton
          label="Delete column"
          hidden={!actionMatches("Delete column")}
          disabled={layout.columnRects.length <= 1}
          onClick={() => {
            if (
              deleteTableColumn(editor, layout.tablePos, layout.columnIndex)
            ) {
              selectTableAxis(
                editor,
                layout,
                "column",
                Math.min(layout.columnIndex, layout.columnRects.length - 2),
              );
              requestAnimationFrame(update);
            }
          }}
        >
          −
        </ActionButton>
        {colorTarget && (
          <div
            className="notion-table-color-palette"
            role="group"
            aria-label={`${colorTarget === "row" ? "Row" : "Column"} background colors`}
          >
            {TABLE_BACKGROUND_COLOR_OPTIONS.map((option, index) => {
              const name = TABLE_BACKGROUND_COLOR_NAMES[index];
              return (
                <button
                  key={option.value}
                  type="button"
                  className="notion-table-color-swatch"
                  aria-label={`${name} ${colorTarget} background`}
                  title={name}
                  style={{
                    "--scratch-table-swatch-light": option.light,
                    "--scratch-table-swatch-dark": option.dark,
                  } as React.CSSProperties}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const changed =
                      colorTarget === "row"
                        ? setTableRowBackgroundColor(
                            editor,
                            layout.tablePos,
                            layout.rowIndex,
                            option.value,
                          )
                        : setTableColumnBackgroundColor(
                            editor,
                            layout.tablePos,
                            layout.columnIndex,
                            option.value,
                          );
                    if (changed) {
                      selectTableAxis(
                        editor,
                        layout,
                        colorTarget,
                        colorTarget === "row"
                          ? layout.rowIndex
                          : layout.columnIndex,
                      );
                      setAnnouncement(
                        `${colorTarget === "row" ? "Row" : "Column"} background set to ${name}`,
                      );
                      setColorTarget(null);
                      requestAnimationFrame(update);
                    }
                  }}
                />
              );
            })}
          </div>
        )}
        </div>
      )}

      {layout.rowRects.map((rect, rowIndex) => (
        <div key={`row-${rowIndex}`}>
          {TABLE_STRUCTURE_CONTROLS_VISIBLE &&
            proximityTarget?.kind === "row" &&
            proximityTarget.index === rowIndex && (
              <button
                type="button"
                className={`notion-table-row-handle ${layout.rowIndex === rowIndex ? "is-active" : ""} ${hasPinnedHeader && rowIndex === 0 ? "is-disabled" : ""}`}
                style={{
                  left: viewportValueToInterface(layout.tableRect.left) - 30,
                  top:
                    viewportValueToInterface(rect.top + rect.height / 2) - 14,
                }}
                aria-label={`Drag row ${rowIndex + 1}`}
                aria-disabled={hasPinnedHeader && rowIndex === 0}
                title={
                  hasPinnedHeader && rowIndex === 0
                    ? "Header row is fixed for Markdown"
                    : "Drag row"
                }
                onPointerDown={(event) => {
                  const canStartDrag =
                    editor.state.selection.empty ||
                    editor.state.selection instanceof CellSelection;
                  if (selectTableAxis(editor, layout, "row", rowIndex)) {
                    setAnnouncement(`Row ${rowIndex + 1} selected`);
                  }
                  if (canStartDrag && !(hasPinnedHeader && rowIndex === 0)) {
                    beginPointerDrag(event, "row", rowIndex);
                  }
                }}
                onClick={() => openAxisActions("row", rowIndex)}
              >
                ⠿
              </button>
            )}
          {proximityTarget?.kind === "rowResize" &&
            proximityTarget.index === rowIndex && (
              <button
                type="button"
                className="notion-table-row-resize"
                style={{
                  left: viewportValueToInterface(layout.tableRect.left),
                  top: viewportValueToInterface(rect.bottom) - 8,
                  width: viewportValueToInterface(layout.tableRect.width),
                }}
                aria-label={`Resize row ${rowIndex + 1}`}
                title="Resize row"
                onPointerDown={(event) => resizeRow(event, rowIndex)}
              />
            )}
        </div>
      ))}

      {TABLE_STRUCTURE_CONTROLS_VISIBLE &&
        proximityTarget?.kind === "column" &&
        layout.columnRects.map((rect, columnIndex) =>
          proximityTarget.index === columnIndex ? (
            <button
              type="button"
              key={`column-${columnIndex}`}
              className={`notion-table-column-handle ${layout.columnIndex === columnIndex ? "is-active" : ""}`}
              style={{
                left:
                  viewportValueToInterface(rect.left + rect.width / 2) - 14,
                top: viewportValueToInterface(layout.tableRect.top) - 30,
              }}
              aria-label={`Drag column ${columnIndex + 1}`}
              title="Drag column; resize from the cell edge"
              onPointerDown={(event) => {
                const canStartDrag =
                  editor.state.selection.empty ||
                  editor.state.selection instanceof CellSelection;
                if (
                  selectTableAxis(editor, layout, "column", columnIndex)
                ) {
                  setAnnouncement(`Column ${columnIndex + 1} selected`);
                }
                if (canStartDrag) {
                  beginPointerDrag(event, "column", columnIndex);
                }
              }}
              onClick={() => openAxisActions("column", columnIndex)}
            >
              ⠿
            </button>
          ) : null,
        )}

      {columnResizeIndex !== null && columnResizeRect && (
        <button
          type="button"
          className="notion-table-column-resize"
          style={{
            left:
              viewportValueToInterface(columnResizeRect.right) - 8,
            top: viewportValueToInterface(layout.tableRect.top),
            height: viewportValueToInterface(layout.tableRect.height),
          }}
          aria-label={`Resize column ${columnResizeIndex + 1}`}
          title="Resize column"
          onMouseDown={(mouseEvent) => {
            mouseEvent.preventDefault();
            mouseEvent.stopPropagation();
          }}
          onPointerDown={(pointerEvent) =>
            resizeColumn(pointerEvent, columnResizeIndex)
          }
        />
      )}

      {TABLE_STRUCTURE_CONTROLS_VISIBLE && proximityTarget?.kind === "addRow" && (
        <>
          <button
            type="button"
            className="notion-table-add-control notion-table-add-row"
            style={{
              left:
                viewportValueToInterface(
                  layout.tableRect.left + layout.tableRect.width / 2,
                ) - 32,
              top: viewportValueToInterface(layout.tableRect.bottom) + 4,
            }}
            aria-label="Add row at bottom"
            title="Add row"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (resizeTableAtEnd(editor, layout.tablePos, "row", 1)) {
                requestAnimationFrame(update);
              }
            }}
          >
            +
          </button>
          <button
            type="button"
            className="notion-table-edge-resize is-row"
            style={{
              left:
                viewportValueToInterface(
                  layout.tableRect.left + layout.tableRect.width / 2,
                ) + 4,
              top: viewportValueToInterface(layout.tableRect.bottom) + 4,
            }}
            aria-label="Resize table rows"
            title="Drag to add or remove rows"
            onPointerDown={(event) => beginTableEdgeDrag(event, "row")}
          />
        </>
      )}

      {TABLE_STRUCTURE_CONTROLS_VISIBLE &&
        proximityTarget?.kind === "addColumn" && (
        <>
          <button
            type="button"
            className="notion-table-add-control notion-table-add-column"
            style={{
              left: viewportValueToInterface(layout.tableRect.right) + 4,
              top:
                viewportValueToInterface(
                  layout.tableRect.top + layout.tableRect.height / 2,
                ) - 32,
            }}
            aria-label="Add column at right"
            title="Add column"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (resizeTableAtEnd(editor, layout.tablePos, "column", 1)) {
                requestAnimationFrame(update);
              }
            }}
          >
            +
          </button>
          <button
            type="button"
            className="notion-table-edge-resize is-column"
            style={{
              left: viewportValueToInterface(layout.tableRect.right) + 4,
              top:
                viewportValueToInterface(
                  layout.tableRect.top + layout.tableRect.height / 2,
                ) + 4,
            }}
            aria-label="Resize table columns"
            title="Drag to add or remove columns"
            onPointerDown={(event) => beginTableEdgeDrag(event, "column")}
          />
        </>
      )}

      {dragIndicator && (
        <div
          className={`notion-table-drop-indicator is-${dragIndicator.axis}`}
          aria-hidden="true"
          style={{
            left: viewportValueToInterface(dragIndicator.left),
            top: viewportValueToInterface(dragIndicator.top),
            width: viewportValueToInterface(dragIndicator.width),
            height: viewportValueToInterface(dragIndicator.height),
          }}
        />
      )}
      <div className="notion-table-announcement" aria-live="polite">
        {announcement}
      </div>
    </div>,
    document.body,
  );
}
