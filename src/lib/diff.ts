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

export type AiEditRawChange<Data = string> = ChangeJSON<Data>;

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

  return changeset.changes.map((change) => change.toJSON());
}
