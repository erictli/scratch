import { Extension } from "@tiptap/core";
import {
  AllSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const scratchTextSelectionPluginKey = new PluginKey(
  "scratchTextSelection",
);
const scratchTextSelectionAttributes = {
  class: "scratch-text-selection",
};

export const ScratchTextSelection = Extension.create({
  name: "scratchTextSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: scratchTextSelectionPluginKey,
        props: {
          decorations(state) {
            const { selection } = state;

            if (selection instanceof AllSelection) {
              const decorations: Decoration[] = [];

              state.doc.descendants((node, position) => {
                if (node.isText) {
                  decorations.push(
                    Decoration.inline(position, position + node.nodeSize, {
                      ...scratchTextSelectionAttributes,
                    }),
                  );
                }
              });

              return DecorationSet.create(state.doc, decorations);
            }

            if (selection instanceof TextSelection && !selection.empty) {
              return DecorationSet.create(state.doc, [
                Decoration.inline(
                  selection.from,
                  selection.to,
                  scratchTextSelectionAttributes,
                ),
              ]);
            }

            return DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
