import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ScratchTableRow } from "./tableExtensions";
import { containsNestedTable } from "./tableIntegrity";
import { ScratchTableMetadata } from "./tableMetadata";
import { moveTableColumn } from "./tableTransactions";

function paragraph(text: string, bold = false): JSONContent {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text,
        marks: bold ? [{ type: "bold" }] : undefined,
      },
    ],
  };
}

function tableDocument(rowCount: number, columnCount: number): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: Array.from({ length: rowCount }, (_, rowIndex) => ({
          type: "tableRow",
          content: Array.from({ length: columnCount }, (_, columnIndex) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            attrs: {
              colspan: 1,
              rowspan: 1,
              colwidth: [100],
              backgroundColor:
                (rowIndex + columnIndex) % 7 === 0 ? "#fde047" : null,
            },
            content:
              rowIndex === rowCount - 1 && columnIndex === columnCount - 1
                ? [paragraph("Multiline A", true), paragraph("Multiline B")]
                : [paragraph(`R${rowIndex + 1}C${columnIndex + 1}`, columnIndex % 5 === 0)],
          })),
        })),
      },
    ],
  };
}

describe("table structural performance", () => {
  const editors: Editor[] = [];

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it.each([
    { rows: 3, columns: 3 },
    { rows: 20, columns: 20 },
    { rows: 100, columns: 20 },
  ])(
    "moves one column in a $rows x $columns styled table without corruption",
    ({ rows, columns }) => {
      const editor = new Editor({
        extensions: [
          StarterKit.configure({ trailingNode: false }),
          TableKit.configure({ tableRow: false }),
          ScratchTableRow,
          ScratchTableMetadata,
        ],
        content: tableDocument(rows, columns),
      });
      editors.push(editor);
      const cellTextsBefore = Array.from(
        { length: rows },
        (_, rowIndex) =>
          Array.from(
            { length: columns },
            (_, columnIndex) =>
              editor.state.doc.firstChild!
                .child(rowIndex)
                .child(columnIndex).textContent,
          ),
      )
        .flat()
        .sort();

      expect(moveTableColumn(editor, 0, columns - 1, 0)).toBe(true);

      const table = editor.state.doc.firstChild!;
      expect(table.childCount).toBe(rows);
      expect(
        Array.from({ length: table.childCount }, (_, rowIndex) =>
          table.child(rowIndex).childCount,
        ),
      ).toEqual(Array.from({ length: rows }, () => columns));
      const cellTextsAfter = Array.from(
        { length: rows },
        (_, rowIndex) =>
          Array.from(
            { length: columns },
            (_, columnIndex) =>
              table.child(rowIndex).child(columnIndex).textContent,
          ),
      )
        .flat()
        .sort();
      expect(cellTextsAfter).toEqual(cellTextsBefore);
      expect(containsNestedTable(editor.getJSON())).toBe(false);
    },
  );
});
