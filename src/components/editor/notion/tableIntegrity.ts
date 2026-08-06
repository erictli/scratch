import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const TABLE_STRUCTURE_TYPES = new Set([
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

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
    if (child.type === "text" || child.type === "hardBreak") {
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

function cellSpan(
  cell: JSONContent,
  attribute: "colspan" | "rowspan",
): number {
  const value = cell.attrs?.[attribute];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 1;
}

function layoutTableRow(
  cells: readonly JSONContent[],
  activeRowspans: readonly number[],
): { occupied: boolean[]; nextRowspans: number[] } {
  const occupied = activeRowspans.map((remaining) => remaining > 0);
  const nextRowspans = activeRowspans.map((remaining) =>
    Math.max(0, remaining - 1),
  );
  let searchFrom = 0;

  for (const cell of cells) {
    const colspan = cellSpan(cell, "colspan");
    let start = searchFrom;

    while (true) {
      while (occupied[start]) start += 1;
      let blockedOffset = -1;
      for (let offset = 0; offset < colspan; offset += 1) {
        if (occupied[start + offset]) {
          blockedOffset = offset;
          break;
        }
      }
      if (blockedOffset === -1) break;
      start += blockedOffset + 1;
    }

    const rowspan = cellSpan(cell, "rowspan");
    for (let offset = 0; offset < colspan; offset += 1) {
      const column = start + offset;
      occupied[column] = true;
      if (rowspan > 1) {
        nextRowspans[column] = Math.max(
          nextRowspans[column] ?? 0,
          rowspan - 1,
        );
      }
    }
    searchFrom = start + colspan;
  }

  return { occupied, nextRowspans };
}

function occupiedWidth(occupied: readonly boolean[]): number {
  for (let index = occupied.length - 1; index >= 0; index -= 1) {
    if (occupied[index]) return index + 1;
  }
  return 0;
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

  let activeRowspans: number[] = [];
  const rowLayouts = rows.map((row) => {
    const layout = layoutTableRow(row.content ?? [], activeRowspans);
    activeRowspans = layout.nextRowspans;
    return layout;
  });
  const width = Math.max(
    1,
    ...rowLayouts.map((layout) => occupiedWidth(layout.occupied)),
  );
  const rectangularRows = rows.map((row, rowIndex) => {
    const cells = [...(row.content ?? [])];
    const layout = rowLayouts[rowIndex];
    const occupiedColumns =
      layout?.occupied.slice(0, width).filter(Boolean).length ?? 0;
    const paddingType = cells.every((cell) => cell.type === "tableHeader")
      ? "tableHeader"
      : "tableCell";
    for (
      let paddingIndex = occupiedColumns;
      paddingIndex < width;
      paddingIndex += 1
    ) {
      cells.push(emptyCell(paddingType));
    }
    return { ...row, content: cells };
  });

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

export function docContainsNestedTable(doc: ProseMirrorNode): boolean {
  let found = false;

  const visit = (node: ProseMirrorNode, insideTableCell: boolean): void => {
    if (found) return;
    if (insideTableCell && node.type.name === "table") {
      found = true;
      return;
    }
    const childIsInsideTableCell =
      insideTableCell ||
      node.type.name === "tableCell" ||
      node.type.name === "tableHeader";
    node.forEach((child) => visit(child, childIsInsideTableCell));
  };

  visit(doc, false);
  return found;
}
