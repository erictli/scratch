import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { normalizeTableRowHeight } from "./tableExtensions";
import {
  MIN_TABLE_COLUMN_WIDTH,
  normalizeTableBackgroundColor,
  normalizeTableColumnWidth,
} from "./tableMetadata";

interface TableCellTarget {
  rowIndex: number;
  columnIndex: number;
}

function getTable(editor: Editor, tablePos: number): ProseMirrorNode | null {
  if (
    !Number.isInteger(tablePos) ||
    tablePos < 0 ||
    tablePos >= editor.state.doc.content.size
  ) {
    return null;
  }
  const node = editor.state.doc.nodeAt(tablePos);
  return node?.type.name === "table" ? node : null;
}

function isValidIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function replaceTable(
  editor: Editor,
  tablePos: number,
  table: ProseMirrorNode,
  replacement: ProseMirrorNode,
  target: TableCellTarget,
): boolean {
  if (replacement.eq(table)) return false;

  const transaction = closeHistory(
    editor.state.tr.replaceWith(
      tablePos,
      tablePos + table.nodeSize,
      replacement,
    ),
  );
  const position = tableCellTextPosition(tablePos, replacement, target);
  if (position !== null) {
    transaction.setSelection(
      TextSelection.near(transaction.doc.resolve(position), 1),
    );
  }
  editor.view.dispatch(transaction);
  return true;
}

function activeTableCell(editor: Editor, tablePos: number): TableCellTarget {
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

  if (
    tableDepth < 0 ||
    rowDepth < 0 ||
    $anchor.before(tableDepth) !== tablePos
  ) {
    return { rowIndex: 0, columnIndex: 0 };
  }

  return {
    rowIndex: $anchor.index(tableDepth),
    columnIndex: $anchor.index(rowDepth),
  };
}

function tableCellTextPosition(
  tablePos: number,
  table: ProseMirrorNode,
  target: TableCellTarget,
): number | null {
  if (!isValidIndex(target.rowIndex, table.childCount)) return null;
  const row = table.child(target.rowIndex);
  if (!isValidIndex(target.columnIndex, row.childCount)) return null;

  let position = tablePos + 1;
  for (let index = 0; index < target.rowIndex; index += 1) {
    position += table.child(index).nodeSize;
  }
  position += 1;
  for (let index = 0; index < target.columnIndex; index += 1) {
    position += row.child(index).nodeSize;
  }
  position += 1;

  const firstChild = row.child(target.columnIndex).firstChild;
  if (firstChild?.isTextblock) position += 1;
  return position;
}

function reordered<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  return result;
}

function rowsOf(table: ProseMirrorNode): ProseMirrorNode[] {
  return Array.from({ length: table.childCount }, (_, index) =>
    table.child(index),
  );
}

function cellsOf(row: ProseMirrorNode): ProseMirrorNode[] {
  return Array.from({ length: row.childCount }, (_, index) => row.child(index));
}

function hasSimpleRectangularCells(table: ProseMirrorNode): boolean {
  if (table.childCount === 0) return false;
  const columnCount = table.child(0).childCount;
  if (columnCount === 0) return false;

  return rowsOf(table).every(
    (row) =>
      row.childCount === columnCount &&
      cellsOf(row).every(
        (cell) =>
          Number(cell.attrs.colspan ?? 1) === 1 &&
          Number(cell.attrs.rowspan ?? 1) === 1,
      ),
  );
}

function hasNoMergedCells(table: ProseMirrorNode): boolean {
  return rowsOf(table).every((row) =>
    cellsOf(row).every(
      (cell) =>
        Number(cell.attrs.colspan ?? 1) === 1 &&
        Number(cell.attrs.rowspan ?? 1) === 1,
    ),
  );
}

export function hasPinnedTableHeaderRow(table: ProseMirrorNode): boolean {
  if (table.childCount === 0) return false;
  const firstRow = table.child(0);
  return (
    firstRow.childCount > 0 &&
    cellsOf(firstRow).every((cell) => cell.type.name === "tableHeader")
  );
}

function recreateRow(
  row: ProseMirrorNode,
  cells: ProseMirrorNode[],
): ProseMirrorNode {
  return row.type.create(row.attrs, Fragment.fromArray(cells), row.marks);
}

function recreateTable(
  table: ProseMirrorNode,
  rows: ProseMirrorNode[],
  attrs: ProseMirrorNode["attrs"] = table.attrs,
): ProseMirrorNode {
  return table.type.create(attrs, Fragment.fromArray(rows), table.marks);
}

function hasTableHeaderColumn(table: ProseMirrorNode): boolean {
  return (
    table.childCount > 0 &&
    rowsOf(table).every(
      (row) =>
        row.childCount > 0 && row.child(0).type.name === "tableHeader",
    )
  );
}

function resolvedTableHeaderColumn(table: ProseMirrorNode): boolean {
  if (typeof table.attrs.headerColumn === "boolean") {
    return table.attrs.headerColumn;
  }
  // With a single Markdown header row, cell types alone cannot distinguish a
  // header column from the row header. Default to no header column until the
  // user explicitly enables it.
  return table.childCount > 1 && hasTableHeaderColumn(table);
}

export function hasPinnedTableHeaderColumn(table: ProseMirrorNode): boolean {
  return resolvedTableHeaderColumn(table);
}

function recreateTableHeaders(
  table: ProseMirrorNode,
  headerRow: boolean,
  headerColumn: boolean,
): ProseMirrorNode | null {
  const tableHeader = table.type.schema.nodes.tableHeader;
  const tableCell = table.type.schema.nodes.tableCell;
  if (!tableHeader || !tableCell) return null;

  const rows = rowsOf(table).map((row, rowIndex) =>
    recreateRow(
      row,
      cellsOf(row).map((cell, columnIndex) => {
        const type =
          (headerRow && rowIndex === 0) ||
          (headerColumn && columnIndex === 0)
            ? tableHeader
            : tableCell;
        return type === cell.type
          ? cell
          : type.create(cell.attrs, cell.content, cell.marks);
      }),
    ),
  );

  return recreateTable(table, rows, {
    ...table.attrs,
    headerRow,
    headerColumn,
  });
}

function recreateTableWithStructuralHeaders(
  table: ProseMirrorNode,
  rows: ProseMirrorNode[],
): ProseMirrorNode {
  const candidate = recreateTable(table, rows);
  const headerRow =
    typeof table.attrs.headerRow === "boolean"
      ? table.attrs.headerRow
      : hasPinnedTableHeaderRow(table);
  return (
    recreateTableHeaders(
      candidate,
      headerRow,
      resolvedTableHeaderColumn(table),
    ) ?? candidate
  );
}

export function toggleTableHeaderRow(
  editor: Editor,
  tablePos: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const nextHeaderRow = !hasPinnedTableHeaderRow(table);
  const headerColumn = resolvedTableHeaderColumn(table);
  const replacement = recreateTableHeaders(
    table,
    nextHeaderRow,
    headerColumn,
  );
  if (!replacement) return false;

  return replaceTable(
    editor,
    tablePos,
    table,
    replacement,
    activeTableCell(editor, tablePos),
  );
}

export function toggleTableHeaderColumn(
  editor: Editor,
  tablePos: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const headerRow =
    typeof table.attrs.headerRow === "boolean"
      ? table.attrs.headerRow
      : hasPinnedTableHeaderRow(table);
  const nextHeaderColumn = !resolvedTableHeaderColumn(table);
  const replacement = recreateTableHeaders(
    table,
    headerRow,
    nextHeaderColumn,
  );
  if (!replacement) return false;

  return replaceTable(
    editor,
    tablePos,
    table,
    replacement,
    activeTableCell(editor, tablePos),
  );
}

function setCellBackgroundColor(
  cell: ProseMirrorNode,
  backgroundColor: string | null,
): ProseMirrorNode {
  return cell.type.create(
    { ...cell.attrs, backgroundColor },
    cell.content,
    cell.marks,
  );
}

function validatedTableBackgroundColor(value: unknown): string | null | false {
  if (value === null) return null;
  return normalizeTableBackgroundColor(value) ?? false;
}

export function setTableRowBackgroundColor(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  value: unknown,
): boolean {
  const table = getTable(editor, tablePos);
  const backgroundColor = validatedTableBackgroundColor(value);
  if (
    !table ||
    backgroundColor === false ||
    !hasNoMergedCells(table) ||
    !isValidIndex(rowIndex, table.childCount)
  ) {
    return false;
  }

  const rows = rowsOf(table);
  const row = rows[rowIndex];
  rows[rowIndex] = recreateRow(
    row,
    cellsOf(row).map((cell) =>
      setCellBackgroundColor(cell, backgroundColor),
    ),
  );
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows),
    { rowIndex, columnIndex: activeTableCell(editor, tablePos).columnIndex },
  );
}

export function setTableColumnBackgroundColor(
  editor: Editor,
  tablePos: number,
  columnIndex: number,
  value: unknown,
): boolean {
  const table = getTable(editor, tablePos);
  const backgroundColor = validatedTableBackgroundColor(value);
  if (!table || backgroundColor === false || !hasSimpleRectangularCells(table)) {
    return false;
  }
  const columnCount = table.child(0).childCount;
  if (!isValidIndex(columnIndex, columnCount)) return false;

  const rows = rowsOf(table).map((row) => {
    const cells = cellsOf(row);
    cells[columnIndex] = setCellBackgroundColor(
      cells[columnIndex],
      backgroundColor,
    );
    return recreateRow(row, cells);
  });
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows),
    { rowIndex: activeTableCell(editor, tablePos).rowIndex, columnIndex },
  );
}

export function moveTableRow(
  editor: Editor,
  tablePos: number,
  fromIndex: number,
  toIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasNoMergedCells(table) ||
    !isValidIndex(fromIndex, table.childCount) ||
    !isValidIndex(toIndex, table.childCount) ||
    fromIndex === toIndex ||
    (hasPinnedTableHeaderRow(table) && (fromIndex === 0 || toIndex === 0))
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, reordered(rowsOf(table), fromIndex, toIndex)),
    { rowIndex: toIndex, columnIndex: activeCell.columnIndex },
  );
}

export function duplicateTableRow(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasNoMergedCells(table) ||
    !isValidIndex(rowIndex, table.childCount) ||
    (hasPinnedTableHeaderRow(table) && rowIndex === 0)
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table);
  rows.splice(rowIndex + 1, 0, rows[rowIndex]);
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows),
    { rowIndex: rowIndex + 1, columnIndex: activeCell.columnIndex },
  );
}

export function moveTableColumn(
  editor: Editor,
  tablePos: number,
  fromIndex: number,
  toIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const columnCount = table.child(0).childCount;
  if (
    !isValidIndex(fromIndex, columnCount) ||
    !isValidIndex(toIndex, columnCount) ||
    fromIndex === toIndex
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) =>
    recreateRow(row, reordered(cellsOf(row), fromIndex, toIndex)),
  );
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    { rowIndex: activeCell.rowIndex, columnIndex: toIndex },
  );
}

export function duplicateTableColumn(
  editor: Editor,
  tablePos: number,
  columnIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const columnCount = table.child(0).childCount;
  if (!isValidIndex(columnIndex, columnCount)) return false;

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) => {
    const cells = cellsOf(row);
    cells.splice(columnIndex + 1, 0, cells[columnIndex]);
    return recreateRow(row, cells);
  });
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    { rowIndex: activeCell.rowIndex, columnIndex: columnIndex + 1 },
  );
}

function emptyInsertedColumnCell(cell: ProseMirrorNode): ProseMirrorNode {
  const normalized = cell.type.create(
    {
      ...cell.attrs,
      colspan: 1,
      rowspan: 1,
      colwidth: null,
      backgroundColor: null,
    },
    cell.content,
    cell.marks,
  );
  return emptyTableCell(normalized);
}

export function insertTableColumn(
  editor: Editor,
  tablePos: number,
  columnIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const columnCount = table.child(0).childCount;
  if (
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex > columnCount
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) => {
    const cells = cellsOf(row);
    const template = cells[Math.min(columnIndex, cells.length - 1)];
    cells.splice(columnIndex, 0, emptyInsertedColumnCell(template));
    return recreateRow(row, cells);
  });
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    { rowIndex: activeCell.rowIndex, columnIndex },
  );
}

export function deleteTableColumn(
  editor: Editor,
  tablePos: number,
  columnIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const columnCount = table.child(0).childCount;
  if (columnCount <= 1 || !isValidIndex(columnIndex, columnCount)) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) => {
    const cells = cellsOf(row);
    cells.splice(columnIndex, 1);
    return recreateRow(row, cells);
  });
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    {
      rowIndex: activeCell.rowIndex,
      columnIndex: Math.min(columnIndex, columnCount - 2),
    },
  );
}

function emptyInsertedRowCell(cell: ProseMirrorNode): ProseMirrorNode {
  const normalized = cell.type.create(
    { ...cell.attrs, backgroundColor: null },
    cell.content,
    cell.marks,
  );
  return emptyTableCell(normalized);
}

function emptyInsertedRow(row: ProseMirrorNode): ProseMirrorNode {
  return row.type.create(
    { ...row.attrs, rowHeight: null },
    Fragment.fromArray(cellsOf(row).map(emptyInsertedRowCell)),
    row.marks,
  );
}

export function insertTableRow(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;
  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex > table.childCount ||
    (hasPinnedTableHeaderRow(table) && rowIndex === 0)
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table);
  const template = rows[Math.min(rowIndex, rows.length - 1)];
  rows.splice(rowIndex, 0, emptyInsertedRow(template));
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    {
      rowIndex,
      columnIndex: Math.min(
        activeCell.columnIndex,
        rows[rowIndex].childCount - 1,
      ),
    },
  );
}

export function deleteTableRow(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasSimpleRectangularCells(table) ||
    table.childCount <= 1 ||
    !isValidIndex(rowIndex, table.childCount) ||
    (hasPinnedTableHeaderRow(table) && rowIndex === 0)
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table);
  rows.splice(rowIndex, 1);
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    {
      rowIndex: Math.min(rowIndex, rows.length - 1),
      columnIndex: Math.min(
        activeCell.columnIndex,
        rows[Math.min(rowIndex, rows.length - 1)].childCount - 1,
      ),
    },
  );
}

export function resizeTableAtEnd(
  editor: Editor,
  tablePos: number,
  axis: "row" | "column",
  delta: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasSimpleRectangularCells(table) ||
    !Number.isInteger(delta) ||
    delta === 0
  ) {
    return false;
  }

  const rowCount = table.childCount;
  const columnCount = table.child(0).childCount;
  const currentCount = axis === "row" ? rowCount : columnCount;
  const nextCount = currentCount + delta;
  if (nextCount < 1) return false;

  let rows = rowsOf(table);
  if (axis === "row") {
    if (delta > 0) {
      const template = rows[rows.length - 1];
      for (let index = 0; index < delta; index += 1) {
        rows.push(emptyInsertedRow(template));
      }
    } else {
      rows = rows.slice(0, nextCount);
    }
  } else {
    rows = rows.map((row) => {
      const cells = cellsOf(row);
      if (delta > 0) {
        const template = cells[cells.length - 1];
        for (let index = 0; index < delta; index += 1) {
          cells.push(emptyInsertedColumnCell(template));
        }
      } else {
        cells.splice(nextCount);
      }
      return recreateRow(row, cells);
    });
  }

  const activeCell = activeTableCell(editor, tablePos);
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTableWithStructuralHeaders(table, rows),
    {
      rowIndex:
        axis === "row"
          ? nextCount - 1
          : Math.min(activeCell.rowIndex, rows.length - 1),
      columnIndex:
        axis === "column"
          ? nextCount - 1
          : Math.min(activeCell.columnIndex, rows[0].childCount - 1),
    },
  );
}

function emptyTableCell(cell: ProseMirrorNode): ProseMirrorNode {
  const paragraph = cell.type.schema.nodes.paragraph?.create();
  if (!paragraph) return cell;
  return cell.type.create(cell.attrs, [paragraph], cell.marks);
}

export function clearTableRow(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasNoMergedCells(table) ||
    !isValidIndex(rowIndex, table.childCount)
  ) {
    return false;
  }

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table);
  const row = rows[rowIndex];
  rows[rowIndex] = recreateRow(row, cellsOf(row).map(emptyTableCell));
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows),
    {
      rowIndex,
      columnIndex: Math.min(activeCell.columnIndex, row.childCount - 1),
    },
  );
}

export function clearTableColumn(
  editor: Editor,
  tablePos: number,
  columnIndex: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;
  const columnCount = table.child(0).childCount;
  if (!isValidIndex(columnIndex, columnCount)) return false;

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) => {
    const cells = cellsOf(row);
    cells[columnIndex] = emptyTableCell(cells[columnIndex]);
    return recreateRow(row, cells);
  });
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows),
    {
      rowIndex: activeCell.rowIndex,
      columnIndex,
    },
  );
}

export function fitTableColumnsToWidth(
  editor: Editor,
  tablePos: number,
  availableWidth: number,
): boolean {
  const table = getTable(editor, tablePos);
  if (
    !table ||
    !hasSimpleRectangularCells(table) ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0
  ) {
    return false;
  }

  const columnCount = table.child(0).childCount;
  const columnWidth = Math.max(
    MIN_TABLE_COLUMN_WIDTH,
    Math.floor(availableWidth / columnCount),
  );
  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) =>
    recreateRow(
      row,
      cellsOf(row).map((cell) =>
        cell.type.create(
          { ...cell.attrs, colwidth: [columnWidth] },
          cell.content,
          cell.marks,
        ),
      ),
    ),
  );
  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows, { ...table.attrs, fitToWidth: true }),
    activeCell,
  );
}

export function setTableColumnWidths(
  editor: Editor,
  tablePos: number,
  widths: readonly number[],
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !hasSimpleRectangularCells(table)) return false;

  const columnCount = table.firstChild?.childCount ?? 0;
  if (widths.length !== columnCount) return false;
  const normalizedWidths = widths.map(normalizeTableColumnWidth);
  if (normalizedWidths.some((width) => width === null)) return false;

  const activeCell = activeTableCell(editor, tablePos);
  const rows = rowsOf(table).map((row) =>
    recreateRow(
      row,
      cellsOf(row).map((cell, columnIndex) =>
        cell.type.create(
          {
            ...cell.attrs,
            colwidth: [normalizedWidths[columnIndex]],
          },
          cell.content,
          cell.marks,
        ),
      ),
    ),
  );

  return replaceTable(
    editor,
    tablePos,
    table,
    recreateTable(table, rows, { ...table.attrs, fitToWidth: false }),
    activeCell,
  );
}

export function setTableRowHeight(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  height: number,
): boolean {
  const rowHeight = normalizeTableRowHeight(height);
  if (!rowHeight) return false;
  return updateTableRowHeight(
    editor,
    tablePos,
    rowIndex,
    rowHeight,
    true,
  );
}

export function setTableRowHeightPreview(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  height: number | null,
): boolean {
  const rowHeight = height === null ? null : normalizeTableRowHeight(height);
  if (height !== null && !rowHeight) return false;
  return updateTableRowHeight(
    editor,
    tablePos,
    rowIndex,
    rowHeight,
    false,
  );
}

function updateTableRowHeight(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  rowHeight: number | null,
  addToHistory: boolean,
): boolean {
  const table = getTable(editor, tablePos);
  if (!table || !isValidIndex(rowIndex, table.childCount)) {
    return false;
  }

  let rowPos = tablePos + 1;
  for (let index = 0; index < rowIndex; index += 1) {
    rowPos += table.child(index).nodeSize;
  }
  const row = table.child(rowIndex);
  if (row.attrs.rowHeight === rowHeight) return false;

  let transaction = editor.state.tr.setNodeMarkup(rowPos, undefined, {
    ...row.attrs,
    rowHeight,
  });
  if (addToHistory) {
    transaction = closeHistory(transaction);
  } else {
    transaction.setMeta("addToHistory", false);
    transaction.setMeta("scratchTableRowResizePreview", true);
  }
  editor.view.dispatch(transaction);
  return true;
}
