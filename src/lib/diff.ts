import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { StepMap } from "@tiptap/pm/transform";
import { ChangeSet, simplifyChanges } from "prosemirror-changeset";

export interface VersionDiffChange {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  deletedText: string;
}

export interface VersionDiffResult {
  changes: VersionDiffChange[];
}

export interface VersionDiffStats {
  added: number;
  removed: number;
  changed: number;
}

function splitVisibleLines(text: string): string[] {
  const normalized = text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
  return normalized === "" ? [] : normalized.split("\n");
}

function extractVisibleText(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string {
  if (to <= from) return "";

  const text = doc.textBetween(from, to, "\n", "\n");
  if (text.trim().length > 0) {
    return text;
  }

  const labels: string[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.isBlock && !node.isTextblock && node.type.name !== "doc") {
      labels.push(
        node.type.name === "horizontalRule" ? "───" : `[${node.type.name}]`,
      );
    }
    return true;
  });
  return labels.join(" ");
}

/**
 * Compute changes between two ProseMirror documents using prosemirror-changeset.
 * Returns change ranges in both old (A) and new (B) document coordinate spaces.
 */
export function computeVersionDiff(
  beforeDoc: ProseMirrorNode,
  afterDoc: ProseMirrorNode,
): VersionDiffResult | null {
  if (beforeDoc.eq(afterDoc)) {
    return { changes: [] };
  }

  try {
    const fullDocMap = new StepMap([
      0,
      beforeDoc.content.size,
      afterDoc.content.size,
    ]);

    const changeSet = ChangeSet.create(beforeDoc).addSteps(
      afterDoc,
      [fullDocMap],
      "version-diff",
    );

    const simplified = simplifyChanges(changeSet.changes, afterDoc);

    const changes: VersionDiffChange[] = simplified.map((change) => {
      const json = change.toJSON();

      // Build a human-readable representation of deleted content
      let deletedText = "";
      if (json.toA > json.fromA) {
        // Try textBetween first for text content
        const text = beforeDoc.textBetween(json.fromA, json.toA, "\n", "\n");
        if (text.trim().length > 0) {
          deletedText = text;
        } else {
          // For non-text nodes (hr, images, etc.), describe the deleted nodes
          const labels: string[] = [];
          beforeDoc.nodesBetween(json.fromA, json.toA, (node) => {
            if (node.isBlock && !node.isTextblock && node.type.name !== "doc") {
              labels.push(node.type.name === "horizontalRule" ? "───" : `[${node.type.name}]`);
            }
            return true;
          });
          deletedText = labels.join(" ");
        }
      }

      return {
        fromA: json.fromA,
        toA: json.toA,
        fromB: json.fromB,
        toB: json.toB,
        deletedText,
      };
    });

    return { changes };
  } catch (err) {
    console.error("computeVersionDiff failed:", err);
    return null;
  }
}

export function computeVersionDiffStats(
  beforeDoc: ProseMirrorNode,
  afterDoc: ProseMirrorNode,
): VersionDiffStats | null {
  const result = computeVersionDiff(beforeDoc, afterDoc);
  if (!result) return null;

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const change of result.changes) {
    const deletedLines = splitVisibleLines(change.deletedText);
    const insertedLines = splitVisibleLines(
      extractVisibleText(afterDoc, change.fromB, change.toB),
    );

    const changedLines = Math.min(deletedLines.length, insertedLines.length);
    changed += changedLines;
    removed += deletedLines.length - changedLines;
    added += insertedLines.length - changedLines;
  }

  return { added, removed, changed };
}

/**
 * Parse a JSON snapshot into a ProseMirror document node.
 */
export function parseSnapshot(
  schema: Schema,
  json: Record<string, unknown>,
): ProseMirrorNode {
  return schema.nodeFromJSON(json);
}
