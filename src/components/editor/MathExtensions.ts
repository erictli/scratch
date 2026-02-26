import { InputRule, type CommandProps } from "@tiptap/core";
import { InlineMath } from "@tiptap/extension-mathematics";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    scratchInlineMath: {
      toggleInlineMath: () => ReturnType;
    };
  }
}

function findInlineMathNode(
  state: EditorState,
  nodeTypeName: string,
): { pos: number; node: PMNode } | null {
  const { selection, doc } = state;
  const candidates = [
    selection.from,
    selection.$from.pos,
    selection.from - 1,
    selection.$from.pos - 1,
  ].filter((pos, index, all) => pos >= 0 && all.indexOf(pos) === index);

  for (const pos of candidates) {
    const node = doc.nodeAt(pos);
    if (node?.type.name === nodeTypeName) {
      return { pos, node };
    }
  }

  return null;
}

function normalizeInlineLatex(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\$([^$\n]+)\$$/);
  return (match?.[1] ?? trimmed).trim();
}

export const ScratchInlineMath = InlineMath.extend({
  addCommands() {
    const parentCommands = this.parent?.();

    return {
      ...parentCommands,
      toggleInlineMath:
        () =>
        ({ editor, commands }: CommandProps) => {
          const existingMathNode = findInlineMathNode(editor.state, this.name);
          if (existingMathNode) {
            const latex = String(existingMathNode.node.attrs.latex ?? "");
            return commands.insertContentAt(
              {
                from: existingMathNode.pos,
                to: existingMathNode.pos + existingMathNode.node.nodeSize,
              },
              latex,
            );
          }

          const { from, to, empty } = editor.state.selection;
          if (empty) return false;

          const selectedText = editor.state.doc.textBetween(from, to, " ");
          const latex = normalizeInlineLatex(selectedText) || "x^2";

          if (!commands.deleteSelection()) {
            return false;
          }

          if (!commands.insertInlineMath({ latex, pos: from })) {
            return false;
          }

          commands.setNodeSelection(from);
          return true;
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(^|[^$])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const prefix = match[1] ?? "";
          const latex = (match[2] ?? "").trim();
          if (!latex) return;

          const start = range.from + prefix.length;
          const end = range.to;
          state.tr.replaceWith(start, end, this.type.create({ latex }));
        },
      }),
    ];
  },
});
