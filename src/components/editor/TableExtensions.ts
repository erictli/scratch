import { Table } from "@tiptap/extension-table";
import type {
  JSONContent,
  MarkdownRendererHelpers,
  MarkdownToken,
} from "@tiptap/core";

const BR_HTML_RE = /^<br\s*\/?>$/i;

interface MarkedTableCell {
  text: string;
  tokens?: MarkdownToken[];
  header?: boolean;
  align?: "left" | "center" | "right" | null;
}

interface MarkedTableToken extends MarkdownToken {
  header?: MarkedTableCell[];
  rows?: MarkedTableCell[][];
  align?: Array<"left" | "center" | "right" | null>;
}

/**
 * Parse inline tokens for a table cell, converting `<br>` / `<br/>` HTML tokens
 * into TipTap `hardBreak` nodes so manual line breaks survive Markdown round-trips.
 */
function parseTableCellTokens(
  tokens: MarkdownToken[] | undefined,
  h: {
    parseInline: (tokens: MarkdownToken[]) => JSONContent[];
    createNode: (
      type: string,
      attrs?: Record<string, unknown>,
      content?: JSONContent[],
    ) => JSONContent;
  },
): JSONContent[] {
  if (!tokens || tokens.length === 0) {
    return [h.createNode("paragraph", {}, [])];
  }

  const inlineNodes: JSONContent[] = [];
  let chunk: MarkdownToken[] = [];

  const flushChunk = () => {
    if (chunk.length > 0) {
      inlineNodes.push(...h.parseInline(chunk));
      chunk = [];
    }
  };

  for (const token of tokens) {
    const raw = (token.raw ?? token.text ?? "").trim();
    if (
      token.type === "br" ||
      (token.type === "html" && BR_HTML_RE.test(raw))
    ) {
      flushChunk();
      inlineNodes.push(h.createNode("hardBreak", {}));
    } else {
      chunk.push(token);
    }
  }
  flushChunk();

  return [h.createNode("paragraph", {}, inlineNodes)];
}

/**
 * Serialize a single table cell's JSON content into GFM-safe inline Markdown,
 * preserving `hardBreak` and multiple paragraphs as `<br>`.
 */
function serializeCellContent(
  cellNode: JSONContent,
  h: MarkdownRendererHelpers,
): string {
  const children = cellNode.content ?? [];
  if (children.length === 0) return "";

  const renderedBlocks = children.map((child) => {
    const rendered = h.renderChildren(child);
    // Preserve explicit line breaks from HardBreak (`  \n`, `\\\n`, or `\n`) as `<br>`
    return rendered
      .replace(/(?: {2}|\\)\r?\n/g, "<br>")
      .replace(/\r?\n/g, "<br>")
      .trim();
  });

  // Join multi-paragraph cells with `<br>` and collapse horizontal runs of spaces
  return renderedBlocks
    .join("<br>")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export const ScratchTable = Table.extend({
  parseMarkdown(token, h) {
    const tableToken = token as MarkedTableToken;
    const rows: JSONContent[] = [];

    if (tableToken.header) {
      const headerCells = tableToken.header.map((cell) =>
        h.createNode("tableHeader", {}, parseTableCellTokens(cell.tokens, h)),
      );
      rows.push(h.createNode("tableRow", {}, headerCells));
    }

    if (tableToken.rows) {
      for (const row of tableToken.rows) {
        const bodyCells = row.map((cell) =>
          h.createNode("tableCell", {}, parseTableCellTokens(cell.tokens, h)),
        );
        rows.push(h.createNode("tableRow", {}, bodyCells));
      }
    }

    return h.createNode("table", undefined, rows);
  },

  renderMarkdown(node, h) {
    if (!node || !node.content || node.content.length === 0) {
      return "";
    }

    const rows: Array<Array<{ text: string; isHeader: boolean }>> = [];
    for (const rowNode of node.content) {
      const cells: Array<{ text: string; isHeader: boolean }> = [];
      for (const cellNode of rowNode.content ?? []) {
        cells.push({
          text: serializeCellContent(cellNode, h),
          isHeader: cellNode.type === "tableHeader",
        });
      }
      rows.push(cells);
    }

    const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    if (columnCount === 0) return "";

    const colWidths = new Array<number>(columnCount).fill(3);
    for (const row of rows) {
      for (let i = 0; i < columnCount; i++) {
        const len = (row[i]?.text ?? "").length;
        if (len > colWidths[i]) colWidths[i] = len;
      }
    }

    const pad = (s: string, width: number) =>
      s + " ".repeat(Math.max(0, width - s.length));

    const headerRow = rows[0];
    const hasHeader = headerRow.some((c) => c.isHeader);
    const headerTexts = Array.from({ length: columnCount }, (_, i) =>
      hasHeader ? (headerRow[i]?.text ?? "") : "",
    );

    let out = "\n";
    out += `| ${headerTexts.map((t, i) => pad(t, colWidths[i])).join(" | ")} |\n`;
    out += `| ${colWidths.map((w) => "-".repeat(Math.max(3, w))).join(" | ")} |\n`;

    const bodyRows = hasHeader ? rows.slice(1) : rows;
    for (const row of bodyRows) {
      out += `| ${Array.from({ length: columnCount }, (_, i) =>
        pad(row[i]?.text ?? "", colWidths[i]),
      ).join(" | ")} |\n`;
    }

    return out;
  },
});
