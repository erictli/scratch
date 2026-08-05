import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const TABLE_STRUCTURE_TYPES = new Set([
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const INLINE_CONTENT_TYPES = new Set(["text", "hardBreak", "wikilink"]);

function isTableCell(node: JSONContent): boolean {
  return node.type === "tableCell" || node.type === "tableHeader";
}

function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

function emptyCell(type = "tableCell"): JSONContent {
  return { type, content: [emptyParagraph()] };
}

function normalizeEditorialNode(node: JSONContent): JSONContent[] {
  if (node.type && TABLE_STRUCTURE_TYPES.has(node.type)) {
    return (node.content ?? []).flatMap(normalizeEditorialNode);
  }

  const content = node.content?.flatMap(normalizeEditorialNode);
  return [content ? { ...node, content } : { ...node }];
}

function normalizeCellContent(content: readonly JSONContent[]): JSONContent[] {
  const flattened = content.flatMap(normalizeEditorialNode);
  const normalized: JSONContent[] = [];
  let pendingInline: JSONContent[] = [];

  const flushInline = () => {
    if (pendingInline.length === 0) return;
    normalized.push({ type: "paragraph", content: pendingInline });
    pendingInline = [];
  };

  for (const child of flattened) {
    if (child.type && INLINE_CONTENT_TYPES.has(child.type)) {
      pendingInline.push(child);
    } else {
      flushInline();
      normalized.push(child);
    }
  }
  flushInline();

  return normalized.length > 0 ? normalized : [emptyParagraph()];
}

function normalizeCell(node: JSONContent): JSONContent {
  const content = isTableCell(node) ? node.content ?? [] : [node];
  return {
    ...node,
    type: isTableCell(node) ? node.type : "tableCell",
    content: normalizeCellContent(content),
  };
}

function cellsFromRowContent(content: readonly JSONContent[]): JSONContent[] {
  return content.flatMap((child) => {
    if (child.type === "tableRow") {
      return cellsFromRowContent(child.content ?? []);
    }
    return [normalizeCell(child)];
  });
}

function normalizeRow(node: JSONContent): JSONContent {
  const cells = cellsFromRowContent(node.content ?? []);
  return {
    ...node,
    type: "tableRow",
    content: cells.length > 0 ? cells : [emptyCell()],
  };
}

function normalizeTable(node: JSONContent): JSONContent {
  const rows: JSONContent[] = [];
  let pendingCells: JSONContent[] = [];

  const flushPendingCells = () => {
    if (pendingCells.length === 0) return;
    rows.push({ type: "tableRow", content: pendingCells });
    pendingCells = [];
  };

  for (const child of node.content ?? []) {
    if (child.type === "tableRow") {
      flushPendingCells();
      rows.push(normalizeRow(child));
    } else if (child.type === "table") {
      flushPendingCells();
      rows.push(...(normalizeTable(child).content ?? []));
    } else {
      pendingCells.push(normalizeCell(child));
    }
  }
  flushPendingCells();

  if (rows.length === 0) rows.push({ type: "tableRow", content: [emptyCell()] });

  const readSpan = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  };
  const positionedRows: Array<{
    row: JSONContent;
    blockedByRowspan: boolean[];
    cells: Array<{ column: number; colspan: number; cell: JSONContent }>;
  }> = [];
  let rowspanOccupancy: number[] = [];
  let width = 1;

  for (const row of rows) {
    const blockedByRowspan = rowspanOccupancy.map((remaining) => remaining > 0);
    const nextRowspanOccupancy = rowspanOccupancy.map((remaining) =>
      Math.max(0, remaining - 1),
    );
    const occupied = [...blockedByRowspan];
    const positionedCells: Array<{
      column: number;
      colspan: number;
      cell: JSONContent;
    }> = [];
    let column = 0;

    for (const cell of row.content ?? []) {
      const colspan = readSpan(cell.attrs?.colspan);
      while (
        Array.from({ length: colspan }, (_, offset) => column + offset).some(
          (candidate) => occupied[candidate],
        )
      ) {
        column += 1;
      }
      const rowspan = readSpan(cell.attrs?.rowspan);
      positionedCells.push({ column, colspan, cell });
      for (let offset = 0; offset < colspan; offset += 1) {
        const occupiedColumn = column + offset;
        occupied[occupiedColumn] = true;
        if (rowspan > 1) {
          nextRowspanOccupancy[occupiedColumn] = Math.max(
            nextRowspanOccupancy[occupiedColumn] ?? 0,
            rowspan - 1,
          );
        }
      }
      column += colspan;
    }

    const rowWidth = occupied.reduce(
      (lastOccupied, isOccupied, index) =>
        isOccupied ? index + 1 : lastOccupied,
      0,
    );
    width = Math.max(width, rowWidth);
    positionedRows.push({
      row,
      blockedByRowspan,
      cells: positionedCells,
    });
    rowspanOccupancy = nextRowspanOccupancy;
  }

  const rectangularRows = positionedRows.map(
    ({ row, blockedByRowspan, cells }) => {
      const occupied = [...blockedByRowspan];
      for (const { column, colspan } of cells) {
        for (let offset = 0; offset < colspan; offset += 1) {
          occupied[column + offset] = true;
        }
      }
      const paddingType =
        cells.length > 0 &&
        cells.every(({ cell }) => cell.type === "tableHeader")
          ? "tableHeader"
          : "tableCell";
      const paddedCells = [...cells];
      for (let column = 0; column < width; column += 1) {
        if (occupied[column]) continue;
        paddedCells.push({
          column,
          colspan: 1,
          cell: emptyCell(paddingType),
        });
      }
      paddedCells.sort((left, right) => left.column - right.column);
      return { ...row, content: paddedCells.map(({ cell }) => cell) };
    },
  );

  return { ...node, type: "table", content: rectangularRows };
}

function normalizeNode(node: JSONContent): JSONContent[] {
  if (node.type === "table") return [normalizeTable(node)];

  if (node.type && TABLE_STRUCTURE_TYPES.has(node.type)) {
    return (node.content ?? []).flatMap(normalizeNode);
  }

  const content = node.content?.flatMap(normalizeNode);
  return [content ? { ...node, content } : { ...node }];
}

export function normalizeNestedTablesInJson(
  content: JSONContent,
): JSONContent {
  return normalizeNode(content)[0] ?? { type: "doc", content: [] };
}

export function containsNestedTable(content: JSONContent): boolean {
  let found = false;

  function visit(node: JSONContent, insideTableCell: boolean) {
    if (found) return;
    if (insideTableCell && node.type === "table") {
      found = true;
      return;
    }
    const childIsInsideTableCell = insideTableCell || isTableCell(node);
    node.content?.forEach((child) => visit(child, childIsInsideTableCell));
  }

  visit(content, false);
  return found;
}

export function containsNestedTableNode(doc: ProseMirrorNode): boolean {
  let found = false;

  function visit(node: ProseMirrorNode, insideTableCell: boolean): void {
    if (found) return;
    if (insideTableCell && node.type.name === "table") {
      found = true;
      return;
    }
    const childIsInsideTableCell =
      insideTableCell ||
      node.type.name === "tableCell" ||
      node.type.name === "tableHeader";
    node.content?.forEach((child) => visit(child, childIsInsideTableCell));
  }

  visit(doc, false);
  return found;
}
