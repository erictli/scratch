import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { Extension, InputRule, nodePasteRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { BlockMathView } from "./BlockMathView";
import { InlineMathView } from "./InlineMathView";
import { KATEX_OPTIONS, MATH_EDIT_EVENT } from "./mathConstants";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    setInlineMath: () => ReturnType;
  }
}


function mathEnterPlugin() {
  return new Plugin({
    key: new PluginKey("mathEnter"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter") return false;
        const { state } = view;
        const { selection } = state;
        if (!(selection instanceof NodeSelection)) return false;
        const node = selection.node;
        const name = node.type.name;
        if (name !== "blockMath" && name !== "inlineMath") return false;
        event.preventDefault();
        const dom = view.nodeDOM(selection.from);
        if (dom instanceof HTMLElement) {
          dom.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT));
        }
        return true;
      },
    },
  });
}

const BlockMathWithNodeView = BlockMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView);
  },
  
  addProseMirrorPlugins() {
    const blockMathType = this.type;
    return [
      new Plugin({
        key: new PluginKey("blockMathEnterShortcut"),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Enter") return false;
            const { state } = view;
            const { selection } = state;
            if (!(selection instanceof TextSelection)) return false;
            const { $from } = selection;
            const parent = $from.parent;
            if (parent.type.name !== "paragraph") return false;
            if (parent.textContent !== "$$") return false;

            event.preventDefault();
            const start = $from.before();
            const end = $from.after();
            const tr = state.tr.replaceWith(
              start,
              end,
              blockMathType.create({ latex: "" })
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

const InlineMathWithNodeView = InlineMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },
  addCommands() {
    return {
      // Align with inline code: wrap selection in inline math, or insert empty (like toggleCode).
      setInlineMath:
        () =>
        ({
          state,
          dispatch,
        }: {
          state: EditorState;
          dispatch: (tr: Transaction) => void;
        }) => {
          const { from, to } = state.selection;
          const latex =
            from === to ? "" : state.doc.textBetween(from, to, " ").trim();
          const node = this.type.create({ latex });
          const tr = state.tr.replaceWith(from, to, node);
          const posAfter = from + node.nodeSize;
          if (posAfter <= tr.doc.content.size) {
            tr.setSelection(TextSelection.near(tr.doc.resolve(posAfter), 1));
          }
          if (dispatch) dispatch(tr);
          return true;
        },
    } as Record<string, unknown>;
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () =>
        (this.editor.commands as unknown as { setInlineMath: () => boolean })
          .setInlineMath(),
    };
  },
  addInputRules() {
    return [
      // $...$ with content → inline math (like `...` for inline code)
      new InputRule({
        find: /(^|[^$\\])\$([^$\n]+?)\$$/,
        handler: ({ state, range, match }) => {
          const prefix = match[1] || "";
          const latex = match[2];
          if (!latex) return;
          const from = range.from + prefix.length;
          state.tr.replaceWith(
            from,
            range.to,
            this.type.create({ latex: latex.trim() })
          );
        },
      }),
    ];
  },
  addPasteRules() {
    return [
      nodePasteRule({
        find: /\$([^$\n]+?)\$/g,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1].trim() }),
      }),
    ];
  },
});

export const MathEditing = Extension.create({
  name: "mathEditing",
  addExtensions() {
    return [
      BlockMathWithNodeView.configure({ katexOptions: KATEX_OPTIONS }),
      InlineMathWithNodeView.configure({ katexOptions: KATEX_OPTIONS }),
    ];
  },
  addProseMirrorPlugins() {
    return [mathEnterPlugin()];
  },
});
