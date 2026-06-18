import { Node, mergeAttributes, InputRule, type JSONContent, type MarkdownToken } from "@tiptap/core";

export type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

const ALERT_TYPES: AlertType[] = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];


export const AlertBlockquote = Node.create({
  name: "alertBlockquote",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      alertType: {
        default: "NOTE",
        parseHTML: (el) => (el.getAttribute("data-alert-type") as AlertType) || "NOTE",
        renderHTML: (attrs) => ({ "data-alert-type": attrs.alertType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "blockquote[data-alert-type]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = ((node.attrs.alertType as string) || "NOTE").toLowerCase();
    return [
      "blockquote",
      mergeAttributes(HTMLAttributes, { class: `alert alert-${type}` }),
      0,
    ];
  },

  addInputRules() {
    const nodeType = this.type;
    return ALERT_TYPES.map((alertType) =>
      new InputRule({
        find: new RegExp(`^\\[!${alertType}\\]\\s$`, "i"),
        handler: ({ state, range, commands }) => {
          const { $from } = state.selection;
          let bqPos = -1;
          for (let d = $from.depth; d >= 1; d--) {
            if ($from.node(d).type.name === "blockquote") {
              bqPos = $from.before(d);
              break;
            }
          }
          if (bqPos === -1) return;

          commands.command(({ tr }) => {
            tr.delete(range.from, range.to);
            const bq = tr.doc.nodeAt(bqPos);
            if (!bq) return true;
            const alertNode = nodeType.create({ alertType }, bq.content);
            tr.replaceWith(bqPos, bqPos + bq.nodeSize, alertNode);
            return true;
          });
        },
      }),
    );
  },

  markdownTokenName: "alertBlockquote",

  markdownTokenizer: {
    name: "alertBlockquote",
    level: "block" as const,
    start: "> [!",
    tokenize(src: string, _tokens: MarkdownToken[]) {
      const match = src.match(
        /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\r?\n?((?:>[ \t]?[^\n]*\r?\n?)*)/i,
      );
      if (!match) return undefined;
      const text = (match[2] || "").replace(/^>[ \t]?/gm, "").replace(/\s+$/, "");
      return {
        type: "alertBlockquote",
        raw: match[0],
        alertType: match[1].toUpperCase(),
        text,
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = token as any;
    const alertType: string = t.alertType || "NOTE";
    const text: string = t.text || "";
    // Split on blank lines → multiple paragraphs; soft newlines → space
    const blocks = text.split(/\n\n+/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
    const paraNodes = blocks.length > 0
      ? blocks.map((p) => helpers.createNode("paragraph", {}, [helpers.createTextNode(p)]))
      : [helpers.createNode("paragraph", {}, [])];
    return helpers.createNode("alertBlockquote", { alertType }, paraNodes);
  },

  renderMarkdown(node: JSONContent, helpers) {
    const alertType = (node.attrs?.alertType as string) || "NOTE";
    const raw = node.content ? helpers.renderChildren(node.content) : "";
    const inner = raw.replace(/\s+$/, "");
    const lines = inner.split("\n").map((l) => (l ? `> ${l}` : ">"));
    return `> [!${alertType}]\n${lines.join("\n")}`;
  },
});
