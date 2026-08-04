import {
  MAX_TABLE_ROW_HEIGHT,
  MIN_TABLE_ROW_HEIGHT,
} from "./tableExtensions";

export interface TableRowResizePreview {
  apply: (requestedHeight: number) => number;
  restore: () => void;
}

function normalizeTableRowHeight(height: number): number {
  return Math.round(
    Math.min(
      MAX_TABLE_ROW_HEIGHT,
      Math.max(MIN_TABLE_ROW_HEIGHT, Number.isFinite(height) ? height : MIN_TABLE_ROW_HEIGHT),
    ),
  );
}

function getExactElementSelector(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    const parentElement: Element | null = current.parentElement;
    const siblingIndex = parentElement
      ? Array.prototype.indexOf.call(parentElement.children, current) + 1
      : 1;
    segments.unshift(
      `${current.tagName.toLowerCase()}:nth-child(${siblingIndex})`,
    );
    current = parentElement;
  }

  return segments.join(" > ");
}

/**
 * Applies row-height feedback without dispatching a ProseMirror transaction.
 * Keeping the editor document unchanged during pointer movement prevents the
 * row DOM from being replaced underneath the active pointer/portal geometry.
 */
export function createTableRowResizePreview(
  row: HTMLTableRowElement,
): TableRowResizePreview {
  const ownerDocument = row.ownerDocument;
  const styleElement = ownerDocument.createElement("style");
  styleElement.setAttribute("data-scratch-table-row-resize-preview", "true");
  styleElement.textContent = `${getExactElementSelector(row)} {}`;
  ownerDocument.head.append(styleElement);

  const rule = styleElement.sheet?.cssRules[0];
  const styleRule = rule instanceof CSSStyleRule ? rule : null;

  return {
    apply(requestedHeight) {
      const height = normalizeTableRowHeight(requestedHeight);
      if (styleRule) {
        styleRule.style.setProperty("height", `${height}px`, "important");
      } else {
        styleElement.textContent = `${getExactElementSelector(row)} { height: ${height}px !important; }`;
      }
      return height;
    },
    restore() {
      styleElement.remove();
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
