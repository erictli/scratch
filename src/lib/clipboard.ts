import type { Slice } from "@tiptap/pm/model";

/**
 * Whether every text node in a copied slice is code.
 *
 * Checking the slice instead of the selection parent also covers code blocks
 * nested in lists and selections that span multiple code nodes.
 */
export function isCodeOnlySlice(slice: Slice): boolean {
  let hasCodeText = false;
  let hasNonCodeText = false;

  slice.content.nodesBetween(0, slice.content.size, (node, _pos, parent) => {
    if (!node.isText || !node.textContent) return;

    const isCode =
      parent?.type.name === "codeBlock" ||
      node.marks.some((mark) => mark.type.name === "code");
    if (isCode) {
      hasCodeText = true;
    } else {
      hasNonCodeText = true;
    }
  });

  return hasCodeText && !hasNonCodeText;
}
