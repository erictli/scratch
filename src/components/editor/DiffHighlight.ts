import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { VersionDiffChange } from "../../lib/diff";

export const diffHighlightPluginKey = new PluginKey("diffHighlight");

export const DiffHighlight = Extension.create({
  name: "diffHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: diffHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, oldSet) => {
            const meta = tr.getMeta(diffHighlightPluginKey);
            if (meta?.decorationSet) {
              return meta.decorationSet;
            }
            return oldSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => {
            return diffHighlightPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

function isInlineAnchor(doc: ProseMirrorNode, pos: number): boolean {
  try {
    const resolved = doc.resolve(pos);
    return resolved.parent.isTextblock && resolved.parent.inlineContent;
  } catch {
    return false;
  }
}

/**
 * Search outward from `pos` for the nearest position inside a textblock.
 * Searches up to `maxSteps` in each direction within [min, max].
 */
function findNearestInlineAnchor(
  doc: ProseMirrorNode,
  pos: number,
  min: number,
  max: number,
): number | null {
  const lo = Math.max(0, min);
  const hi = Math.min(max, doc.content.size);
  const p = Math.max(lo, Math.min(pos, hi));

  if (isInlineAnchor(doc, p)) return p;

  const maxSteps = Math.min(200, hi - lo);
  for (let step = 1; step <= maxSteps; step++) {
    if (p - step >= lo && isInlineAnchor(doc, p - step)) return p - step;
    if (p + step <= hi && isInlineAnchor(doc, p + step)) return p + step;
  }
  return null;
}

/**
 * Build and apply decorations for version diff changes on the CURRENT document.
 * - Insertions (fromB < toB): inline decorations with green background
 * - Deletions (deletedText): widget decorations with red strikethrough
 */
export function applyVersionDiffDecorations(
  changes: VersionDiffChange[],
  editor: TiptapEditor,
): void {
  const doc = editor.state.doc;
  const docSize = doc.content.size;
  const decorations: Decoration[] = [];

  for (const change of changes) {
    const insertedFrom = clamp(change.fromB, docSize);
    const insertedTo = clamp(change.toB, docSize);

    // Inserted text → inline decoration (green)
    if (insertedTo > insertedFrom) {
      decorations.push(
        Decoration.inline(insertedFrom, insertedTo, { class: "diff-insert" }),
      );
    }

    // Deleted text → widget decoration (red strikethrough)
    // Skip whitespace-only deletions (invisible, usually trailing newlines)
    if (change.deletedText.length > 0 && change.deletedText.trim().length > 0) {
      // Search the entire document for a valid anchor
      const anchorPos = findNearestInlineAnchor(
        doc,
        clamp(change.fromB, docSize),
        0,
        docSize,
      );

      if (anchorPos !== null) {
        const widget = document.createElement("span");
        widget.className = "diff-delete";
        widget.textContent = change.deletedText;
        decorations.push(
          Decoration.widget(anchorPos, widget, {
            side: -1,
            ignoreSelection: true,
          }),
        );
      }
    }
  }

  if (decorations.length === 0) return;

  const decorationSet = DecorationSet.create(doc, decorations);
  const tr = editor.state.tr.setMeta(diffHighlightPluginKey, {
    decorationSet,
  });
  editor.view.dispatch(tr);
}

export function clearDiffDecorations(editor: TiptapEditor): void {
  const tr = editor.state.tr.setMeta(diffHighlightPluginKey, {
    decorationSet: DecorationSet.empty,
  });
  editor.view.dispatch(tr);
}
