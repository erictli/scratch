import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  docContainsNestedTable,
  normalizeNestedTablesInJson,
} from "./tableIntegrity";

function paragraph(text: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function cell(text: string): JSONContent {
  return {
    type: "tableCell",
    content: [paragraph(text)],
  };
}

function row(...cells: JSONContent[]): JSONContent {
  return {
    type: "tableRow",
    content: cells,
  };
}

function table(...rows: JSONContent[]): JSONContent {
  return {
    type: "table",
    content: rows,
  };
}

function documentWith(tableNode: JSONContent): JSONContent {
  return {
    type: "doc",
    content: [tableNode],
  };
}

function sourceText(node: JSONContent): string {
  const ownText = node.type === "text" ? node.text ?? "" : "";
  return ownText + (node.content ?? []).map(sourceText).join("");
}

function descendantsOfType(
  node: JSONContent,
  types: ReadonlySet<string>,
): string[] {
  return (node.content ?? []).flatMap((child) => [
    ...(child.type && types.has(child.type) ? [child.type] : []),
    ...descendantsOfType(child, types),
  ]);
}

function expectValidTableIntegrity(source: JSONContent): void {
  const normalized = normalizeNestedTablesInJson(source);
  const normalizedTable = normalized.content?.[0];

  expect(sourceText(normalized)).toBe(sourceText(source));
  expect(normalizedTable?.type).toBe("table");

  const rows = normalizedTable?.content ?? [];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows.every((candidate) => candidate.type === "tableRow")).toBe(true);

  const widths = rows.map((candidate) => candidate.content?.length ?? 0);
  expect(widths.every((width) => width >= 1)).toBe(true);
  expect(new Set(widths).size).toBe(1);

  const forbiddenUnderCell = new Set([
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
  ]);

  for (const normalizedRow of rows) {
    const cells = normalizedRow.content ?? [];
    expect(
      cells.every(
        (candidate) =>
          candidate.type === "tableCell" || candidate.type === "tableHeader",
      ),
    ).toBe(true);

    for (const normalizedCell of cells) {
      expect(descendantsOfType(normalizedCell, forbiddenUnderCell)).toEqual([]);
    }
  }
}

describe("normalizeNestedTablesInJson table integrity", () => {
  it.each([
    {
      name: "wraps a tableCell placed directly under a table",
      source: documentWith(table(cell("direct cell"))),
    },
    {
      name: "wraps a paragraph placed directly under a table",
      source: documentWith(table(paragraph("direct paragraph"))),
    },
    {
      name: "flattens a tableRow nested inside another tableRow",
      source: documentWith(table(row(row(cell("nested row"))))),
    },
    {
      name: "flattens a tableCell nested inside another tableCell",
      source: documentWith(
        table(
          row({
            type: "tableCell",
            content: [cell("nested cell")],
          }),
        ),
      ),
    },
    {
      name: "flattens a tableRow nested inside a tableCell",
      source: documentWith(
        table(
          row({
            type: "tableCell",
            content: [row(cell("row under cell"))],
          }),
        ),
      ),
    },
    {
      name: "pads rows that contain unequal numbers of cells",
      source: documentWith(
        table(
          row(cell("A"), cell("B")),
          row(cell("C")),
        ),
      ),
    },
    {
      name: "repairs an empty table to the minimum 1x1 shape",
      source: documentWith(table()),
    },
  ])("$name", ({ source }) => {
    expectValidTableIntegrity(source);
  });

  it("pads rows using effective colspan width", () => {
    const source = documentWith(
      table(
        row({
          ...cell("spanning"),
          attrs: { colspan: 2, rowspan: 1 },
        }),
        row(cell("single")),
      ),
    );

    const normalizedRows =
      normalizeNestedTablesInJson(source).content?.[0]?.content ?? [];

    expect(normalizedRows[0]?.content).toHaveLength(1);
    expect(normalizedRows[0]?.content?.[0]?.attrs?.colspan).toBe(2);
    expect(normalizedRows[1]?.content).toHaveLength(2);
  });

  it("does not pad a row into a column occupied by a rowspan", () => {
    const source = documentWith(
      table(
        row(
          { ...cell("vertical"), attrs: { colspan: 1, rowspan: 2 } },
          cell("top right"),
        ),
        row(cell("bottom right")),
      ),
    );

    const normalizedRows =
      normalizeNestedTablesInJson(source).content?.[0]?.content ?? [];

    expect(normalizedRows[0]?.content).toHaveLength(2);
    expect(normalizedRows[1]?.content).toHaveLength(1);
  });

  it("wraps wikilinks in a paragraph inside repaired cells", () => {
    const source = documentWith(
      table(
        row({
          type: "tableCell",
          content: [
            { type: "wikilink", attrs: { noteTitle: "Project plan" } },
          ],
        }),
      ),
    );

    const normalizedCell = normalizeNestedTablesInJson(source)
      .content?.[0]?.content?.[0]?.content?.[0];

    expect(normalizedCell?.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "wikilink", attrs: { noteTitle: "Project plan" } },
        ],
      },
    ]);
  });

  it("normalizes a 100 x 20 table without rebuilding invalid descendants", () => {
    const source = documentWith(
      table(
        ...Array.from({ length: 100 }, (_, rowIndex) =>
          row(
            ...Array.from({ length: 20 }, (_, columnIndex) =>
              cell(`R${rowIndex + 1}C${columnIndex + 1}`),
            ),
          ),
        ),
      ),
    );
    const normalized = normalizeNestedTablesInJson(source);
    const normalizedTable = normalized.content?.[0];

    expect(normalizedTable?.content).toHaveLength(100);
    expect(
      normalizedTable?.content?.every((normalizedRow) =>
        normalizedRow.content?.length === 20,
      ),
    ).toBe(true);
    expect(sourceText(normalized)).toBe(sourceText(source));
  });
});

describe("docContainsNestedTable", () => {
  function inspect(content: JSONContent): boolean {
    const editor = new Editor({ extensions: [StarterKit, TableKit] });
    try {
      return docContainsNestedTable(editor.schema.nodeFromJSON(content));
    } finally {
      editor.destroy();
    }
  }

  it("accepts a document without tables", () => {
    expect(inspect({ type: "doc", content: [paragraph("Plain")] })).toBe(false);
  });

  it("accepts one top-level table", () => {
    expect(inspect(documentWith(table(row(cell("Top level")))))).toBe(false);
  });

  it("detects a table directly inside a table cell", () => {
    expect(
      inspect(
        documentWith(
          table(row({ type: "tableCell", content: [table(row(cell("Nested")))] })),
        ),
      ),
    ).toBe(true);
  });

  it("detects a deeply nested table below cell block content", () => {
    expect(
      inspect(
        documentWith(
          table(
            row({
              type: "tableCell",
              content: [
                {
                  type: "blockquote",
                  content: [table(row(cell("Deep")))],
                },
              ],
            }),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("scans a large document without serializing it", () => {
    expect(
      inspect({
        type: "doc",
        content: Array.from({ length: 2_000 }, (_, index) =>
          paragraph(`Paragraph ${index}`),
        ),
      }),
    ).toBe(false);
  });
});
