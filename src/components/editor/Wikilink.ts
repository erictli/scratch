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
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ node }) {
    return [
      "span",
      {
        "data-wikilink": "",
        "data-note-title": node.attrs.noteTitle,
      },
      `[[${node.attrs.noteTitle}]]`,
    ];
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
      const match = src.match(/^\[\[([^\]]+?)\]\]/);
      if (!match) return undefined;
      return {
        type: "wikilink",
        raw: match[0],
        text: match[1],
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode("wikilink", { noteTitle: token.text });
  },

  renderMarkdown(node: JSONContent) {
    return `[[${node.attrs?.noteTitle ?? ""}]]`;
  },
});
