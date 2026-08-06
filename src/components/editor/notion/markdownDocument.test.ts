import { Editor, type JSONContent } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { describe, expect, it } from "vitest";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "./markdownDocument";
import { ScratchTableRow } from "./tableExtensions";
import { ScratchTableMetadata } from "./tableMetadata";
import { setTableColumnWidths } from "./tableTransactions";
import { moveTableColumn, moveTableRow } from "./tableTransactions";

function createTableEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      TableKit.configure({ tableRow: false }),
      ScratchTableRow,
      ScratchTableMetadata,
      Markdown,
    ],
  });
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function cell(
  text: string,
  type: "tableCell" | "tableHeader" = "tableCell",
  width?: number,
): JSONContent {
  return {
    type,
    attrs: width ? { colspan: 1, rowspan: 1, colwidth: [width] } : undefined,
    content: [paragraph(text)],
  };
}

function coloredCell(
  text: string,
  backgroundColor: string,
  type: "tableCell" | "tableHeader" = "tableCell",
): JSONContent {
  const tableCell = cell(text, type);
  return {
    ...tableCell,
    attrs: { ...tableCell.attrs, backgroundColor },
  };
}

function table(
  prefix: string,
  options: { columns?: number[]; rows?: number[] } = {},
): JSONContent {
  const columns = options.columns ?? [];
  const rows = options.rows ?? [];

  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        attrs: rows[0] ? { rowHeight: rows[0] } : undefined,
        content: [
          cell(`${prefix} A`, "tableHeader", columns[0]),
          cell(`${prefix} B`, "tableHeader", columns[1]),
        ],
      },
      {
        type: "tableRow",
        attrs: rows[1] ? { rowHeight: rows[1] } : undefined,
        content: [
          cell(`${prefix} 1`, "tableCell", columns[0]),
          cell(`${prefix} 2`, "tableCell", columns[1]),
        ],
      },
    ],
  };
}

function findTables(node: JSONContent): JSONContent[] {
  const tables: JSONContent[] = [];

  function visit(current: JSONContent) {
    if (current.type === "table") tables.push(current);
    current.content?.forEach(visit);
  }

  visit(node);
  return tables;
}

describe("Scratch Markdown document adapter", () => {
  it("round-trips table column widths and row heights", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [table("First", { columns: [180, 260], rows: [36, 52] })],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain(
      '<!-- scratch-table:{"columns":[180,260],"rows":[36,52]} -->',
    );
    expect(markdown).toContain("| First A");
    expect(parsedTable.content?.[0]?.attrs?.rowHeight).toBe(36);
    expect(parsedTable.content?.[1]?.attrs?.rowHeight).toBe(52);
    expect(parsedTable.content?.[0]?.content?.[0]?.attrs?.colwidth).toEqual([
      180,
    ]);
    expect(parsedTable.content?.[0]?.content?.[1]?.attrs?.colwidth).toEqual([
      260,
    ]);

    editor.destroy();
  });

  it("reopens the exact widths committed by a live column resize", () => {
    const editor = createTableEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          ...table("Live resize", {
            columns: [180, 220],
            rows: [36, 52],
          }),
          attrs: { fitToWidth: true },
        },
      ],
    });

    expect(setTableColumnWidths(editor, 0, [260, 220])).toBe(true);
    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      editor.getJSON(),
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const reopenedTable = findTables(parsed)[0];

    expect(markdown).toContain('"columns":[260,220]');
    expect(markdown).not.toContain('"fitToWidth":true');
    expect(
      reopenedTable.content?.[0]?.content?.map(
        (cellNode) => cellNode.attrs?.colwidth?.[0],
      ),
    ).toEqual([260, 220]);

    editor.destroy();
  });

  it("round-trips the table fit-to-width mode", () => {
    const editor = createTableEditor();
    const fittedTable: JSONContent = {
      ...table("Fitted", { columns: [180, 260], rows: [36, 52] }),
      attrs: { fitToWidth: true },
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      { type: "doc", content: [fittedTable] },
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain('"fitToWidth":true');
    expect(parsedTable.attrs?.fitToWidth).toBe(true);
    expect(parsedTable.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text)
      .toBe("Fitted 1");

    editor.destroy();
  });

  it("round-trips a header column independently from the header row", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                cell("Name", "tableHeader"),
                cell("Value", "tableHeader"),
              ],
            },
            {
              type: "tableRow",
              content: [
                cell("First", "tableHeader"),
                cell("One", "tableCell"),
              ],
            },
            {
              type: "tableRow",
              content: [
                cell("Second", "tableHeader"),
                cell("Two", "tableCell"),
              ],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain('"headerColumn":true');
    expect(parsedTable.content?.map((row) => row.content?.[0]?.type)).toEqual([
      "tableHeader",
      "tableHeader",
      "tableHeader",
    ]);
    expect(parsedTable.content?.[1]?.content?.[1]?.type).toBe("tableCell");

    editor.destroy();
  });

  it("round-trips a table with its header row disabled", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { headerRow: false },
          content: [
            {
              type: "tableRow",
              content: [cell("Plain A"), cell("Plain B")],
            },
            {
              type: "tableRow",
              content: [cell("One"), cell("Two")],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain('"headerRow":false');
    expect(parsedTable.attrs?.headerRow).toBe(false);
    expect(parsedTable.content?.[0]?.content?.map((tableCell) => tableCell.type))
      .toEqual(["tableCell", "tableCell"]);
    expect(parsedTable.content?.[1]?.content?.[1]?.content?.[0]?.content?.[0]?.text)
      .toBe("Two");

    editor.destroy();
  });

  it("round-trips effective cell, row, and column background colors", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                coloredCell("Column color", "#bae6fd", "tableHeader"),
                coloredCell("Row color", "#fde047", "tableHeader"),
              ],
            },
            {
              type: "tableRow",
              content: [
                coloredCell("Column continues", "#bae6fd"),
                coloredCell("Single cell", "#fecaca"),
              ],
            },
            {
              type: "tableRow",
              content: [
                coloredCell("Column ends", "#bae6fd"),
                cell("No color"),
              ],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain(
      '"backgroundColors":[["#bae6fd","#fde047"],["#bae6fd","#fecaca"],["#bae6fd",null]]',
    );
    expect(
      parsedTable.content?.map((row) =>
        row.content?.map((tableCell) =>
          tableCell.attrs?.backgroundColor ?? null,
        ),
      ),
    ).toEqual([
      ["#bae6fd", "#fde047"],
      ["#bae6fd", "#fecaca"],
      ["#bae6fd", null],
    ]);

    editor.destroy();
  });

  it("round-trips multiline table cells with links and inline styles", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("Label", "tableHeader"), cell("Value", "tableHeader")],
            },
            {
              type: "tableRow",
              content: [
                cell("Rich cell"),
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Bold",
                          marks: [{ type: "bold" }],
                        },
                        { type: "text", text: " and " },
                        {
                          type: "text",
                          text: "linked",
                          marks: [
                            {
                              type: "link",
                              attrs: { href: "https://example.com" },
                            },
                          ],
                        },
                        { type: "hardBreak" },
                        { type: "text", text: "Second line" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const richCell = findTables(parsed)[0].content?.[1]?.content?.[1];
    const inlineContent = richCell?.content?.[0]?.content ?? [];

    expect(richCell?.content?.[0]?.type).toBe("paragraph");
    expect(richCell?.content?.[0]?.content?.map((node) => node.text ?? "").join(""))
      .toBe("Bold and linkedSecond line");
    expect(
      inlineContent.find((node) => node.text === "Bold")?.marks?.[0]?.type,
    ).toBe("bold");
    expect(
      inlineContent.find((node) => node.text === "linked")?.marks?.[0]?.attrs
        ?.href,
    ).toBe("https://example.com");
    expect(inlineContent.some((node) => node.type === "hardBreak")).toBe(true);

    editor.destroy();
  });

  it("round-trips block lists in table cells without flattening their structure", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("Label", "tableHeader"), cell("Value", "tableHeader")],
            },
            {
              type: "tableRow",
              content: [
                cell("Structured cell"),
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [paragraph("One")],
                        },
                        {
                          type: "listItem",
                          content: [paragraph("Two")],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const structuredCell = findTables(parsed)[0].content?.[1]?.content?.[1];

    expect(structuredCell?.content?.[0]?.type).toBe("bulletList");
    expect(
      structuredCell?.content?.[0]?.content?.map(
        (item) => item.content?.[0]?.content?.[0]?.text,
      ),
    ).toEqual(["One", "Two"]);

    editor.destroy();
  });

  it("keeps an external visible-cell edit instead of restoring a stale structured sidecar", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("Label", "tableHeader"), cell("Value", "tableHeader")],
            },
            {
              type: "tableRow",
              content: [
                cell("Structured cell"),
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "bulletList",
                      content: [
                        { type: "listItem", content: [paragraph("One")] },
                        { type: "listItem", content: [paragraph("Two")] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const externallyEdited = markdown.replace("One", "Externally edited");
    const parsed = parseMarkdownDocument(
      editor.storage.markdown.manager,
      externallyEdited,
    );
    const editedCell = findTables(parsed)[0].content?.[1]?.content?.[1];

    expect(editedCell?.content?.[0]?.type).toBe("paragraph");
    expect(editedCell?.content?.[0]?.content?.map((node) => node.text ?? "").join(""))
      .toContain("Externally edited");

    editor.destroy();
  });

  it("keeps parsing legacy table metadata containing only columns and rows", () => {
    const editor = createTableEditor();
    const markdown = [
      '<!-- scratch-table:{"columns":[150,230],"rows":[38,46]} -->',
      "| Legacy A | Legacy B |",
      "| --- | --- |",
      "| One | Two |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(parsedTable.content?.map((row) => row.attrs?.rowHeight)).toEqual([
      38,
      46,
    ]);
    expect(
      parsedTable.content?.[0]?.content?.map(
        (tableCell) => tableCell.attrs?.colwidth?.[0],
      ),
    ).toEqual([150, 230]);
    expect(parsedTable.content?.[1]?.content?.[1]?.content?.[0]?.content?.[0]?.text)
      .toBe("Two");

    editor.destroy();
  });

  it("rejects dangerous CSS cell colors without losing table text", () => {
    const editor = createTableEditor();
    const markdown = [
      '<!-- scratch-table:{"columns":[],"rows":[],"backgroundColors":[["#fecaca","url(javascript:alert(1))"]]} -->',
      "| Safe color | Dangerous color |",
      "| --- | --- |",
      "| Keep me | Keep me too |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(parsedTable.content?.[0]?.content?.[0]?.attrs?.backgroundColor).toBe(
      "#fecaca",
    );
    expect(
      parsedTable.content?.[0]?.content?.[1]?.attrs?.backgroundColor ?? null,
    ).toBeNull();
    expect(
      parsedTable.content?.map((row) =>
        row.content?.map((tableCell) => tableCell.content?.[0]?.content?.[0]?.text),
      ),
    ).toEqual([
      ["Safe color", "Dangerous color"],
      ["Keep me", "Keep me too"],
    ]);

    editor.destroy();
  });

  it("rejects preserved cell metadata that would create a nested table", () => {
    const editor = createTableEditor();
    const nestedTableMarkdown = btoa(
      ["| Nested | Table |", "| --- | --- |", "| One | Two |"].join("\n"),
    );
    const visibleSource = btoa(
      JSON.stringify([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Safe A" }],
        },
      ]),
    );
    const markdown = [
      `<!-- scratch-table:${JSON.stringify({
        columns: [],
        rows: [],
        cellMarkdownBase64: [[nestedTableMarkdown, null], [null, null]],
        cellMarkdownSourceBase64: [[visibleSource, null], [null, null]],
      })} -->`,
      "| Safe A | Safe B |",
      "| --- | --- |",
      "| Keep me | Keep me too |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const tables = findTables(parsed);

    expect(tables).toHaveLength(1);
    expect(
      tables[0].content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text,
    ).toBe("Safe A");

    editor.destroy();
  });

  it("ignores malformed Base64 preserved-cell metadata", () => {
    const editor = createTableEditor();
    const markdown = [
      `<!-- scratch-table:${JSON.stringify({
        columns: [],
        rows: [],
        cellMarkdownBase64: [["%%%not-base64%%%", null], [null, null]],
        cellMarkdownSourceBase64: [["also-invalid", null], [null, null]],
      })} -->`,
      "| Safe A | Safe B |",
      "| --- | --- |",
      "| Keep me | Keep me too |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    expect(
      findTables(parsed)[0].content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text,
    ).toBe("Safe A");
    editor.destroy();
  });

  it("decodes valid Unicode preserved-cell metadata", () => {
    const editor = createTableEditor();
    const visibleContent = [
      {
        content: [{ text: "Safe A", type: "text" }],
        type: "paragraph",
      },
    ];
    const markdown = [
      `<!-- scratch-table:${JSON.stringify({
        columns: [],
        rows: [],
        cellMarkdownBase64: [[encodeUtf8Base64("**Été**"), null], [null, null]],
        cellMarkdownSourceBase64: [[
          encodeUtf8Base64(JSON.stringify(visibleContent)),
          null,
        ], [null, null]],
      })} -->`,
      "| Safe A | Safe B |",
      "| --- | --- |",
      "| Keep me | Keep me too |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const firstText = findTables(parsed)[0].content?.[0]?.content?.[0]
      ?.content?.[0]?.content?.[0];
    expect(firstText?.text).toBe("Été");
    expect(firstText?.marks).toEqual([{ type: "bold" }]);
    editor.destroy();
  });

  it("round-trips reordered table content and its matching geometry", () => {
    const editor = createTableEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              attrs: { rowHeight: 36 },
              content: [
                cell("H1", "tableHeader", 180),
                cell("H2", "tableHeader", 260),
              ],
            },
            {
              type: "tableRow",
              attrs: { rowHeight: 52 },
              content: [cell("A1", "tableCell", 180), cell("A2", "tableCell", 260)],
            },
            {
              type: "tableRow",
              attrs: { rowHeight: 64 },
              content: [cell("B1", "tableCell", 180), cell("B2", "tableCell", 260)],
            },
          ],
        },
      ],
    });

    expect(moveTableRow(editor, 0, 2, 1)).toBe(true);
    expect(moveTableColumn(editor, 0, 1, 0)).toBe(true);
    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      editor.getJSON(),
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(markdown).toContain(
      '<!-- scratch-table:{"columns":[260,180],"rows":[36,64,52]} -->',
    );
    expect(
      parsedTable.content?.map((row) =>
        row.content?.map((tableCell) => tableCell.content?.[0]?.content?.[0]?.text),
      ),
    ).toEqual([
      ["H2", "H1"],
      ["B2", "B1"],
      ["A2", "A1"],
    ]);
    expect(parsedTable.content?.map((row) => row.attrs?.rowHeight)).toEqual([
      36,
      64,
      52,
    ]);
    expect(
      parsedTable.content?.[0]?.content?.map(
        (tableCell) => tableCell.attrs?.colwidth?.[0],
      ),
    ).toEqual([260, 180]);

    editor.destroy();
  });

  it("maps metadata to the correct table when earlier tables use defaults", () => {
    const editor = createTableEditor();
    const source: JSONContent = {
      type: "doc",
      content: [
        table("Plain"),
        paragraph("Between"),
        table("Sized", { columns: [140, 220], rows: [40, 44] }),
      ],
    };

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      source,
    );
    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const tables = findTables(parsed);

    expect(markdown.match(/scratch-table:/g)).toHaveLength(1);
    expect(tables[0].content?.[0]?.attrs?.rowHeight ?? null).toBeNull();
    expect(tables[1].content?.[0]?.attrs?.rowHeight).toBe(40);
    expect(tables[1].content?.[0]?.content?.[1]?.attrs?.colwidth).toEqual([
      220,
    ]);

    editor.destroy();
  });

  it("does not treat table-shaped text inside a code fence as a table", () => {
    const editor = createTableEditor();
    const markdown = [
      "```md",
      "| code | only |",
      "| --- | --- |",
      "```",
      "",
      '<!-- scratch-table:{"columns":[160,240],"rows":[42,46]} -->',
      "| Real A | Real B |",
      "| --- | --- |",
      "| One | Two |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const tables = findTables(parsed);

    expect(tables).toHaveLength(1);
    expect(tables[0].content?.[0]?.attrs?.rowHeight).toBe(42);
    expect(tables[0].content?.[0]?.content?.[0]?.attrs?.colwidth).toEqual([
      160,
    ]);

    editor.destroy();
  });

  it("does not let indented code shift metadata away from the next table", () => {
    const editor = createTableEditor();
    const markdown = [
      "    | code | only |",
      "    | --- | --- |",
      "",
      "  \t| mixed indent | code |",
      "  \t| --- | --- |",
      "",
      '<!-- scratch-table:{"columns":[175,245],"rows":[41,47]} -->',
      "| Real A | Real B |",
      "| --- | --- |",
      "| One | Two |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const tables = findTables(parsed);

    expect(tables).toHaveLength(1);
    expect(tables[0].content?.[0]?.attrs?.rowHeight).toBe(41);
    expect(tables[0].content?.[1]?.attrs?.rowHeight).toBe(47);
    expect(tables[0].content?.[0]?.content?.[0]?.attrs?.colwidth).toEqual([
      175,
    ]);
    expect(tables[0].content?.[0]?.content?.[1]?.attrs?.colwidth).toEqual([
      245,
    ]);

    editor.destroy();
  });

  it("ignores malformed or unsafe metadata without losing table content", () => {
    const editor = createTableEditor();
    const markdown = [
      '<!-- scratch-table:{"columns":[-20,99999],"rows":"bad"} -->',
      "| Safe A | Safe B |",
      "| --- | --- |",
      "| One | Two |",
    ].join("\n");

    const parsed = parseMarkdownDocument(editor.storage.markdown.manager, markdown);
    const parsedTable = findTables(parsed)[0];

    expect(
      parsedTable.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text,
    ).toBe("One");
    expect(parsedTable.content?.[0]?.attrs?.rowHeight ?? null).toBeNull();
    expect(
      parsedTable.content?.[0]?.content?.[0]?.attrs?.colwidth ?? null,
    ).toBeNull();

    editor.destroy();
  });

  it("keeps ordinary tables as plain GFM without Scratch metadata", () => {
    const editor = createTableEditor();
    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      { type: "doc", content: [table("Plain")] },
    );

    expect(markdown).not.toContain("scratch-table:");
    expect(markdown).toContain("| Plain A");
    editor.destroy();
  });
});
