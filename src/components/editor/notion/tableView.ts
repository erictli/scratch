import { TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { normalizeTableColumnWidth } from "./tableMetadata";

export interface ScratchTableColumnResizePreview {
  apply: (width: number) => number;
  restore: () => void;
}

function restoreAttribute(
  element: Element,
  name: string,
  value: string | null,
): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function createScratchTableColumnResizePreview(
  table: HTMLTableElement,
  baselineWidths: readonly number[],
  columnIndex: number,
  minimumWidth: number,
): ScratchTableColumnResizePreview | null {
  const colgroup = table.querySelector(":scope > colgroup");
  if (
    !(colgroup instanceof HTMLTableColElement) ||
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= baselineWidths.length ||
    !Number.isFinite(minimumWidth) ||
    minimumWidth <= 0
  ) {
    return null;
  }

  const normalizedBaseline = baselineWidths.map((width) => {
    const parsed = Number(width);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  if (normalizedBaseline.some((width) => width === null)) return null;

  const appendedColumns: HTMLTableColElement[] = [];
  while (colgroup.children.length < normalizedBaseline.length) {
    const appended = colgroup.ownerDocument.createElement("col");
    appendedColumns.push(appended);
    colgroup.appendChild(appended);
  }
  const columns = Array.from(colgroup.children).slice(
    0,
    normalizedBaseline.length,
  ) as HTMLTableColElement[];
  const tableStyle = table.getAttribute("style");
  const fitToWidth = table.getAttribute("data-fit-to-width");
  const resizing = table.getAttribute("data-column-resizing");
  const columnStyles = columns.map((column) => column.getAttribute("style"));
  let restored = false;

  const apply = (requestedWidth: number): number => {
    const normalized = normalizeTableColumnWidth(
      Math.max(minimumWidth, requestedWidth),
    );
    const width = normalized ?? minimumWidth;
    if (restored) return width;
    const nextWidths = normalizedBaseline.map((baseline, index) =>
      index === columnIndex ? width : baseline!,
    );

    table.removeAttribute("data-fit-to-width");
    table.setAttribute("data-column-resizing", "true");
    columns.forEach((column, index) => {
      column.style.removeProperty("min-width");
      column.style.width = `${nextWidths[index]}px`;
    });
    const totalWidth = nextWidths.reduce((total, value) => total + value, 0);
    table.style.setProperty("width", `${totalWidth}px`, "important");
    table.style.setProperty("min-width", `${totalWidth}px`, "important");
    table.style.setProperty("max-width", "none", "important");
    return width;
  };

  return {
    apply,
    restore() {
      if (restored) return;
      restored = true;
      restoreAttribute(table, "style", tableStyle);
      restoreAttribute(table, "data-fit-to-width", fitToWidth);
      restoreAttribute(table, "data-column-resizing", resizing);
      columns.forEach((column, index) =>
        restoreAttribute(column, "style", columnStyles[index]),
      );
      appendedColumns.forEach((column) => column.remove());
    },
  };
}

function setColumnStyle(
  column: HTMLTableColElement,
  minimumWidth: number,
  width: number | null,
) {
  if (width) {
    column.style.removeProperty("min-width");
    column.style.width = `${Math.max(width, minimumWidth)}px`;
    return;
  }

  // TipTap 3.29.2 sets min-width here but leaves a previous width in place.
  // Undo then changes the document while the rendered column stays enlarged.
  column.style.removeProperty("width");
  column.style.minWidth = `${minimumWidth}px`;
}

export function updateScratchTableColumns(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  cellMinWidth: number,
) {
  const firstRow = node.firstChild;
  let nextColumn = colgroup.firstElementChild as HTMLTableColElement | null;

  if (node.attrs.fitToWidth === true && firstRow) {
    const columnCount = Array.from(
      { length: firstRow.childCount },
      (_, index) => Math.max(1, Number(firstRow.child(index).attrs.colspan) || 1),
    ).reduce((total, colspan) => total + colspan, 0);
    const width = `${100 / columnCount}%`;

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      if (!nextColumn) {
        nextColumn = colgroup.ownerDocument.createElement("col");
        colgroup.appendChild(nextColumn);
      }
      nextColumn.style.removeProperty("min-width");
      nextColumn.style.width = width;
      nextColumn = nextColumn.nextElementSibling as HTMLTableColElement | null;
    }

    while (nextColumn) {
      const followingColumn =
        nextColumn.nextElementSibling as HTMLTableColElement | null;
      nextColumn.remove();
      nextColumn = followingColumn;
    }

    table.dataset.fitToWidth = "true";
    table.style.width = "100%";
    table.style.minWidth = "";
    return;
  }

  delete table.dataset.fitToWidth;
  let totalWidth = 0;
  let fixedWidth = true;

  if (firstRow) {
    for (let cellIndex = 0; cellIndex < firstRow.childCount; cellIndex += 1) {
      const cell = firstRow.child(cellIndex);
      const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);
      const widths = Array.isArray(cell.attrs.colwidth)
        ? cell.attrs.colwidth
        : [];

      for (let offset = 0; offset < colspan; offset += 1) {
        const storedWidth = Number(widths[offset] ?? 0);
        const width = Number.isFinite(storedWidth) && storedWidth > 0
          ? storedWidth
          : null;
        totalWidth += width ?? cellMinWidth;
        if (!width) fixedWidth = false;

        if (!nextColumn) {
          nextColumn = colgroup.ownerDocument.createElement("col");
          colgroup.appendChild(nextColumn);
        }
        setColumnStyle(nextColumn, cellMinWidth, width);
        nextColumn = nextColumn.nextElementSibling as HTMLTableColElement | null;
      }
    }
  }

  while (nextColumn) {
    const followingColumn =
      nextColumn.nextElementSibling as HTMLTableColElement | null;
    nextColumn.remove();
    nextColumn = followingColumn;
  }

  const hasUserWidth =
    typeof node.attrs.style === "string" && /\bwidth\s*:/i.test(node.attrs.style);
  if (fixedWidth && !hasUserWidth) {
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = "";
  } else {
    table.style.width = "";
    table.style.minWidth = `${totalWidth}px`;
  }
}

export class ScratchTableView extends TableView {
  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    super(node, cellMinWidth, view, HTMLAttributes);
    updateScratchTableColumns(
      node,
      this.colgroup,
      this.table,
      this.cellMinWidth,
    );
  }

  override update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateScratchTableColumns(
      node,
      this.colgroup,
      this.table,
      this.cellMinWidth,
    );
    return true;
  }
}
