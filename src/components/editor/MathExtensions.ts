import { InputRule } from "@tiptap/core";
import { BlockMath } from "@tiptap/extension-mathematics";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";

export function normalizeBlockMath(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\$\$([\s\S]*?)\$\$$/);
  return (match?.[1] ?? trimmed).trim();
}

export const ScratchBlockMath = BlockMath.extend({
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

  addProseMirrorPlugins() {
    const onClick = this.options.onClick;
    return [
      new Plugin({
        key: new PluginKey("blockMathSelection"),
        view() {
          return {
            // Clear native DOM selection when a blockMath node is selected.
            // ProseMirror's NodeSelection sets a DOM selection that spans all
            // content before the atom node, causing a visible highlight bleed.
            update(view) {
              const { selection } = view.state;
              if (
                selection instanceof NodeSelection &&
                selection.node.type.name === "blockMath"
              ) {
                window.getSelection()?.removeAllRanges();
              }
            },
          };
        },
        props: {
          // Open editor on Enter or Space when a blockMath node is selected
          handleKeyDown(view, event) {
            if (event.key !== "Enter" && event.key !== " ") return false;
            const { selection } = view.state;
            if (
              selection instanceof NodeSelection &&
              selection.node.type.name === "blockMath" &&
              onClick
            ) {
              event.preventDefault();
              onClick(selection.node, selection.from);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
