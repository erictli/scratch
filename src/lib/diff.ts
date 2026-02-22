import type { JSONContent } from "@tiptap/core";
import type { Schema, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { StepMap } from "@tiptap/pm/transform";
import { ChangeSet, type ChangeJSON } from "prosemirror-changeset";

export interface AiEditDiffInput<Data = string> {
  schema: Schema;
  before: JSONContent;
  after: JSONContent;
  metadata?: Data;
}

export type AiEditChangeKind = "add" | "modify" | "delete-block";

export type AiEditRawChange<Data = string> = ChangeJSON<Data> & {
  kind: AiEditChangeKind;
};

type BlockRange = {
  from: number;
  to: number;
};

function getTopLevelBlockRanges(doc: ProseMirrorNode): BlockRange[] {
  const ranges: BlockRange[] = [];

  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    ranges.push({
      from: offset,
      to: offset + node.nodeSize,
    });
  });

  return ranges;
}

function inferChangeKind<Data = string>(
  change: ChangeJSON<Data>,
  beforeTopLevelRanges: BlockRange[],
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

  const fullDocMap = new StepMap([0, beforeDoc.content.size, afterDoc.content.size]);
  const metadataValue = (metadata ?? ("ai-edit" as Data));
  const changeset = ChangeSet.create<Data>(beforeDoc).addSteps(
    afterDoc,
    [fullDocMap],
    metadataValue,
  );
  const beforeTopLevelRanges = getTopLevelBlockRanges(beforeDoc);

  return changeset.changes.map((change) => {
    const jsonChange = change.toJSON();
    return {
      ...jsonChange,
      kind: inferChangeKind(jsonChange, beforeTopLevelRanges),
    };
  });
}
