import { Node, type JSONContent, type MarkdownToken } from "@tiptap/core";
import type { NoteMetadata } from "../../types/note";

export interface WikilinkStorage {
  notes: NoteMetadata[];
}

export const Wikilink = Node.create<object, WikilinkStorage>({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      noteTitle: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note-title"),
        renderHTML: (attributes) => ({
          "data-note-title": attributes.noteTitle,
        }),
      },
      alias: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-alias") ?? null,
        renderHTML: (attributes) =>
          attributes.alias ? { "data-alias": attributes.alias } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ node }) {
    const display =
      node.attrs.alias && node.attrs.alias.length > 0
        ? node.attrs.alias
        : (node.attrs.noteTitle ?? "");

    const attrs: Record<string, string> = {
      "data-wikilink": "",
      "data-note-title": node.attrs.noteTitle ?? "",
    };
    if (node.attrs.alias && node.attrs.alias.length > 0) {
      attrs["data-alias"] = node.attrs.alias;
    }

    return ["span", attrs, display];
  },

  addStorage() {
    return {
      notes: [],
    };
  },

  markdownTokenName: "wikilink",

  markdownTokenizer: {
    name: "wikilink",
    level: "inline" as const,
    start: "[[",
    tokenize(src: string, _tokens: MarkdownToken[]) {
      // Matches [[target]] or [[target|alias]]
      // target: anything except |, [, ]
      // alias: anything except [, ] (optional)
      const match = /^\[\[([^|\[\]]+?)(?:\|([^\[\]]*))?\]\]/.exec(src);
      if (!match) return undefined;
      const noteTitle = match[1].trim();
      const alias = match[2]?.trim() ?? null;
      return {
        type: "wikilink",
        raw: match[0],
        text: noteTitle,
        // Store alias in the token for parseMarkdown
        alias: alias && alias.length > 0 ? alias : null,
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode("wikilink", {
      noteTitle: token.text,
      alias: (token as MarkdownToken & { alias?: string | null }).alias ?? null,
    });
  },

  renderMarkdown(node: JSONContent) {
    const noteTitle = node.attrs?.noteTitle ?? "";
    const alias = node.attrs?.alias;
    if (alias && alias.length > 0) {
      return `[[${noteTitle}|${alias}]]`;
    }
    return `[[${noteTitle}]]`;
  },
});
