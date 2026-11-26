import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import type {
  JSONContent,
  MarkdownRendererHelpers,
  MarkdownToken,
} from "@tiptap/core";

export type TableColumnAlign = "left" | "center" | "right" | null;

function normalizeAlign(value: unknown): TableColumnAlign {
  if (value === "left" || value === "center" || value === "right") {
    return value;
  }
  return null;
}

const textAlignAttribute = {
  textAlign: {
    default: null as TableColumnAlign,
    parseHTML: (element: HTMLElement) =>
      normalizeAlign(
        element.style.textAlign ||
          element.getAttribute("data-align") ||
          element.getAttribute("align"),
      ),
    renderHTML: (attributes: Record<string, unknown>) => {
      const align = normalizeAlign(attributes.textAlign);
      if (!align) return {};
      return {
        style: `text-align: ${align}`,
        "data-align": align,
      };
    },
  },
};

export const ScratchTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...textAlignAttribute,
    };
  },
});

export const ScratchTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...textAlignAttribute,
    };
  },
});

const BR_HTML_RE = /^<br\s*\/?>$/i;
const TASK_PREFIX_RE = /^\s*[-*+]\s+\[([ xX])\](?:\s+(.*)|\s*$)/;

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
 * Split a table cell's inline token stream into line segments separated by `<br>` / `br` tokens.
 */
function splitTokensOnBr(tokens: MarkdownToken[]): MarkdownToken[][] {
  const segments: MarkdownToken[][] = [];
  let current: MarkdownToken[] = [];

  for (const token of tokens) {
    const raw = (token.raw ?? token.text ?? "").trim();
    if (
      token.type === "br" ||
      (token.type === "html" && BR_HTML_RE.test(raw))
    ) {
      segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  segments.push(current);
  return segments;
}

/**
 * Check whether a line segment begins with a GFM task item marker (`- [ ] ` / `- [x] `).
 * If so, return `{ checked, restTokens }`; otherwise return `null`.
 */
function extractTaskItemSegment(
  segment: MarkdownToken[],
): { checked: boolean; restTokens: MarkdownToken[] } | null {
  if (segment.length === 0) return null;
  const first = segment[0];
  if (first.type !== "text") return null;

  const text = first.text ?? first.raw ?? "";
  const match = text.match(TASK_PREFIX_RE);
  if (!match) return null;

  const checked = match[1].toLowerCase() === "x";
  const remainder = match[2] ?? "";
  const restTokens: MarkdownToken[] = [];
  if (remainder.length > 0) {
    restTokens.push({
      ...first,
      raw: remainder,
      text: remainder,
    });
  }
  restTokens.push(...segment.slice(1));
  return { checked, restTokens };
}

/**
 * Parse inline tokens for a table cell, converting `<br>` / `<br/>` HTML tokens
 * into TipTap `hardBreak` nodes and reconstructing `taskList` / `taskItem` nodes
 * from `- [ ]` / `- [x]` cell lines so both survive Markdown round-trips.
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

  const segments = splitTokensOnBr(tokens);
  const blocks: JSONContent[] = [];
  let pendingParagraphInline: JSONContent[] | null = null;
  let pendingTaskItems: JSONContent[] = [];

  const flushParagraph = () => {
    if (pendingParagraphInline !== null) {
      blocks.push(h.createNode("paragraph", {}, pendingParagraphInline));
      pendingParagraphInline = null;
    }
  };

  const flushTaskList = () => {
    if (pendingTaskItems.length > 0) {
      blocks.push(h.createNode("taskList", {}, pendingTaskItems));
      pendingTaskItems = [];
    }
  };

  for (const segment of segments) {
    const task = extractTaskItemSegment(segment);
    if (task) {
      flushParagraph();
      const inline =
        task.restTokens.length > 0 ? h.parseInline(task.restTokens) : [];
      pendingTaskItems.push(
        h.createNode("taskItem", { checked: task.checked }, [
          h.createNode("paragraph", {}, inline),
        ]),
      );
    } else {
      flushTaskList();
      const inline = segment.length > 0 ? h.parseInline(segment) : [];
      if (pendingParagraphInline === null) {
        pendingParagraphInline = [...inline];
      } else {
        pendingParagraphInline.push(h.createNode("hardBreak", {}), ...inline);
      }
    }
  }

  flushParagraph();
  flushTaskList();

  return blocks.length > 0 ? blocks : [h.createNode("paragraph", {}, [])];
}

/**
 * Serialize a single table cell's JSON content into GFM-safe inline Markdown,
 * preserving `hardBreak`, multiple paragraphs, and `taskList` items via `<br>`.
 */
function serializeCellContent(
  cellNode: JSONContent,
  h: MarkdownRendererHelpers,
): string {
  const children = cellNode.content ?? [];
  if (children.length === 0) return "";

  const renderedBlocks = children
    .map((child) => {
      if (child.type === "taskList") {
        const items = (child.content ?? []).map((item) => {
          const checked = Boolean(item.attrs?.checked);
          const itemText = (item.content ?? [])
            .map((p) =>
              h
                .renderChildren(p)
                .replace(/(?: {2}|\\)\r?\n/g, "<br>")
                .replace(/\r?\n/g, "<br>")
                .trim(),
            )
            .filter(Boolean)
            .join("<br>");
          return `- [${checked ? "x" : " "}] ${itemText}`.trimEnd();
        });
        return items.join("<br>");
      }

      const rendered = h.renderChildren(child);
      // Preserve explicit line breaks from HardBreak (`  \n`, `\\\n`, or `\n`) as `<br>`
      return rendered
        .replace(/(?: {2}|\\)\r?\n/g, "<br>")
        .replace(/\r?\n/g, "<br>")
        .trim();
    })
    .filter((block) => block.length > 0);

  // Join multi-block cells with `<br>` and collapse horizontal runs of spaces
  return renderedBlocks
    .join("<br>")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatAlignmentSeparator(width: number, align: TableColumnAlign): string {
  const minW = Math.max(3, width);
  switch (align) {
    case "left":
      return `:${"-".repeat(Math.max(3, minW - 1))}`;
    case "center":
      return `:${"-".repeat(Math.max(3, minW - 2))}:`;
    case "right":
      return `${"-".repeat(Math.max(3, minW - 1))}:`;
    default:
      return "-".repeat(minW);
  }
}

export const ScratchTable = Table.extend({
  parseMarkdown(token, h) {
    const tableToken = token as MarkedTableToken;
    const colAligns = tableToken.align ?? [];
    const rows: JSONContent[] = [];

    if (tableToken.header) {
      const headerCells = tableToken.header.map((cell, colIdx) => {
        const align = normalizeAlign(colAligns[colIdx] ?? cell.align);
        return h.createNode(
          "tableHeader",
          align ? { textAlign: align } : {},
          parseTableCellTokens(cell.tokens, h),
        );
      });
      rows.push(h.createNode("tableRow", {}, headerCells));
    }

    if (tableToken.rows) {
      for (const row of tableToken.rows) {
        const bodyCells = row.map((cell, colIdx) => {
          const align = normalizeAlign(colAligns[colIdx] ?? cell.align);
          return h.createNode(
            "tableCell",
            align ? { textAlign: align } : {},
            parseTableCellTokens(cell.tokens, h),
          );
        });
        rows.push(h.createNode("tableRow", {}, bodyCells));
      }
    }

    return h.createNode("table", undefined, rows);
  },

  renderMarkdown(node, h) {
    if (!node || !node.content || node.content.length === 0) {
      return "";
    }

    const rows: Array<
      Array<{ text: string; isHeader: boolean; align: TableColumnAlign }>
    > = [];
    for (const rowNode of node.content) {
      const cells: Array<{
        text: string;
        isHeader: boolean;
        align: TableColumnAlign;
      }> = [];
      for (const cellNode of rowNode.content ?? []) {
        cells.push({
          text: serializeCellContent(cellNode, h),
          isHeader: cellNode.type === "tableHeader",
          align: normalizeAlign(cellNode.attrs?.textAlign),
        });
      }
      rows.push(cells);
    }

    const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    if (columnCount === 0) return "";

    const colWidths = new Array<number>(columnCount).fill(3);
    const colAligns = new Array<TableColumnAlign>(columnCount).fill(null);
    for (const row of rows) {
      for (let i = 0; i < columnCount; i++) {
        const cell = row[i];
        const len = (cell?.text ?? "").length;
        if (len > colWidths[i]) colWidths[i] = len;
        if (colAligns[i] === null && cell?.align) {
          colAligns[i] = cell.align;
        }
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
    out += `| ${colWidths.map((w, i) => formatAlignmentSeparator(w, colAligns[i])).join(" | ")} |\n`;

    const bodyRows = hasHeader ? rows.slice(1) : rows;
    for (const row of bodyRows) {
      out += `| ${Array.from({ length: columnCount }, (_, i) =>
        pad(row[i]?.text ?? "", colWidths[i]),
      ).join(" | ")} |\n`;
    }

    return out;
  },
});
