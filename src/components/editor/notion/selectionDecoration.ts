import { Extension } from "@tiptap/core";
import {
  AllSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface ScratchTextSelectionPluginState {
  editorFocused: boolean;
}

const scratchTextSelectionPluginKey =
  new PluginKey<ScratchTextSelectionPluginState>("scratchTextSelection");
const scratchTextSelectionAttributes = {
  class: "scratch-text-selection",
};

export const ScratchTextSelection = Extension.create({
  name: "scratchTextSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: scratchTextSelectionPluginKey,
        state: {
          init: () => ({ editorFocused: false }),
          apply(transaction, pluginState) {
            return (
              transaction.getMeta(scratchTextSelectionPluginKey) ?? pluginState
            );
          },
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              const pluginState =
                scratchTextSelectionPluginKey.getState(view.state);
              if (!pluginState?.editorFocused) {
                view.dispatch(
                  view.state.tr
                    .setMeta(scratchTextSelectionPluginKey, {
                      editorFocused: true,
                    })
                    .setMeta("addToHistory", false),
                );
              }
              return false;
            },
            blur(view) {
              const pluginState =
                scratchTextSelectionPluginKey.getState(view.state);
              if (pluginState?.editorFocused) {
                view.dispatch(
                  view.state.tr
                    .setMeta(scratchTextSelectionPluginKey, {
                      editorFocused: false,
                    })
                    .setMeta("addToHistory", false),
                );
              }
              return false;
            },
          },
          decorations(state) {
            if (
              scratchTextSelectionPluginKey.getState(state)?.editorFocused
            ) {
              return DecorationSet.empty;
            }

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
