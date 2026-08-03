import type { JSONContent } from "@tiptap/core";

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

  const width = Math.max(
    1,
    ...rows.map((row) => row.content?.length ?? 0),
  );
  const rectangularRows = rows.map((row) => {
    const cells = [...(row.content ?? [])];
    const paddingType = cells.every((cell) => cell.type === "tableHeader")
      ? "tableHeader"
      : "tableCell";
    while (cells.length < width) cells.push(emptyCell(paddingType));
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
