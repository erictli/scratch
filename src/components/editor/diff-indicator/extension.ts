import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

type DecorationPluginMeta = {
  decorationSet: DecorationSet;
};

export const aiDiffIndicatorPluginKey = new PluginKey<DecorationSet>(
  "aiDiffIndicator",
);
export const aiDiffWordDiffPluginKey = new PluginKey<DecorationSet>(
  "aiDiffWordDiff",
);

function getDecorationSetFromMeta(
  transaction: Transaction,
  key: PluginKey<DecorationSet>,
): DecorationSet | null {
  const meta = transaction.getMeta(key) as DecorationPluginMeta | undefined;
  return meta?.decorationSet ?? null;
}

function createDecorationPlugin(key: PluginKey<DecorationSet>): Plugin {
  return new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, oldSet) => {
        const nextSet = getDecorationSetFromMeta(transaction, key);
        if (nextSet) return nextSet;
        return oldSet.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
}

export function dispatchDecorationSet(
  editor: TiptapEditor,
  key: PluginKey<DecorationSet>,
  decorationSet: DecorationSet,
): void {
  const transaction = editor.state.tr.setMeta(key, { decorationSet });
  editor.view.dispatch(transaction);
}

export const AiDiffIndicatorExtension = Extension.create({
  name: "aiDiffIndicator",

  addProseMirrorPlugins() {
    return [
      createDecorationPlugin(aiDiffIndicatorPluginKey),
      createDecorationPlugin(aiDiffWordDiffPluginKey),
    ];
  },
});
