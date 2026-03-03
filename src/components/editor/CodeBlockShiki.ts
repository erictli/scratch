import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { HighlighterCore } from "shiki/core";
import { getHighlighterSync, normalizeLanguage } from "../../lib/shiki";

export const codeBlockShikiPluginKey = new PluginKey<PluginState>(
  "codeBlockShiki",
);

interface PluginState {
  decorations: DecorationSet;
  isDark: boolean;
}

/** Build ProseMirror inline decorations from Shiki token colors. */
function buildDecorations(
  doc: ProseMirrorNode,
  highlighter: HighlighterCore,
  isDark: boolean,
): DecorationSet {
  const decorations: Decoration[] = [];
  const theme = isDark ? "github-dark" : "github-light";

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;

    const code = node.textContent;
    if (!code) return;

    const rawLang = node.attrs.language as string | null | undefined;
    const lang = normalizeLanguage(rawLang);

    try {
      const { tokens } = highlighter.codeToTokens(code, {
        lang: lang ?? "text",
        theme,
      });

      // +1 to skip the codeBlock node's opening token in the document
      let offset = pos + 1;

      for (let lineIdx = 0; lineIdx < tokens.length; lineIdx++) {
        const line = tokens[lineIdx];
        for (const token of line) {
          const from = offset;
          const to = from + token.content.length;

          if (token.color) {
            const style = `color:${token.color}`;
            // Apply font-style for italic tokens
            const italic =
              token.fontStyle !== undefined && token.fontStyle & 1
                ? ";font-style:italic"
                : "";
            // Apply font-weight for bold tokens
            const bold =
              token.fontStyle !== undefined && token.fontStyle & 2
                ? ";font-weight:bold"
                : "";
            decorations.push(
              Decoration.inline(from, to, {
                style: style + italic + bold,
              }),
            );
          }

          offset = to;
        }
        // Account for the newline between lines (not present after the last line)
        if (lineIdx < tokens.length - 1) {
          offset += 1;
        }
      }
    } catch {
      // Fall back to unstyled for unknown / parse errors
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const CodeBlockShiki = Extension.create({
  name: "codeBlockShiki",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockShikiPluginKey,

        state: {
          init(_, { doc }): PluginState {
            const highlighter = getHighlighterSync();
            if (!highlighter) {
              return { decorations: DecorationSet.empty, isDark: false };
            }
            return {
              isDark: false,
              decorations: buildDecorations(doc, highlighter, false),
            };
          },

          apply(tr, prevState): PluginState {
            const meta = tr.getMeta(
              codeBlockShikiPluginKey,
            ) as Partial<PluginState> | undefined;
            const isDark = meta?.isDark ?? prevState.isDark;
            const themeChanged =
              meta?.isDark !== undefined && meta.isDark !== prevState.isDark;

            // Nothing relevant changed — just remap positions
            if (!tr.docChanged && !themeChanged) {
              return { isDark, decorations: prevState.decorations.map(tr.mapping, tr.doc) };
            }

            const highlighter = getHighlighterSync();
            if (!highlighter) {
              return {
                isDark,
                decorations: prevState.decorations.map(tr.mapping, tr.doc),
              };
            }

            return {
              isDark,
              decorations: buildDecorations(tr.doc, highlighter, isDark),
            };
          },
        },

        props: {
          decorations(state) {
            return codeBlockShikiPluginKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
