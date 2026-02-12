import { Node, type JSONContent, type MarkdownToken } from "@tiptap/core";

export const Frontmatter = Node.create({
  name: "frontmatter",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "pre[data-frontmatter]", preserveWhitespace: "full" as const }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "pre",
      { ...HTMLAttributes, "data-frontmatter": "", class: "frontmatter" },
      ["code", 0],
    ];
  },

  markdownTokenName: "frontmatter",

  markdownTokenizer: {
    name: "frontmatter",
    level: "block" as const,
    start: "---",
    tokenize(src: string, tokens: MarkdownToken[]) {
      if (tokens.length > 0) return undefined;
      const match = src.match(
        /^(?:\ufeff)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
      );
      if (!match) return undefined;
      return {
        type: "frontmatter",
        raw: match[0],
        text: match[1],
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode(
      "frontmatter",
      {},
      token.text ? [helpers.createTextNode(token.text)] : [],
    );
  },

  renderMarkdown(node: JSONContent, helpers) {
    const content = node.content
      ? helpers.renderChildren(node.content)
      : "";
    return `---\n${content}\n---`;
  },
});
