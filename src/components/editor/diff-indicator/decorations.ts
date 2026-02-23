import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { AiDiffSession } from "../../../lib/diff";

const CODE_BLOCK_DELETE_TEXT_LIMIT = 240;
const DEFAULT_DELETE_TEXT_LIMIT = 80;

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

  const docSize = doc.content.size;
  const blockFrom = clampPosition(activeBlock.from, docSize);
  const blockTo = clampPosition(activeBlock.to, docSize);
  if (blockTo <= blockFrom) return [];

  const blockContentFrom = Math.min(blockTo, blockFrom + 1);
  const blockContentTo = Math.max(blockContentFrom, blockTo - 1);
  const decorations: Decoration[] = [];

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
      : DEFAULT_DELETE_TEXT_LIMIT;
    const shouldRenderDeletedWidget =
      change.deletedText.length > 0 &&
      change.deletedText.length <= maxDeleteTextLength &&
      (isCodeLikeBlock || !change.deletedText.includes("\n"));

    if (!shouldRenderDeletedWidget) continue;

    const anchor = Math.max(
      blockContentFrom,
      Math.min(clampPosition(change.fromB, docSize), blockContentTo),
    );
    decorations.push(
      Decoration.widget(
        anchor,
        () => createDeletedWidget(change.deletedText, isCodeLikeBlock),
        {
          side: -1,
          ignoreSelection: true,
        },
      ),
    );
  }

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
