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

export interface AiDiffBlock {
  id: string;
  from: number;
  to: number;
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
    changeIndex: number,
  ) => {
    const block = upsertTouchedBlock(range);
    block.hasDeletionAnchor = true;
    block.relatedChangeIndexes.add(changeIndex);
  };

  for (const [changeIndex, change] of changes.entries()) {
    const changeFrom = Math.max(0, Math.min(change.fromB, afterDoc.content.size));
    const changeTo = Math.max(0, Math.min(change.toB, afterDoc.content.size));

    if (change.kind === "delete-block" && changeTo === changeFrom) {
      const nearestTopLevel = findNearestBlockForCollapsedPosition(
        afterTopLevelRanges,
        changeFrom,
      );
      if (nearestTopLevel) {
        markDeletionAnchor(nearestTopLevel, changeIndex);
      }
      continue;
    }

    if (changeTo > changeFrom) {
      for (const range of findContainingRanges(
        afterTopLevelRanges,
        changeFrom,
        changeTo,
      )) {
        const indicatorType: AiDiffIndicatorType =
          change.kind === "add" ? "add" : "modify";
        markTouchedBlock(range, indicatorType, changeIndex);
      }
      continue;
    }

    if (change.kind === "delete-block") continue;

    const nearestTopLevel = findNearestBlockForCollapsedPosition(
      afterTopLevelRanges,
      changeFrom,
    );
    if (nearestTopLevel) {
      markTouchedBlock(nearestTopLevel, "modify", changeIndex);
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
        indicatorType: block.indicatorType,
        hasDeletionAnchor: block.hasDeletionAnchor,
        relatedChangeIndexes,
        originalBlock: buildOriginalBlock(
          beforeTopLevelRanges,
          changes,
          relatedChangeIndexes,
        ),
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
