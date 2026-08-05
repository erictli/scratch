import type { JSONContent } from "@tiptap/core";
import {
  MAX_TABLE_ROW_HEIGHT,
  MIN_TABLE_ROW_HEIGHT,
} from "./tableExtensions";
import { normalizeTableBackgroundColor } from "./tableMetadata";

const TABLE_METADATA_PATTERN =
  /^\s*<!--\s*scratch-table:(\{.*\})\s*-->\s*$/;
const TABLE_DELIMITER_PATTERN =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const MIN_COLUMN_WIDTH = 25;
const MAX_COLUMN_WIDTH = 4000;
const MAX_TABLE_DIMENSION_COUNT = 256;
const MAX_ENCODED_CELL_MARKDOWN_LENGTH = 16 * 1024 * 1024;
const MAX_TOTAL_ENCODED_CELL_MARKDOWN_LENGTH = 4 * 1024 * 1024;

interface MarkdownManagerLike {
  parse(markdown: string): JSONContent;
  serialize(document: JSONContent): string;
}

export interface TableGeometry {
  columns: number[];
  rows: number[];
  fitToWidth?: boolean;
  headerRow?: boolean;
  headerColumn?: boolean;
  backgroundColors?: Array<Array<string | null>>;
  cellMarkdownBase64?: Array<Array<string | null>>;
  cellMarkdownSourceBase64?: Array<Array<string | null>>;
}

interface ParsedTableGeometry extends TableGeometry {
  decodedCellMarkdown?: Array<Array<string | null>>;
  decodedCellMarkdownSource?: Array<Array<string | null>>;
}

interface ParsedEncodedCellMatrix {
  decoded: Array<Array<string | null>>;
  encodedLength: number;
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string | null {
  if (
    value.length > MAX_ENCODED_CELL_MARKDOWN_LENGTH ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isSafeDimension(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (value === 0 || (value >= minimum && value <= maximum))
  );
}

function parseEncodedCellMatrix(
  value: unknown,
  remainingEncodedLength: number,
): ParsedEncodedCellMatrix | null {
  if (!Array.isArray(value) || value.length > MAX_TABLE_DIMENSION_COUNT) {
    return null;
  }

  const decoded: Array<Array<string | null>> = [];
  let encodedLength = 0;

  for (const row of value) {
    if (!Array.isArray(row) || row.length > MAX_TABLE_DIMENSION_COUNT) {
      return null;
    }
    const decodedRow: Array<string | null> = [];
    for (const entry of row) {
      if (entry === null) {
        decodedRow.push(null);
        continue;
      }
      if (typeof entry !== "string") return null;
      encodedLength += entry.length;
      if (encodedLength > remainingEncodedLength) return null;
      const decodedEntry = decodeBase64Utf8(entry);
      if (decodedEntry === null) return null;
      decodedRow.push(decodedEntry);
    }
    decoded.push(decodedRow);
  }

  return { decoded, encodedLength };
}

function assertSafeEncodedCellMetadata(
  ...matrices: Array<Array<Array<string | null>>>
): void {
  let encodedLength = 0;
  for (const matrix of matrices) {
    for (const row of matrix) {
      for (const entry of row) {
        if (entry === null) continue;
        if (entry.length > MAX_ENCODED_CELL_MARKDOWN_LENGTH) {
          throw new Error("Table cell metadata exceeds the per-cell safety limit");
        }
        encodedLength += entry.length;
        if (encodedLength > MAX_TOTAL_ENCODED_CELL_MARKDOWN_LENGTH) {
          throw new Error("Table cell metadata exceeds the 4 MiB safety limit");
        }
      }
    }
  }
}

function parseTableGeometry(value: string): ParsedTableGeometry | null {
  try {
    const parsed = JSON.parse(value) as Partial<TableGeometry>;
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
      return null;
    }
    if (
      parsed.columns.length > MAX_TABLE_DIMENSION_COUNT ||
      parsed.rows.length > MAX_TABLE_DIMENSION_COUNT
    ) {
      return null;
    }
    if (
      !parsed.columns.every((width) =>
        isSafeDimension(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH),
      ) ||
      !parsed.rows.every((height) =>
        isSafeDimension(
          height,
          MIN_TABLE_ROW_HEIGHT,
          MAX_TABLE_ROW_HEIGHT,
        ),
      )
    ) {
      return null;
    }

    const geometry: ParsedTableGeometry = {
      columns: parsed.columns,
      rows: parsed.rows,
    };
    if (parsed.fitToWidth === true) geometry.fitToWidth = true;
    if (typeof parsed.headerRow === "boolean") {
      geometry.headerRow = parsed.headerRow;
    }
    if (typeof parsed.headerColumn === "boolean") {
      geometry.headerColumn = parsed.headerColumn;
    }
    if (
      Array.isArray(parsed.backgroundColors) &&
      parsed.backgroundColors.length <= MAX_TABLE_DIMENSION_COUNT &&
      parsed.backgroundColors.every(
        (row) =>
          Array.isArray(row) && row.length <= MAX_TABLE_DIMENSION_COUNT,
      )
    ) {
      geometry.backgroundColors = parsed.backgroundColors.map((row) =>
        row.map((color) => normalizeTableBackgroundColor(color)),
      );
    }
    const cellMarkdown = parseEncodedCellMatrix(
      parsed.cellMarkdownBase64,
      MAX_TOTAL_ENCODED_CELL_MARKDOWN_LENGTH,
    );
    const cellMarkdownSource = cellMarkdown
      ? parseEncodedCellMatrix(
          parsed.cellMarkdownSourceBase64,
          MAX_TOTAL_ENCODED_CELL_MARKDOWN_LENGTH -
            cellMarkdown.encodedLength,
        )
      : null;
    if (cellMarkdown && cellMarkdownSource) {
      geometry.decodedCellMarkdown = cellMarkdown.decoded;
      geometry.decodedCellMarkdownSource = cellMarkdownSource.decoded;
    }

    return geometry;
  } catch {
    return null;
  }
}

function isFence(line: string): { character: string; length: number } | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  if (!match) return null;
  return { character: match[1][0], length: match[1].length };
}

function isFenceClose(
  line: string,
  fence: { character: string; length: number },
): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length &&
    Array.from(trimmed).every((character) => character === fence.character)
  );
}

function isIndentedCodeLine(line: string): boolean {
  // CommonMark allows up to three leading spaces for normal block content.
  // Four spaces (or one tab) starts an indented code block, so table-shaped
  // text there must not consume a table-geometry slot.
  return /^(?: {4}| {0,3}\t)/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const delimiter = lines[index + 1] ?? "";
  return (
    !isIndentedCodeLine(line) &&
    !isIndentedCodeLine(delimiter) &&
    line.includes("|") &&
    delimiter.includes("|") &&
    TABLE_DELIMITER_PATTERN.test(delimiter)
  );
}

function shouldPreserveCellBlocks(cell: JSONContent): boolean {
  const blocks = cell.content ?? [];
  return blocks.length !== 1 || blocks[0]?.type !== "paragraph";
}

function collectTables(document: JSONContent): JSONContent[] {
  const tables: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "table") {
      tables.push(node);
      return;
    }
    node.content?.forEach(visit);
  };
  visit(document);
  return tables;
}

function collectTableGeometries(
  manager: MarkdownManagerLike,
  document: JSONContent,
  visibleDocument: JSONContent,
): Array<TableGeometry | null> {
  const geometries: Array<TableGeometry | null> = [];
  const visibleTables = collectTables(visibleDocument);
  let tableIndex = 0;

  function visit(node: JSONContent) {
    if (node.type === "table") {
      const rows = node.content ?? [];
      const visibleRows = visibleTables[tableIndex]?.content ?? [];
      tableIndex += 1;
      const columns: number[] = [];

      for (const row of rows) {
        let columnIndex = 0;
        for (const cell of row.content ?? []) {
          const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1);
          const colwidth = Array.isArray(cell.attrs?.colwidth)
            ? cell.attrs.colwidth
            : [];

          for (let offset = 0; offset < colspan; offset += 1) {
            const width = Number(colwidth[offset] ?? 0);
            if (!columns[columnIndex + offset] && width > 0) {
              columns[columnIndex + offset] = Math.round(width);
            }
          }
          columnIndex += colspan;
        }
      }

      const rowHeights = rows.map((row) =>
        Number.isFinite(Number(row.attrs?.rowHeight))
          ? Math.round(Number(row.attrs?.rowHeight))
          : 0,
      );
      const normalizedColumns = Array.from(
        { length: columns.length },
        (_, index) => columns[index] ?? 0,
      );
      const hasGeometry =
        normalizedColumns.some((width) => width > 0) ||
        rowHeights.some((height) => height > 0);
      const firstRow = rows[0];
      const inferredHeaderRow = Boolean(
        firstRow?.content?.length &&
          firstRow.content.every((cell) => cell.type === "tableHeader"),
      );
      const inferredHeaderColumn =
        rows.length > 1 &&
        rows.every((row) => row.content?.[0]?.type === "tableHeader");
      const headerRow =
        typeof node.attrs?.headerRow === "boolean"
          ? node.attrs.headerRow
          : inferredHeaderRow;
      const headerColumn =
        typeof node.attrs?.headerColumn === "boolean"
          ? node.attrs.headerColumn
          : inferredHeaderColumn;
      const backgroundColors = rows.map((row) =>
        (row.content ?? []).map((cell) =>
          normalizeTableBackgroundColor(cell.attrs?.backgroundColor),
        ),
      );
      const hasBackgroundColors = backgroundColors.some((row) =>
        row.some((color) => color !== null),
      );
      const cellMarkdownBase64 = rows.map((row) =>
        (row.content ?? []).map((cell) =>
          shouldPreserveCellBlocks(cell)
            ? encodeBase64Utf8(
                manager.serialize({
                  type: "doc",
                  content: cell.content ?? [],
                }),
              )
            : null,
        ),
      );
      const cellMarkdownSourceBase64 = rows.map((row, rowIndex) =>
        (row.content ?? []).map((cell, columnIndex) =>
          shouldPreserveCellBlocks(cell)
            ? encodeBase64Utf8(
                JSON.stringify(
                  visibleRows[rowIndex]?.content?.[columnIndex]?.content ?? [],
                ),
              )
            : null,
        ),
      );
      const hasPreservedCellBlocks = cellMarkdownBase64.some((row) =>
        row.some((value) => value !== null),
      );
      if (hasPreservedCellBlocks) {
        assertSafeEncodedCellMetadata(
          cellMarkdownBase64,
          cellMarkdownSourceBase64,
        );
      }
      const fitToWidth = node.attrs?.fitToWidth === true;
      const hasMetadata =
        hasGeometry ||
        fitToWidth ||
        headerRow === false ||
        headerColumn ||
        hasBackgroundColors ||
        hasPreservedCellBlocks;

      geometries.push(
        hasMetadata
          ? {
              columns: normalizedColumns,
              rows: rowHeights,
              ...(fitToWidth ? { fitToWidth: true } : {}),
              ...(headerRow === false ? { headerRow: false } : {}),
              ...(headerColumn ? { headerColumn: true } : {}),
              ...(hasBackgroundColors ? { backgroundColors } : {}),
              ...(hasPreservedCellBlocks ? { cellMarkdownBase64 } : {}),
              ...(hasPreservedCellBlocks
                ? { cellMarkdownSourceBase64 }
                : {}),
            }
          : null,
      );
      return;
    }

    node.content?.forEach(visit);
  }

  visit(document);
  return geometries;
}

function prepareTablesForMarkdown(document: JSONContent): JSONContent {
  function visit(node: JSONContent): JSONContent {
    if (node.type === "table") {
      return {
        ...node,
        content: node.content?.map((row, rowIndex) => ({
          ...row,
          content: row.content?.map((cell) =>
            rowIndex === 0 ? { ...cell, type: "tableHeader" } : cell,
          ),
        })),
      };
    }

    if (!node.content) return node;
    return { ...node, content: node.content.map(visit) };
  }

  return visit(document);
}

function injectTableMetadata(
  markdown: string,
  geometries: Array<TableGeometry | null>,
): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let activeFence: { character: string; length: number } | null = null;
  let tableIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = isFence(line);

    if (activeFence) {
      output.push(line);
      if (isFenceClose(line, activeFence)) activeFence = null;
      continue;
    }
    if (fence) {
      activeFence = fence;
      output.push(line);
      continue;
    }

    if (isTableStart(lines, index)) {
      const geometry = geometries[tableIndex] ?? null;
      tableIndex += 1;
      if (geometry) {
        output.push(`<!-- scratch-table:${JSON.stringify(geometry)} -->`);
      }
    }
    output.push(line);
  }

  return output.join("\n");
}

function extractTableMetadata(markdown: string): {
  markdown: string;
  geometries: Array<ParsedTableGeometry | null>;
} {
  const lines = markdown.split("\n");
  const output: string[] = [];
  const geometries: Array<ParsedTableGeometry | null> = [];
  let activeFence: { character: string; length: number } | null = null;
  let pendingGeometry: ParsedTableGeometry | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = isFence(line);

    if (activeFence) {
      output.push(line);
      if (isFenceClose(line, activeFence)) activeFence = null;
      continue;
    }
    if (fence) {
      activeFence = fence;
      output.push(line);
      continue;
    }

    const metadataMatch = line.match(TABLE_METADATA_PATTERN);
    if (metadataMatch) {
      pendingGeometry = parseTableGeometry(metadataMatch[1]);
      continue;
    }

    if (isTableStart(lines, index)) {
      geometries.push(pendingGeometry);
      pendingGeometry = null;
    } else if (line.trim() !== "") {
      pendingGeometry = null;
    }

    output.push(line);
  }

  return { markdown: output.join("\n"), geometries };
}

function containsTableStructure(node: JSONContent): boolean {
  if (
    node.type === "table" ||
    node.type === "tableRow" ||
    node.type === "tableCell" ||
    node.type === "tableHeader"
  ) {
    return true;
  }
  return (node.content ?? []).some(containsTableStructure);
}

function parsePreservedCellBlocks(
  manager: MarkdownManagerLike,
  markdown: string | null | undefined,
  visibleSource: string | null | undefined,
  visibleContent: JSONContent[] | undefined,
): JSONContent[] | null {
  if (!markdown || !visibleSource) return null;
  if (JSON.stringify(visibleContent ?? []) !== visibleSource) {
    return null;
  }
  const content = manager.parse(markdown).content ?? [];
  if (content.length === 0 || content.some(containsTableStructure)) return null;
  return content;
}

function applyTableGeometry(
  manager: MarkdownManagerLike,
  table: JSONContent,
  geometry: ParsedTableGeometry | null,
): JSONContent {
  if (!geometry) return table;

  const tableAttrs = { ...table.attrs };
  if (geometry.fitToWidth === true) tableAttrs.fitToWidth = true;
  if (typeof geometry.headerRow === "boolean") {
    tableAttrs.headerRow = geometry.headerRow;
  }
  if (typeof geometry.headerColumn === "boolean") {
    tableAttrs.headerColumn = geometry.headerColumn;
  }

  return {
    ...table,
    attrs: tableAttrs,
    content: table.content?.map((row, rowIndex) => {
      let columnIndex = 0;
      const cells = row.content?.map((cell) => {
        const currentColumnIndex = columnIndex;
        const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1);
        const widths = geometry.columns.slice(
          columnIndex,
          columnIndex + colspan,
        );
        columnIndex += colspan;
        const backgroundColor = normalizeTableBackgroundColor(
          geometry.backgroundColors?.[rowIndex]?.[currentColumnIndex],
        );
        let cellType = cell.type;
        if (geometry.headerRow === false && rowIndex === 0) {
          cellType = "tableCell";
        } else if (geometry.headerRow === true && rowIndex === 0) {
          cellType = "tableHeader";
        }
        if (geometry.headerColumn === true && currentColumnIndex === 0) {
          cellType = "tableHeader";
        }
        const preservedContent = parsePreservedCellBlocks(
          manager,
          geometry.decodedCellMarkdown?.[rowIndex]?.[currentColumnIndex],
          geometry.decodedCellMarkdownSource?.[rowIndex]?.[
            currentColumnIndex
          ],
          cell.content,
        );

        return {
          ...cell,
          type: cellType,
          content: preservedContent ?? cell.content,
          attrs: {
            ...cell.attrs,
            ...(widths.some((width) => width > 0)
              ? {
                  colwidth: widths.map((width) =>
                    width > 0 ? width : null,
                  ),
                }
              : {}),
            ...(backgroundColor ? { backgroundColor } : {}),
          },
        };
      });
      const rowHeight = geometry.rows[rowIndex] ?? 0;

      return {
        ...row,
        attrs: rowHeight > 0 ? { ...row.attrs, rowHeight } : row.attrs,
        content: cells,
      };
    }),
  };
}

function applyTableGeometries(
  manager: MarkdownManagerLike,
  document: JSONContent,
  geometries: Array<ParsedTableGeometry | null>,
): JSONContent {
  let tableIndex = 0;

  function visit(node: JSONContent): JSONContent {
    if (node.type === "table") {
      const geometry = geometries[tableIndex] ?? null;
      tableIndex += 1;
      return applyTableGeometry(manager, node, geometry);
    }

    if (!node.content) return node;
    return { ...node, content: node.content.map(visit) };
  }

  return visit(document);
}

export function serializeMarkdownDocument(
  manager: MarkdownManagerLike,
  document: JSONContent,
): string {
  const markdown = manager.serialize(prepareTablesForMarkdown(document));
  if (collectTables(document).length === 0) return markdown;
  const visibleDocument = manager.parse(markdown);
  return injectTableMetadata(
    markdown,
    collectTableGeometries(manager, document, visibleDocument),
  );
}

export function parseMarkdownDocument(
  manager: MarkdownManagerLike,
  markdown: string,
): JSONContent {
  const extracted = extractTableMetadata(markdown);
  const parsed = manager.parse(extracted.markdown);
  return applyTableGeometries(manager, parsed, extracted.geometries);
}
