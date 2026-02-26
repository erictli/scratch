import { InputRule, type CommandProps } from "@tiptap/core";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    scratchInlineMath: {
      toggleInlineMath: () => ReturnType;
    };
    scratchBlockMath: {
      toggleBlockMath: () => ReturnType;
    };
  }
}

function normalizeInlineMath(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\$([^$\n]+)\$$/);
  return (match?.[1] ?? trimmed).trim();
}

export function normalizeBlockMath(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\$\$([\s\S]*?)\$\$$/);
  return (match?.[1] ?? trimmed).trim();
}

function findSelectedBlockMathNode(
  state: EditorState,
  nodeTypeName: string,
): { from: number; to: number; node: PMNode } | null {
  const { selection, doc } = state;
  const { from, to, empty, $from } = selection;

  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === nodeTypeName
  ) {
    return { from, to, node: selection.node };
  }

  if (!empty) {
    const selectedNode = doc.nodeAt(from);
    if (
      selectedNode?.type.name === nodeTypeName &&
      from + selectedNode.nodeSize === to
    ) {
      return { from, to, node: selectedNode };
    }
    return null;
  }

  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type.name === nodeTypeName) {
    const nodeFrom = from - nodeBefore.nodeSize;
    return { from: nodeFrom, to: from, node: nodeBefore };
  }

  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === nodeTypeName) {
    const nodeTo = from + nodeAfter.nodeSize;
    return { from, to: nodeTo, node: nodeAfter };
  }

  return null;
}

export const ScratchInlineMath = InlineMath.extend({
  addCommands() {
    const parentCommands = this.parent?.();

    return {
      ...parentCommands,
      toggleInlineMath:
        () =>
        ({ editor, commands }: CommandProps) => {
          const { selection, doc } = editor.state;
          const { from, to, empty } = selection;
          if (empty) return false;

          if (
            selection instanceof NodeSelection &&
            selection.node.type.name === this.name
          ) {
            const latex = String(selection.node.attrs.latex ?? "");
            return commands.insertContentAt(
              {
                from,
                to,
              },
              latex,
            );
          }

          const selectedNode = doc.nodeAt(from);
          if (
            selectedNode?.type.name === this.name &&
            from + selectedNode.nodeSize === to
          ) {
            const latex = String(selectedNode.attrs.latex ?? "");
            return commands.insertContentAt({ from, to }, latex);
          }

          const selectedText = doc.textBetween(from, to, " ");
          const latex = normalizeInlineMath(selectedText);
          if (!latex) return false;

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

export const ScratchBlockMath = BlockMath.extend({
  addCommands() {
    const parentCommands = this.parent?.();

    return {
      ...parentCommands,
      toggleBlockMath:
        () =>
        ({ editor, commands }: CommandProps) => {
          const existingMathNode = findSelectedBlockMathNode(
            editor.state,
            this.name,
          );
          if (existingMathNode) {
            const latex = String(existingMathNode.node.attrs.latex ?? "");
            return commands.insertContentAt(
              {
                from: existingMathNode.from,
                to: existingMathNode.to,
              },
              latex,
            );
          }

          const { from, to, empty } = editor.state.selection;
          const selectedText = empty
            ? ""
            : editor.state.doc.textBetween(from, to, "\n");
          const latex = normalizeBlockMath(selectedText);
          if (!latex) return false;

          return commands.insertContentAt(
            { from, to },
            {
              type: this.name,
              attrs: { latex },
            },
          );
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = (match[1] ?? "").trim();
          if (!latex) return;

          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex }),
          );
        },
      }),
    ];
  },
});
