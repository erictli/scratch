import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, TableMap } from "@tiptap/pm/tables";

interface TablePasteDecisionInput {
  isInsideTableCell: boolean;
  html: string;
  parsedContent: JSONContent | null;
}

function containsTableNode(content: JSONContent | null): boolean {
  if (!content) return false;
  if (content.type === "table") return true;
  return (content.content ?? []).some(containsTableNode);
}

export function shouldRejectTablePaste({
  isInsideTableCell,
  html,
  parsedContent,
}: TablePasteDecisionInput): boolean {
  if (!isInsideTableCell) return false;
  return (
    /<\s*table(?:\s|>)/i.test(html) || containsTableNode(parsedContent)
  );
}

export function parseTsv(text: string): string[][] | null {
  if (!text.includes("\t")) return null;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && (quoted || cell === "")) {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        cell += "\n";
        index += 1;
      } else {
        cell += character === "\r" ? "\n" : character;
      }
      continue;
    }
    if (character === "\t") {
      pushCell();
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    cell += character;
  }

  if (quoted) return null;
  pushRow();
  const lastRow = rows[rows.length - 1];
  if (
    rows.length > 1 &&
    lastRow?.length === 1 &&
    lastRow[0] === ""
  ) {
    rows.pop();
  }
  const columnCount = rows[0]?.length ?? 0;
  if (
    columnCount < 2 ||
    rows.length === 0 ||
    rows.some((currentRow) => currentRow.length !== columnCount)
  ) {
    return null;
  }
  return rows;
}

interface ActiveTableCell {
  table: ProseMirrorNode;
  tablePos: number;
  rowIndex: number;
  columnIndex: number;
}

function activeTableCell(editor: Editor): ActiveTableCell | null {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) {
    const table = selection.$anchorCell.node(-1);
    const tableStart = selection.$anchorCell.start(-1);
    const rectangle = TableMap.get(table).rectBetween(
      selection.$anchorCell.pos - tableStart,
      selection.$headCell.pos - tableStart,
    );
    return {
      table,
      tablePos: tableStart - 1,
      rowIndex: rectangle.top,
      columnIndex: rectangle.left,
    };
  }

  const { $head } = selection;
  let tableDepth = -1;
  let rowDepth = -1;

  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const name = $head.node(depth).type.name;
    if (rowDepth < 0 && name === "tableRow") rowDepth = depth;
    if (name === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || rowDepth < 0) return null;

  return {
    table: $head.node(tableDepth),
    tablePos: $head.before(tableDepth),
    rowIndex: $head.index(tableDepth),
    columnIndex: $head.index(rowDepth),
  };
}

function replaceCellText(cell: ProseMirrorNode, value: string): ProseMirrorNode {
  const paragraph = cell.type.schema.nodes.paragraph;
  if (!paragraph) return cell;
  const paragraphs = value.split("\n").map((line) =>
    paragraph.create(
      null,
      line ? cell.type.schema.text(line) : undefined,
    ),
  );
  return cell.type.create(
    cell.attrs,
    Fragment.fromArray(paragraphs),
    cell.marks,
  );
}

export function pasteTableTsv(editor: Editor, text: string): boolean {
  const matrix = parseTsv(text);
  const active = activeTableCell(editor);
  if (!matrix || !active || active.table.childCount === 0) return false;

  const columnCount = active.table.child(0).childCount;
  const isRectangular = Array.from(
    { length: active.table.childCount },
    (_, rowIndex) => active.table.child(rowIndex),
  ).every(
    (row) =>
      row.childCount === columnCount &&
      Array.from({ length: row.childCount }, (_, columnIndex) =>
        row.child(columnIndex),
      ).every(
        (cell) =>
          Number(cell.attrs.colspan ?? 1) === 1 &&
          Number(cell.attrs.rowspan ?? 1) === 1,
      ),
  );
  if (
    !isRectangular ||
    active.rowIndex + matrix.length > active.table.childCount ||
    active.columnIndex + matrix[0].length > columnCount
  ) {
    return false;
  }

  const rows = Array.from(
    { length: active.table.childCount },
    (_, rowIndex) => {
      const row = active.table.child(rowIndex);
      if (
        rowIndex < active.rowIndex ||
        rowIndex >= active.rowIndex + matrix.length
      ) {
        return row;
      }
      const cells = Array.from(
        { length: row.childCount },
        (_, columnIndex) => {
          const cell = row.child(columnIndex);
          if (
            columnIndex < active.columnIndex ||
            columnIndex >= active.columnIndex + matrix[0].length
          ) {
            return cell;
          }
          return replaceCellText(
            cell,
            matrix[rowIndex - active.rowIndex][
              columnIndex - active.columnIndex
            ],
          );
        },
      );
      return row.type.create(row.attrs, Fragment.fromArray(cells), row.marks);
    },
  );
  const replacement = active.table.type.create(
    active.table.attrs,
    Fragment.fromArray(rows),
    active.table.marks,
  );
  if (replacement.eq(active.table)) return false;

  const transaction = closeHistory(
    editor.state.tr.replaceWith(
      active.tablePos,
      active.tablePos + active.table.nodeSize,
      replacement,
    ),
  );
  editor.view.dispatch(transaction);
  return true;
}

function encodeTsvCell(value: string): string {
  if (!/[\t\n\r"]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeTableCellSelectionToTsv(
  editor: Editor,
): string | null {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return null;

  const rows: ProseMirrorNode[] = [];
  selection.content().content.forEach((node) => {
    if (node.type.name === "table") {
      for (let rowIndex = 0; rowIndex < node.childCount; rowIndex += 1) {
        rows.push(node.child(rowIndex));
      }
    } else if (node.type.name === "tableRow") {
      rows.push(node);
    }
  });
  if (rows.length === 0) return null;

  return rows
    .map((row) =>
      Array.from({ length: row.childCount }, (_, columnIndex) =>
        encodeTsvCell(
          row.child(columnIndex).textBetween(
            0,
            row.child(columnIndex).content.size,
            "\n",
          ),
        ),
      ).join("\t"),
    )
    .join("\n");
}
