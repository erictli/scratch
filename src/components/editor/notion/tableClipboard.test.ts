import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { undoDepth } from "@tiptap/pm/history";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  pasteTableTsv,
  serializeTableCellSelectionToTsv,
  shouldRejectTablePaste,
} from "./tableClipboard";

const tableDocument = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Nested value" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

const paragraphDocument = (text: string): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: text ? [{ type: "text", text }] : undefined,
    },
  ],
});

describe("table clipboard safety decision", () => {
  const editors: Editor[] = [];

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it("rejects HTML containing a table when the active selection is in a table cell", () => {
    expect(
      shouldRejectTablePaste({
        isInsideTableCell: true,
        html: "<table><tbody><tr><td>Nested value</td></tr></tbody></table>",
        parsedContent: null,
      }),
    ).toBe(true);
  });

  it("rejects parsed Markdown or JSON containing a table when the active selection is in a table cell", () => {
    expect(
      shouldRejectTablePaste({
        isInsideTableCell: true,
        html: "",
        parsedContent: tableDocument(),
      }),
    ).toBe(true);
  });

  it("also rejects a table node nested below another parsed block", () => {
    const parsedContent: JSONContent = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: tableDocument().content,
        },
      ],
    };

    expect(
      shouldRejectTablePaste({
        isInsideTableCell: true,
        html: "<blockquote>Imported content</blockquote>",
        parsedContent,
      }),
    ).toBe(true);
  });

  it("allows simple text and TSV when no parsed table node is present", () => {
    expect(
      shouldRejectTablePaste({
        isInsideTableCell: true,
        html: "<p>Simple text</p>",
        parsedContent: paragraphDocument("Simple text"),
      }),
    ).toBe(false);
    expect(
      shouldRejectTablePaste({
        isInsideTableCell: true,
        html: "",
        parsedContent: paragraphDocument("A\tB\nC\tD"),
      }),
    ).toBe(false);
  });

  it("allows a table outside a table cell", () => {
    expect(
      shouldRejectTablePaste({
        isInsideTableCell: false,
        html: "<table><tbody><tr><td>Allowed</td></tr></tbody></table>",
        parsedContent: tableDocument(),
      }),
    ).toBe(false);
  });

  it("keeps the editor document and history unchanged when the pure decision refuses a paste", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Existing value" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    let textPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (textPosition === null && node.isText) textPosition = position;
    });
    if (textPosition === null) throw new Error("Missing table cell text");
    editor.commands.setTextSelection(textPosition);
    expect(editor.isActive("table")).toBe(true);
    const documentBefore = editor.state.doc;
    const historyBefore = undoDepth(editor.state);

    const rejected = shouldRejectTablePaste({
      isInsideTableCell: true,
      html: "<table><tbody><tr><td>Rejected</td></tr></tbody></table>",
      parsedContent: tableDocument(),
    });

    expect(rejected).toBe(true);
    expect(editor.state.doc.eq(documentBefore)).toBe(true);
    expect(undoDepth(editor.state)).toBe(historyBefore);
  });

  it("pastes a TSV rectangle into existing cells as one undoable change", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: Array.from({ length: 2 }, (_, rowIndex) => ({
              type: "tableRow",
              content: Array.from({ length: 2 }, (_, columnIndex) => ({
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: `${rowIndex}:${columnIndex}`,
                      },
                    ],
                  },
                ],
              })),
            })),
          },
        ],
      },
    });
    editors.push(editor);
    let firstTextPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (firstTextPosition === null && node.isText) firstTextPosition = position;
    });
    if (firstTextPosition === null) throw new Error("Missing first cell text");
    editor.commands.setTextSelection(firstTextPosition);
    const initialDoc = editor.state.doc;
    const initialHistory = undoDepth(editor.state);

    expect(pasteTableTsv(editor, "Alpha\tBeta\r\nGamma\tDelta")).toBe(true);
    const table = editor.state.doc.firstChild!;
    expect(
      Array.from({ length: 2 }, (_, rowIndex) =>
        Array.from(
          { length: 2 },
          (_, columnIndex) => table.child(rowIndex).child(columnIndex).textContent,
        ),
      ),
    ).toEqual([
      ["Alpha", "Beta"],
      ["Gamma", "Delta"],
    ]);
    expect(undoDepth(editor.state)).toBe(initialHistory + 1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.eq(initialDoc)).toBe(true);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.state.doc.firstChild?.child(1).child(1).textContent).toBe(
      "Delta",
    );
  });

  it("rejects an overflowing TSV rectangle without losing content or history", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: tableDocument(),
    });
    editors.push(editor);
    let textPosition: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (textPosition === null && node.isText) textPosition = position;
    });
    if (textPosition === null) throw new Error("Missing table text");
    editor.commands.setTextSelection(textPosition);
    const initialDoc = editor.state.doc;
    const initialHistory = undoDepth(editor.state);

    expect(pasteTableTsv(editor, "A\tB\nC\tD")).toBe(false);
    expect(editor.state.doc.eq(initialDoc)).toBe(true);
    expect(undoDepth(editor.state)).toBe(initialHistory);
  });

  it("serializes a selected cell rectangle as spreadsheet-compatible TSV", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", content: [paragraphDocument("A").content![0]] },
                  { type: "tableCell", content: [paragraphDocument("B").content![0]] },
                ],
              },
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", content: [paragraphDocument("C").content![0]] },
                  { type: "tableCell", content: [paragraphDocument("D").content![0]] },
                ],
              },
            ],
          },
        ],
      },
    });
    editors.push(editor);
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    const anchor = 1 + map.positionAt(0, 0, table);
    const head = 1 + map.positionAt(1, 1, table);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, anchor, head),
      ),
    );

    expect(serializeTableCellSelectionToTsv(editor)).toBe("A\tB\nC\tD");
    const beforePaste = editor.state.doc;
    expect(pasteTableTsv(editor, "W\tX\nY\tZ")).toBe(true);
    expect(editor.state.doc.firstChild?.child(0).child(0).textContent).toBe("W");
    expect(editor.state.doc.firstChild?.child(1).child(1).textContent).toBe("Z");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.eq(beforePaste)).toBe(true);
  });
});
