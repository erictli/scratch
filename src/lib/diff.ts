import type { JSONContent } from "@tiptap/core";
import type { Schema, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { StepMap } from "@tiptap/pm/transform";
import {
  ChangeSet,
  simplifyChanges,
  type ChangeJSON,
} from "prosemirror-changeset";

export interface AiEditDiffInput<Data = string> {
  schema: Schema;
  before: JSONContent;
  after: JSONContent;
  metadata?: Data;
}

export type AiEditChangeKind = "add" | "modify" | "delete-block";
export type AiDiffIndicatorType = "add" | "modify";

export type AiEditRawChange<Data = string> = ChangeJSON<Data> & {
  kind: AiEditChangeKind;
  deletedText: string;
};

type BlockRange = {
  from: number;
  to: number;
};

type IndexedTopLevelBlockRange = BlockRange & {
  index: number;
  node: ProseMirrorNode;
};

type BlockAlignment = {
  afterToBeforeIndex: Map<number, number>;
  newAfterIndexes: Set<number>;
  deletionAnchorAfterIndexes: Set<number>;
};

type BlockPositionPair = {
  beforePosition: number;
  afterPosition: number;
};

const BLOCK_SIMILARITY_THRESHOLD = 0.35;
const SIMILARITY_EPSILON = 1e-6;
const BLOCK_TEXT_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

export interface AiDiffBlock {
  id: string;
  from: number;
  to: number;
  blockType: string;
  indicatorType?: AiDiffIndicatorType;
  hasDeletionAnchor: boolean;
  relatedChangeIndexes: number[];
  originalBlock: JSONContent | null;
}

export interface AiDiffSession<Data = string> {
  before: JSONContent;
  after: JSONContent;
  changes: AiEditRawChange<Data>[];
  blocks: AiDiffBlock[];
}

function getTopLevelBlockRanges(
  doc: ProseMirrorNode,
): IndexedTopLevelBlockRange[] {
  const ranges: IndexedTopLevelBlockRange[] = [];
  let blockIndex = 0;

  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    ranges.push({
      from: offset,
      to: offset + node.nodeSize,
      index: blockIndex,
      node,
    });
    blockIndex += 1;
  });

  return ranges;
}

function getMergedIndicatorType(
  existingType: AiDiffIndicatorType | undefined,
  nextType: AiDiffIndicatorType,
): AiDiffIndicatorType {
  if (!existingType) return nextType;
  if (existingType === "modify" || nextType === "modify") return "modify";
  return "add";
}

function overlapsRange(range: BlockRange, from: number, to: number): boolean {
  return from < range.to && to > range.from;
}

function findContainingRanges(
  ranges: IndexedTopLevelBlockRange[],
  from: number,
  to: number,
): IndexedTopLevelBlockRange[] {
  return ranges.filter((range) => overlapsRange(range, from, to));
}

function findNearestBlockForCollapsedPosition(
  ranges: IndexedTopLevelBlockRange[],
  position: number,
): IndexedTopLevelBlockRange | null {
  if (ranges.length === 0) return null;

  const containing = ranges.find((range) => {
    return position >= range.from && position < range.to;
  });
  if (containing) return containing;

  if (position >= ranges[ranges.length - 1].to) {
    return ranges[ranges.length - 1];
  }

  let nearest: IndexedTopLevelBlockRange | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const range of ranges) {
    const distance =
      position < range.from
        ? range.from - position
        : position > range.to
          ? position - range.to
          : 0;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = range;
    }
  }

  return nearest;
}

function tokenizeBlockText(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return new Set();
  const matches = normalized.match(BLOCK_TEXT_TOKEN_PATTERN) ?? [];
  return new Set(matches);
}

function computeJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function computeBlockSimilarity(
  beforeRange: IndexedTopLevelBlockRange,
  afterRange: IndexedTopLevelBlockRange,
): number {
  if (beforeRange.node.type.name !== afterRange.node.type.name) return 0;

  const beforeTokens = tokenizeBlockText(beforeRange.node.textContent);
  const afterTokens = tokenizeBlockText(afterRange.node.textContent);
  return computeJaccardSimilarity(beforeTokens, afterTokens);
}

function findExactEqLcsPairs(
  beforeRanges: IndexedTopLevelBlockRange[],
  afterRanges: IndexedTopLevelBlockRange[],
): BlockPositionPair[] {
  const beforeCount = beforeRanges.length;
  const afterCount = afterRanges.length;
  const dp = Array.from({ length: beforeCount + 1 }, () =>
    new Array<number>(afterCount + 1).fill(0),
  );

  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      if (beforeRanges[i].node.eq(afterRanges[j].node)) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const pairs: BlockPositionPair[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeCount && j < afterCount) {
    if (beforeRanges[i].node.eq(afterRanges[j].node)) {
      pairs.push({
        beforePosition: i,
        afterPosition: j,
      });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

function findOrderedSimilarityPairs(
  beforeRanges: IndexedTopLevelBlockRange[],
  afterRanges: IndexedTopLevelBlockRange[],
): Array<{ beforeIndex: number; afterIndex: number }> {
  if (beforeRanges.length === 0 || afterRanges.length === 0) return [];

  const beforeCount = beforeRanges.length;
  const afterCount = afterRanges.length;
  const similarityCache = new Map<string, number>();
  const getSimilarity = (i: number, j: number): number => {
    const key = `${i}:${j}`;
    const cached = similarityCache.get(key);
    if (cached !== undefined) return cached;

    const similarity = computeBlockSimilarity(beforeRanges[i], afterRanges[j]);
    similarityCache.set(key, similarity);
    return similarity;
  };

  const dp = Array.from({ length: beforeCount + 1 }, () =>
    new Array<number>(afterCount + 1).fill(0),
  );

  for (let i = beforeCount - 1; i >= 0; i -= 1) {
    for (let j = afterCount - 1; j >= 0; j -= 1) {
      const skipBefore = dp[i + 1][j];
      const skipAfter = dp[i][j + 1];
      let best = Math.max(skipBefore, skipAfter);

      const similarity = getSimilarity(i, j);
      if (similarity >= BLOCK_SIMILARITY_THRESHOLD) {
        best = Math.max(best, similarity + dp[i + 1][j + 1]);
      }

      dp[i][j] = best;
    }
  }

  const pairs: Array<{ beforeIndex: number; afterIndex: number }> = [];
  let i = 0;
  let j = 0;
  while (i < beforeCount && j < afterCount) {
    const similarity = getSimilarity(i, j);
    const canMatch = similarity >= BLOCK_SIMILARITY_THRESHOLD;
    const matchScore = canMatch ? similarity + dp[i + 1][j + 1] : -Infinity;
    const skipBefore = dp[i + 1][j];
    const skipAfter = dp[i][j + 1];

    if (
      canMatch &&
      matchScore >= skipBefore - SIMILARITY_EPSILON &&
      matchScore >= skipAfter - SIMILARITY_EPSILON
    ) {
      pairs.push({
        beforeIndex: beforeRanges[i].index,
        afterIndex: afterRanges[j].index,
      });
      i += 1;
      j += 1;
      continue;
    }

    if (skipBefore >= skipAfter) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

function collectContiguousRuns(indexes: number[]): Array<{ start: number; end: number }> {
  if (indexes.length === 0) return [];

  const sorted = [...indexes].sort((a, b) => a - b);
  const runs: Array<{ start: number; end: number }> = [];
  let runStart = sorted[0];
  let runEnd = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === runEnd + 1) {
      runEnd = current;
      continue;
    }

    runs.push({ start: runStart, end: runEnd });
    runStart = current;
    runEnd = current;
  }

  runs.push({ start: runStart, end: runEnd });
  return runs;
}

function resolveDeletionAnchorAfterIndex(
  deletedBeforeIndex: number,
  sortedMatchedBeforeIndexes: number[],
  beforeToAfterIndex: Map<number, number>,
  afterTopLevelRanges: IndexedTopLevelBlockRange[],
): number | null {
  for (const matchedBeforeIndex of sortedMatchedBeforeIndexes) {
    if (matchedBeforeIndex > deletedBeforeIndex) {
      return beforeToAfterIndex.get(matchedBeforeIndex) ?? null;
    }
  }

  for (let i = sortedMatchedBeforeIndexes.length - 1; i >= 0; i -= 1) {
    const matchedBeforeIndex = sortedMatchedBeforeIndexes[i];
    if (matchedBeforeIndex < deletedBeforeIndex) {
      return beforeToAfterIndex.get(matchedBeforeIndex) ?? null;
    }
  }

  if (afterTopLevelRanges.length === 0) return null;

  const fallbackPosition = Math.max(
    0,
    Math.min(deletedBeforeIndex, afterTopLevelRanges.length - 1),
  );
  return afterTopLevelRanges[fallbackPosition]?.index ?? null;
}

function alignTopLevelBlocks(
  beforeTopLevelRanges: IndexedTopLevelBlockRange[],
  afterTopLevelRanges: IndexedTopLevelBlockRange[],
): BlockAlignment {
  const afterToBeforeIndex = new Map<number, number>();
  const exactPairs = findExactEqLcsPairs(beforeTopLevelRanges, afterTopLevelRanges);

  for (const pair of exactPairs) {
    const beforeIndex = beforeTopLevelRanges[pair.beforePosition]?.index;
    const afterIndex = afterTopLevelRanges[pair.afterPosition]?.index;
    if (beforeIndex === undefined || afterIndex === undefined) continue;
    afterToBeforeIndex.set(afterIndex, beforeIndex);
  }

  const anchors: BlockPositionPair[] = [
    { beforePosition: -1, afterPosition: -1 },
    ...exactPairs,
    {
      beforePosition: beforeTopLevelRanges.length,
      afterPosition: afterTopLevelRanges.length,
    },
  ];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const current = anchors[i];
    const next = anchors[i + 1];
    const beforeSegment = beforeTopLevelRanges.slice(
      current.beforePosition + 1,
      next.beforePosition,
    );
    const afterSegment = afterTopLevelRanges.slice(
      current.afterPosition + 1,
      next.afterPosition,
    );

    const similarPairs = findOrderedSimilarityPairs(beforeSegment, afterSegment);
    for (const pair of similarPairs) {
      if (!afterToBeforeIndex.has(pair.afterIndex)) {
        afterToBeforeIndex.set(pair.afterIndex, pair.beforeIndex);
      }
    }
  }

  const matchedBeforeIndexes = new Set(afterToBeforeIndex.values());
  const newAfterIndexes = new Set<number>();
  for (const range of afterTopLevelRanges) {
    if (!afterToBeforeIndex.has(range.index)) {
      newAfterIndexes.add(range.index);
    }
  }

  const unmatchedBeforeIndexes = beforeTopLevelRanges
    .map((range) => range.index)
    .filter((index) => !matchedBeforeIndexes.has(index));
  const unmatchedBeforeRuns = collectContiguousRuns(unmatchedBeforeIndexes);

  const beforeToAfterIndex = new Map<number, number>();
  for (const [afterIndex, beforeIndex] of afterToBeforeIndex.entries()) {
    beforeToAfterIndex.set(beforeIndex, afterIndex);
  }
  const sortedMatchedBeforeIndexes = Array.from(beforeToAfterIndex.keys()).sort(
    (a, b) => a - b,
  );

  const deletionAnchorAfterIndexes = new Set<number>();
  for (const run of unmatchedBeforeRuns) {
    const anchorAfterIndex = resolveDeletionAnchorAfterIndex(
      run.start,
      sortedMatchedBeforeIndexes,
      beforeToAfterIndex,
      afterTopLevelRanges,
    );
    if (anchorAfterIndex !== null) {
      deletionAnchorAfterIndexes.add(anchorAfterIndex);
    }
  }

  return {
    afterToBeforeIndex,
    newAfterIndexes,
    deletionAnchorAfterIndexes,
  };
}

function findDeletedBeforeBlocksForChange<Data = string>(
  change: ChangeJSON<Data>,
  beforeTopLevelRanges: IndexedTopLevelBlockRange[],
): IndexedTopLevelBlockRange[] {
  const deletedFrom = Math.min(change.fromA, change.toA);
  const deletedTo = Math.max(change.fromA, change.toA);
  if (deletedTo <= deletedFrom) return [];

  return beforeTopLevelRanges.filter((range) => {
    const startsBeforeOrAtBlock = deletedFrom <= range.from + 1;
    const endsAfterOrAtBlock = deletedTo >= range.to - 1;
    return startsBeforeOrAtBlock && endsAfterOrAtBlock;
  });
}

function inferChangeKind<Data = string>(
  change: ChangeJSON<Data>,
  beforeTopLevelRanges: IndexedTopLevelBlockRange[],
): AiEditChangeKind {
  const insertedLength = Math.max(0, change.toB - change.fromB);
  const deletedLength = Math.max(0, change.toA - change.fromA);

  if (insertedLength > 0 && deletedLength === 0) {
    return "add";
  }

  if (insertedLength === 0 && deletedLength > 0) {
    const containsDeletedTopLevelBlock = beforeTopLevelRanges.some(
      // In practice, deleted block spans are often shifted by +1 at the start
      // compared with top-level offsets, so allow that tolerance.
      (range) => change.fromA <= range.from + 1 && change.toA >= range.to,
    );

    if (containsDeletedTopLevelBlock) {
      return "delete-block";
    }
  }

  return "modify";
}

function parseSnapshot(
  schema: Schema,
  snapshot: JSONContent,
  label: "before" | "after",
): ProseMirrorNode {
  try {
    return schema.nodeFromJSON(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid ${label} snapshot for the provided schema: ${message}`,
    );
  }
}

function buildOriginalBlock(
  beforeTopLevelRanges: IndexedTopLevelBlockRange[],
  changes: AiEditRawChange<unknown>[],
  relatedChangeIndexes: number[],
): JSONContent | null {
  if (relatedChangeIndexes.length === 0) return null;

  const hasNonAddChange = relatedChangeIndexes.some(
    (index) => changes[index]?.kind !== "add",
  );
  if (!hasNonAddChange) return null;

  const candidateScores = new Map<number, number>();
  const addCandidate = (candidate: IndexedTopLevelBlockRange | null) => {
    if (!candidate) return;
    candidateScores.set(
      candidate.index,
      (candidateScores.get(candidate.index) ?? 0) + 1,
    );
  };

  for (const changeIndex of relatedChangeIndexes) {
    const change = changes[changeIndex];
    if (!change) continue;

    if (change.toA > change.fromA) {
      const overlapping = beforeTopLevelRanges.filter((range) =>
        overlapsRange(range, change.fromA, change.toA),
      );
      if (overlapping.length > 0) {
        for (const candidate of overlapping) {
          addCandidate(candidate);
        }
        continue;
      }
    }

    if (change.kind !== "add") {
      addCandidate(
        findNearestBlockForCollapsedPosition(beforeTopLevelRanges, change.fromA),
      );
    }
  }

  if (candidateScores.size === 0) return null;

  const [strongestIndex] = Array.from(candidateScores.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const strongestRange = beforeTopLevelRanges.find(
    (range) => range.index === strongestIndex,
  );

  return strongestRange?.node.toJSON() ?? null;
}

export function listAiEditRawChanges<Data = string>({
  schema,
  before,
  after,
  metadata,
}: AiEditDiffInput<Data>): AiEditRawChange<Data>[] {
  const beforeDoc = parseSnapshot(schema, before, "before");
  const afterDoc = parseSnapshot(schema, after, "after");

  if (beforeDoc.eq(afterDoc)) {
    return [];
  }

  const fullDocMap = new StepMap([
    0,
    beforeDoc.content.size,
    afterDoc.content.size,
  ]);
  const metadataValue = metadata ?? ("ai-edit" as Data);
  const changeSet = ChangeSet.create<Data>(beforeDoc).addSteps(
    afterDoc,
    [fullDocMap],
    metadataValue,
  );
  const simplified = simplifyChanges(changeSet.changes, afterDoc);
  const beforeTopLevelRanges = getTopLevelBlockRanges(beforeDoc);

  return simplified.map((change) => {
    const jsonChange = change.toJSON();
    return {
      ...jsonChange,
      kind: inferChangeKind(jsonChange, beforeTopLevelRanges),
      deletedText:
        jsonChange.toA > jsonChange.fromA
          ? beforeDoc.textBetween(
              jsonChange.fromA,
              jsonChange.toA,
              "\n",
              "\n",
            )
          : "",
    };
  });
}

export function createAiDiffSession<Data = string>({
  schema,
  before,
  after,
  metadata,
}: AiEditDiffInput<Data>): AiDiffSession<Data> | null {
  const beforeDoc = parseSnapshot(schema, before, "before");
  const afterDoc = parseSnapshot(schema, after, "after");
  const changes = listAiEditRawChanges({
    schema,
    before,
    after,
    metadata,
  });

  if (changes.length === 0) return null;

  const afterTopLevelRanges = getTopLevelBlockRanges(afterDoc);
  const beforeTopLevelRanges = getTopLevelBlockRanges(beforeDoc);
  const alignment = alignTopLevelBlocks(beforeTopLevelRanges, afterTopLevelRanges);
  const beforeToAfterIndex = new Map<number, number>();
  for (const [afterIndex, beforeIndex] of alignment.afterToBeforeIndex.entries()) {
    beforeToAfterIndex.set(beforeIndex, afterIndex);
  }
  const sortedMatchedBeforeIndexes = Array.from(beforeToAfterIndex.keys()).sort(
    (a, b) => a - b,
  );
  const afterRangesByIndex = new Map(
    afterTopLevelRanges.map((range) => [range.index, range] as const),
  );
  const beforeRangesByIndex = new Map(
    beforeTopLevelRanges.map((range) => [range.index, range] as const),
  );
  const isAfterRangeUnchanged = (range: IndexedTopLevelBlockRange): boolean => {
    const beforeIndex = alignment.afterToBeforeIndex.get(range.index);
    if (typeof beforeIndex !== "number") return false;
    const beforeRange = beforeRangesByIndex.get(beforeIndex);
    if (!beforeRange) return false;
    return beforeRange.node.eq(range.node);
  };

  if (afterTopLevelRanges.length === 0) {
    return {
      before,
      after,
      changes,
      blocks: [],
    };
  }

  type MutableBlock = {
    id: string;
    from: number;
    to: number;
    indicatorType?: AiDiffIndicatorType;
    hasDeletionAnchor: boolean;
    relatedChangeIndexes: Set<number>;
    sourceIndex: number;
    beforeSourceIndex?: number;
  };

  const touchedBlocks = new Map<string, MutableBlock>();

  const upsertTouchedBlock = (range: IndexedTopLevelBlockRange): MutableBlock => {
    const key = `${range.from}:${range.to}`;
    const existing = touchedBlocks.get(key);
    if (existing) return existing;

    const next: MutableBlock = {
      id: "",
      from: range.from,
      to: range.to,
      hasDeletionAnchor: false,
      relatedChangeIndexes: new Set(),
      sourceIndex: range.index,
      beforeSourceIndex: alignment.afterToBeforeIndex.get(range.index),
    };
    touchedBlocks.set(key, next);
    return next;
  };

  const markTouchedBlock = (
    range: IndexedTopLevelBlockRange,
    indicatorType: AiDiffIndicatorType,
    changeIndex: number,
  ) => {
    const block = upsertTouchedBlock(range);
    block.indicatorType = getMergedIndicatorType(
      block.indicatorType,
      indicatorType,
    );
    block.relatedChangeIndexes.add(changeIndex);
  };

  const markDeletionAnchor = (
    range: IndexedTopLevelBlockRange,
    changeIndex?: number,
  ) => {
    const block = upsertTouchedBlock(range);
    block.hasDeletionAnchor = true;
    if (typeof changeIndex === "number" && changeIndex >= 0) {
      block.relatedChangeIndexes.add(changeIndex);
    }
  };

  const markDeletionAnchorByAfterIndex = (
    afterIndex: number,
    changeIndex?: number,
  ) => {
    const range = afterRangesByIndex.get(afterIndex);
    if (!range) return;
    markDeletionAnchor(range, changeIndex);
  };

  for (const afterIndex of alignment.deletionAnchorAfterIndexes) {
    markDeletionAnchorByAfterIndex(afterIndex);
  }

  for (const [changeIndex, change] of changes.entries()) {
    const changeFrom = Math.max(0, Math.min(change.fromB, afterDoc.content.size));
    const changeTo = Math.max(0, Math.min(change.toB, afterDoc.content.size));
    const deletedBeforeBlocks = findDeletedBeforeBlocksForChange(
      change,
      beforeTopLevelRanges,
    );

    if (deletedBeforeBlocks.length > 0) {
      for (const deletedBeforeBlock of deletedBeforeBlocks) {
        if (beforeToAfterIndex.has(deletedBeforeBlock.index)) {
          continue;
        }

        const anchorAfterIndex = resolveDeletionAnchorAfterIndex(
          deletedBeforeBlock.index,
          sortedMatchedBeforeIndexes,
          beforeToAfterIndex,
          afterTopLevelRanges,
        );
        if (anchorAfterIndex !== null) {
          markDeletionAnchorByAfterIndex(anchorAfterIndex, changeIndex);
        }
      }
    }

    if (change.kind === "delete-block" && changeTo === changeFrom) {
      if (deletedBeforeBlocks.length === 0) {
        const nearestTopLevel = findNearestBlockForCollapsedPosition(
          afterTopLevelRanges,
          changeFrom,
        );
        if (nearestTopLevel) {
          markDeletionAnchor(nearestTopLevel, changeIndex);
        }
      }
      continue;
    }

    if (changeTo > changeFrom) {
      for (const range of findContainingRanges(
        afterTopLevelRanges,
        changeFrom,
        changeTo,
      )) {
        if (isAfterRangeUnchanged(range)) {
          continue;
        }

        const indicatorType: AiDiffIndicatorType = alignment.newAfterIndexes.has(
          range.index,
        )
          ? "add"
          : "modify";
        markTouchedBlock(range, indicatorType, changeIndex);
      }
      continue;
    }

    if (deletedBeforeBlocks.length > 0 || change.kind === "delete-block") continue;

    const nearestTopLevel = findNearestBlockForCollapsedPosition(
      afterTopLevelRanges,
      changeFrom,
    );
    if (nearestTopLevel) {
      const indicatorType: AiDiffIndicatorType = alignment.newAfterIndexes.has(
        nearestTopLevel.index,
      )
        ? "add"
        : "modify";
      markTouchedBlock(nearestTopLevel, indicatorType, changeIndex);
    }
  }

  const blocks = Array.from(touchedBlocks.values())
    .sort((a, b) => a.from - b.from)
    .map((block) => {
      const relatedChangeIndexes = Array.from(block.relatedChangeIndexes).sort(
        (a, b) => a - b,
      );
      const idSuffix =
        relatedChangeIndexes.length > 0
          ? relatedChangeIndexes.join("-")
          : `anchor-${block.sourceIndex}`;

      const nextBlock: AiDiffBlock = {
        id: `ai-diff-block-${block.sourceIndex}-${idSuffix}`,
        from: block.from,
        to: block.to,
        blockType:
          afterTopLevelRanges.find((range) => range.index === block.sourceIndex)
            ?.node.type.name ?? "unknown",
        indicatorType: block.indicatorType,
        hasDeletionAnchor: block.hasDeletionAnchor,
        relatedChangeIndexes,
        originalBlock:
          (typeof block.beforeSourceIndex === "number"
            ? beforeRangesByIndex.get(block.beforeSourceIndex)?.node.toJSON() ??
              null
            : null) ??
          buildOriginalBlock(beforeTopLevelRanges, changes, relatedChangeIndexes),
      };

      block.id = nextBlock.id;
      return nextBlock;
    });

  return {
    before,
    after,
    changes,
    blocks,
  };
}
