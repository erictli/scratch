import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AiDiffBlock, AiDiffSession } from "../../../lib/diff";

const CODE_BLOCK_DELETE_TEXT_LIMIT = 240;
const DEFAULT_DELETE_TEXT_LIMIT = 80;
const TABLE_BLOCK_DELETE_TEXT_LIMIT = 360;
const TABLE_ALIGNMENT_EPSILON = 1e-6;

function clampPosition(value: number, size: number): number {
  return Math.max(0, Math.min(value, size));
}

function createDeletedWidget(
  text: string,
  isCodeLikeBlock: boolean,
): HTMLElement {
  const span = document.createElement("span");
  span.className = isCodeLikeBlock
    ? "ai-diff-word-delete ai-diff-word-delete--code"
    : "ai-diff-word-delete";
  span.textContent = text;
  return span;
}

function isInlineWidgetAnchor(doc: ProseMirrorNode, position: number): boolean {
  const resolved = doc.resolve(position);
  return resolved.parent.isTextblock && resolved.parent.inlineContent;
}

function findNearestInlineWidgetAnchor(
  doc: ProseMirrorNode,
  preferredPosition: number,
  minPosition: number,
  maxPosition: number,
): number | null {
  const min = Math.max(0, minPosition);
  const max = Math.min(maxPosition, doc.content.size);
  if (max < min) return null;

  const preferred = Math.max(min, Math.min(preferredPosition, max));
  if (isInlineWidgetAnchor(doc, preferred)) return preferred;

  const maxSearchSteps = Math.min(160, max - min);
  for (let step = 1; step <= maxSearchSteps; step += 1) {
    const backward = preferred - step;
    if (backward >= min && isInlineWidgetAnchor(doc, backward)) {
      return backward;
    }

    const forward = preferred + step;
    if (forward <= max && isInlineWidgetAnchor(doc, forward)) {
      return forward;
    }
  }

  if (isInlineWidgetAnchor(doc, min)) return min;
  if (isInlineWidgetAnchor(doc, max)) return max;
  return null;
}

type TableCellSnapshot = {
  text: string;
  isHeader: boolean;
};

type TableSnapshot = {
  rows: TableCellSnapshot[][];
};

type TableNodeInfo = {
  node: ProseMirrorNode;
  pos: number;
};

function createDeletedTableCellWidget(
  text: string,
  isHeader: boolean,
): HTMLElement {
  const cell = document.createElement(isHeader ? "th" : "td");
  cell.className = isHeader
    ? "ai-diff-table-delete-cell ai-diff-table-delete-cell--header"
    : "ai-diff-table-delete-cell";
  cell.setAttribute("contenteditable", "false");

  const content = document.createElement("span");
  content.className = "ai-diff-word-delete";
  content.textContent = text.length > 0 ? text : " ";
  cell.appendChild(content);
  return cell;
}

function getTableNodeInfo(
  doc: ProseMirrorNode,
  blockFrom: number,
  blockTo: number,
): TableNodeInfo | null {
  const direct = doc.nodeAt(blockFrom);
  if (direct?.type.name === "table") {
    return { node: direct, pos: blockFrom };
  }

  let found: TableNodeInfo | null = null;
  doc.nodesBetween(blockFrom, blockTo, (node, pos) => {
    if (node.type.name === "table") {
      found = { node, pos };
      return false;
    }
    return true;
  });

  return found;
}

function parseOriginalTableSnapshot(
  doc: ProseMirrorNode,
  activeBlock: AiDiffBlock,
): TableSnapshot | null {
  if (!activeBlock.originalBlock) return null;

  try {
    const originalNode = doc.type.schema.nodeFromJSON(activeBlock.originalBlock);
    if (originalNode.type.name !== "table") return null;
    return extractTableSnapshot(originalNode);
  } catch {
    return null;
  }
}

function extractTableSnapshot(tableNode: ProseMirrorNode): TableSnapshot {
  const rows: TableCellSnapshot[][] = [];

  tableNode.forEach((rowNode) => {
    if (rowNode.type.name !== "tableRow") {
      rows.push([]);
      return;
    }

    const rowCells: TableCellSnapshot[] = [];
    rowNode.forEach((cellNode) => {
      if (
        cellNode.type.name !== "tableCell" &&
        cellNode.type.name !== "tableHeader"
      ) {
        return;
      }

      rowCells.push({
        text: cellNode.textContent,
        isHeader: cellNode.type.name === "tableHeader",
      });
    });

    rows.push(rowCells);
  });

  return { rows };
}

function getMaxColumnCount(snapshot: TableSnapshot): number {
  return snapshot.rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function normalizeTableCellText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeNormalizedText(value: string): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(" ").filter(Boolean));
}

function computeCellTextSimilarity(beforeText: string, afterText: string): number {
  if (beforeText === afterText) {
    return beforeText.length > 0 ? 1 : 0.35;
  }
  if (!beforeText || !afterText) return 0;
  if (beforeText.includes(afterText) || afterText.includes(beforeText)) {
    return 0.62;
  }

  const beforeTokens = tokenizeNormalizedText(beforeText);
  const afterTokens = tokenizeNormalizedText(afterText);
  if (beforeTokens.size === 0 || afterTokens.size === 0) return 0;

  let intersection = 0;
  const [smaller, larger] =
    beforeTokens.size <= afterTokens.size
      ? [beforeTokens, afterTokens]
      : [afterTokens, beforeTokens];
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }

  const union = beforeTokens.size + afterTokens.size - intersection;
  if (union <= 0) return 0;
  return (intersection / union) * 0.85;
}

function getColumnVector(snapshot: TableSnapshot, columnIndex: number): string[] {
  return snapshot.rows.map((row) =>
    normalizeTableCellText(row[columnIndex]?.text ?? ""),
  );
}

function computeColumnSimilarity(
  beforeSnapshot: TableSnapshot,
  afterSnapshot: TableSnapshot,
  beforeColumnIndex: number,
  afterColumnIndex: number,
): number {
  const beforeVector = getColumnVector(beforeSnapshot, beforeColumnIndex);
  const afterVector = getColumnVector(afterSnapshot, afterColumnIndex);
  const rowCount = Math.max(beforeVector.length, afterVector.length);
  if (rowCount === 0) return 1;

  let score = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    score += computeCellTextSimilarity(
      beforeVector[rowIndex] ?? "",
      afterVector[rowIndex] ?? "",
    );
  }

  return score / rowCount;
}

function alignTableColumns(
  beforeSnapshot: TableSnapshot,
  afterSnapshot: TableSnapshot,
): { beforeToAfter: Map<number, number>; deletedBeforeColumnIndexes: number[] } {
  const beforeCount = getMaxColumnCount(beforeSnapshot);
  const afterCount = getMaxColumnCount(afterSnapshot);
  const beforeToAfter = new Map<number, number>();

  if (beforeCount <= afterCount) {
    return { beforeToAfter, deletedBeforeColumnIndexes: [] };
  }

  if (afterCount === 0) {
    const deletedBeforeColumnIndexes =
      Array.from({ length: beforeCount }, (_, index) => index);
    return { beforeToAfter, deletedBeforeColumnIndexes };
  }

  const similarityCache = new Map<string, number>();
  const getSimilarity = (beforeIndex: number, afterIndex: number): number => {
    const key = `${beforeIndex}:${afterIndex}`;
    const cached = similarityCache.get(key);
    if (cached !== undefined) return cached;

    const similarity = computeColumnSimilarity(
      beforeSnapshot,
      afterSnapshot,
      beforeIndex,
      afterIndex,
    );
    similarityCache.set(key, similarity);
    return similarity;
  };

  const dp = Array.from({ length: beforeCount + 1 }, () =>
    new Array<number>(afterCount + 1).fill(0),
  );

  for (let beforeIndex = beforeCount - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterCount - 1; afterIndex >= 0; afterIndex -= 1) {
      const match =
        getSimilarity(beforeIndex, afterIndex) +
        dp[beforeIndex + 1][afterIndex + 1];
      const skipBefore = dp[beforeIndex + 1][afterIndex];
      const skipAfter = dp[beforeIndex][afterIndex + 1];
      dp[beforeIndex][afterIndex] = Math.max(match, skipBefore, skipAfter);
    }
  }

  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeCount && afterIndex < afterCount) {
    const similarity = getSimilarity(beforeIndex, afterIndex);
    const match = similarity + dp[beforeIndex + 1][afterIndex + 1];
    const skipBefore = dp[beforeIndex + 1][afterIndex];
    const skipAfter = dp[beforeIndex][afterIndex + 1];

    if (
      match >= skipBefore - TABLE_ALIGNMENT_EPSILON &&
      match >= skipAfter - TABLE_ALIGNMENT_EPSILON
    ) {
      beforeToAfter.set(beforeIndex, afterIndex);
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (skipBefore >= skipAfter) {
      beforeIndex += 1;
    } else {
      afterIndex += 1;
    }
  }

  const deletedBeforeColumnIndexes = Array.from(
    { length: beforeCount },
    (_, index) => index,
  ).filter((index) => !beforeToAfter.has(index));

  return { beforeToAfter, deletedBeforeColumnIndexes };
}

function resolveDeletedColumnInsertIndex(
  deletedBeforeColumnIndex: number,
  sortedMatchedBeforeIndexes: number[],
  beforeToAfter: Map<number, number>,
): number {
  for (const matchedBeforeIndex of sortedMatchedBeforeIndexes) {
    if (matchedBeforeIndex > deletedBeforeColumnIndex) {
      return beforeToAfter.get(matchedBeforeIndex) ?? 0;
    }
  }

  for (let index = sortedMatchedBeforeIndexes.length - 1; index >= 0; index -= 1) {
    const matchedBeforeIndex = sortedMatchedBeforeIndexes[index];
    if (matchedBeforeIndex < deletedBeforeColumnIndex) {
      return (beforeToAfter.get(matchedBeforeIndex) ?? 0) + 1;
    }
  }

  return 0;
}

function buildTableDeletedColumnDecorations(
  doc: ProseMirrorNode,
  activeBlock: AiDiffBlock,
  blockFrom: number,
  blockTo: number,
): Decoration[] {
  const tableInfo = getTableNodeInfo(doc, blockFrom, blockTo);
  if (!tableInfo) return [];

  const afterSnapshot = extractTableSnapshot(tableInfo.node);
  const beforeSnapshot = parseOriginalTableSnapshot(doc, activeBlock);
  if (!beforeSnapshot) return [];

  const { beforeToAfter, deletedBeforeColumnIndexes } = alignTableColumns(
    beforeSnapshot,
    afterSnapshot,
  );
  if (deletedBeforeColumnIndexes.length === 0) return [];

  const sortedMatchedBeforeIndexes = Array.from(beforeToAfter.keys()).sort(
    (a, b) => a - b,
  );
  const sortedDeletedBeforeIndexes = [...deletedBeforeColumnIndexes].sort(
    (a, b) => a - b,
  );

  const decorations: Decoration[] = [];
  let rowIndex = 0;

  tableInfo.node.forEach((rowNode, rowOffset) => {
    if (rowNode.type.name !== "tableRow") return;

    const rowPos = tableInfo.pos + 1 + rowOffset;
    const rowCellOffsets: number[] = [];
    rowNode.forEach((_cellNode, cellOffset) => {
      rowCellOffsets.push(cellOffset);
    });
    const rowCellCount = rowCellOffsets.length;

    for (
      let deletedOrder = 0;
      deletedOrder < sortedDeletedBeforeIndexes.length;
      deletedOrder += 1
    ) {
      const deletedBeforeIndex = sortedDeletedBeforeIndexes[deletedOrder];
      const insertIndex = resolveDeletedColumnInsertIndex(
        deletedBeforeIndex,
        sortedMatchedBeforeIndexes,
        beforeToAfter,
      );
      const clampedInsertIndex = Math.max(0, Math.min(insertIndex, rowCellCount));
      const anchorPos =
        clampedInsertIndex < rowCellCount
          ? rowPos + 1 + rowCellOffsets[clampedInsertIndex]
          : rowPos + rowNode.nodeSize - 1;

      const beforeCell = beforeSnapshot.rows[rowIndex]?.[deletedBeforeIndex];
      const isHeader = beforeCell?.isHeader ?? false;
      const cellText = beforeCell?.text ?? "";

      decorations.push(
        Decoration.widget(
          anchorPos,
          () => createDeletedTableCellWidget(cellText, isHeader),
          {
            side: -100 + deletedOrder,
            ignoreSelection: true,
            key: `table-column-delete-${activeBlock.id}-${rowIndex}-${deletedBeforeIndex}`,
          },
        ),
      );
    }

    rowIndex += 1;
  });

  return decorations;
}

function buildAiDiffBlockDecorations(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
): Decoration[] {
  if (!aiDiffSession || aiDiffSession.blocks.length === 0) return [];

  const docSize = doc.content.size;

  return aiDiffSession.blocks
    .map((block) => {
      const from = clampPosition(block.from, docSize);
      const to = clampPosition(block.to, docSize);
      if (to <= from) return null;

      const classes: string[] = [];
      if (block.indicatorType) {
        classes.push(
          "ai-diff-indicator-block",
          `ai-diff-indicator-block--${block.indicatorType}`,
        );
      }
      if (block.hasDeletionAnchor) {
        classes.push("ai-diff-deletion-anchor-block");
      }

      if (classes.length === 0) return null;

      return Decoration.node(from, to, {
        class: classes.join(" "),
        "data-ai-diff-block-id": block.id,
      });
    })
    .filter((decoration): decoration is Decoration => decoration !== null);
}

function buildAiWordDiffDecorations(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
  activeBlockId: string | null,
): Decoration[] {
  if (!aiDiffSession || !activeBlockId) return [];

  const activeBlock = aiDiffSession.blocks.find(
    (block) => block.id === activeBlockId && !!block.indicatorType,
  );
  if (!activeBlock) return [];

  const isCodeLikeBlock =
    activeBlock.blockType === "codeBlock" ||
    activeBlock.blockType === "frontmatter";
  const isTableBlock = activeBlock.blockType === "table";

  const docSize = doc.content.size;
  const blockFrom = clampPosition(activeBlock.from, docSize);
  const blockTo = clampPosition(activeBlock.to, docSize);
  if (blockTo <= blockFrom) return [];

  const blockContentFrom = Math.min(blockTo, blockFrom + 1);
  const blockContentTo = Math.max(blockContentFrom, blockTo - 1);
  const decorations: Decoration[] = [];
  const tableDeletedColumnDecorations = isTableBlock
    ? buildTableDeletedColumnDecorations(doc, activeBlock, blockFrom, blockTo)
    : [];

  for (const changeIndex of activeBlock.relatedChangeIndexes) {
    const change = aiDiffSession.changes[changeIndex];
    if (!change) continue;

    const insertedFrom = clampPosition(change.fromB, docSize);
    const insertedTo = clampPosition(change.toB, docSize);
    const from = Math.max(insertedFrom, blockContentFrom);
    const to = Math.min(insertedTo, blockContentTo);

    if (to > from) {
      decorations.push(
        Decoration.inline(from, to, {
          class: "ai-diff-word-add",
        }),
      );
    }

    const maxDeleteTextLength = isCodeLikeBlock
      ? CODE_BLOCK_DELETE_TEXT_LIMIT
      : isTableBlock
        ? TABLE_BLOCK_DELETE_TEXT_LIMIT
        : DEFAULT_DELETE_TEXT_LIMIT;
    const shouldRenderDeletedWidget =
      change.deletedText.length > 0 &&
      change.deletedText.length <= maxDeleteTextLength &&
      (isCodeLikeBlock || isTableBlock || !change.deletedText.includes("\n"));

    if (!shouldRenderDeletedWidget) continue;
    if (isTableBlock) continue;

    const preferredAnchor = Math.max(
      blockContentFrom,
      Math.min(clampPosition(change.fromB, docSize), blockContentTo),
    );
    const inlineAnchor = findNearestInlineWidgetAnchor(
      doc,
      preferredAnchor,
      blockContentFrom,
      blockContentTo,
    );

    if (inlineAnchor !== null) {
      decorations.push(
        Decoration.widget(
          inlineAnchor,
          () => createDeletedWidget(change.deletedText, isCodeLikeBlock),
          {
            side: -1,
            ignoreSelection: true,
          },
        ),
      );
    }
  }

  decorations.push(...tableDeletedColumnDecorations);
  return decorations;
}

export function createAiDiffBlockDecorationSet(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
): DecorationSet {
  return DecorationSet.create(
    doc,
    buildAiDiffBlockDecorations(doc, aiDiffSession),
  );
}

export function createAiWordDiffDecorationSet(
  doc: ProseMirrorNode,
  aiDiffSession: AiDiffSession | null | undefined,
  activeBlockId: string | null,
): DecorationSet {
  return DecorationSet.create(
    doc,
    buildAiWordDiffDecorations(doc, aiDiffSession, activeBlockId),
  );
}
