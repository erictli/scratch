import {
  MIN_TABLE_ROW_HEIGHT,
  normalizeTableRowHeight as normalizeStoredTableRowHeight,
} from "./tableExtensions";

const ROW_RESIZE_PREVIEW_ATTRIBUTE = "data-scratch-row-resize-preview-id";
let nextRowResizePreviewId = 0;

export interface TableRowResizePreview {
  apply: (requestedHeight: number) => number;
  restore: () => void;
}

function normalizeTableRowHeight(height: number): number {
  return normalizeStoredTableRowHeight(height) ?? MIN_TABLE_ROW_HEIGHT;
}

/**
 * Applies row-height feedback without dispatching a ProseMirror transaction.
 * Keeping the editor document unchanged during pointer movement prevents the
 * row DOM from being replaced underneath the active pointer/portal geometry.
 */
export function createTableRowResizePreview(
  row: HTMLTableRowElement,
  resolveCurrentRow: () => HTMLTableRowElement | null = () => row,
): TableRowResizePreview {
  const ownerDocument = row.ownerDocument;
  const previewId = `scratch-row-${++nextRowResizePreviewId}`;
  const selector = `[${ROW_RESIZE_PREVIEW_ATTRIBUTE}="${previewId}"]`;
  let targetRow = row;
  let previousPreviewId = row.getAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE);

  const restoreTargetAttribute = () => {
    if (previousPreviewId === null) {
      targetRow.removeAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE);
    } else {
      targetRow.setAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE, previousPreviewId);
    }
  };
  const synchronizeTargetRow = () => {
    const currentRow = resolveCurrentRow();
    if (!currentRow || currentRow === targetRow) return;
    restoreTargetAttribute();
    targetRow = currentRow;
    previousPreviewId = targetRow.getAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE);
    targetRow.setAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE, previewId);
  };
  targetRow.setAttribute(ROW_RESIZE_PREVIEW_ATTRIBUTE, previewId);
  const styleElement = ownerDocument.createElement("style");
  styleElement.setAttribute("data-scratch-table-row-resize-preview", "true");
  styleElement.textContent = `${selector} {}`;
  ownerDocument.head.append(styleElement);
  const ownerWindow = ownerDocument.defaultView;
  let synchronizationFrame = 0;
  let synchronizationFramesRemaining = 0;
  const scheduleTargetSynchronization = () => {
    if (!ownerWindow) return;
    synchronizationFramesRemaining = Math.max(
      synchronizationFramesRemaining,
      3,
    );
    if (synchronizationFrame !== 0) return;
    const synchronizeOnFrame = () => {
      synchronizationFrame = 0;
      synchronizeTargetRow();
      synchronizationFramesRemaining -= 1;
      if (synchronizationFramesRemaining > 0) {
        synchronizationFrame = ownerWindow.requestAnimationFrame(
          synchronizeOnFrame,
        );
      }
    };
    synchronizationFrame = ownerWindow.requestAnimationFrame(
      synchronizeOnFrame,
    );
  };
  scheduleTargetSynchronization();

  const rule = styleElement.sheet?.cssRules[0];
  const styleRule = rule instanceof CSSStyleRule ? rule : null;

  return {
    apply(requestedHeight) {
      synchronizeTargetRow();
      scheduleTargetSynchronization();
      const height = normalizeTableRowHeight(requestedHeight);
      if (styleRule) {
        styleRule.style.setProperty("height", `${height}px`, "important");
      } else {
        styleElement.textContent = `${selector} { height: ${height}px !important; }`;
      }
      return height;
    },
    restore() {
      if (ownerWindow && synchronizationFrame !== 0) {
        ownerWindow.cancelAnimationFrame(synchronizationFrame);
        synchronizationFrame = 0;
      }
      synchronizationFramesRemaining = 0;
      styleElement.remove();
      restoreTargetAttribute();
    },
  };
}

export function getTableRowResizeHeight(
  startHeight: number,
  startY: number,
  currentY: number,
): number {
  return normalizeTableRowHeight(startHeight + currentY - startY);
}
