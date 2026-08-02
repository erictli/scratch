import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { undoDepth } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  MAX_TABLE_ROW_HEIGHT,
  MIN_TABLE_ROW_HEIGHT,
  ScratchTableRow,
  normalizeTableRowHeight,
} from "./tableExtensions";

describe("Scratch table row height", () => {
  it("keeps missing HTML attributes unset", () => {
    expect(normalizeTableRowHeight(null)).toBeNull();
    expect(normalizeTableRowHeight(undefined)).toBeNull();
    expect(normalizeTableRowHeight("")).toBeNull();
  });

  it("rounds and clamps explicit dimensions", () => {
    expect(normalizeTableRowHeight(41.6)).toBe(42);
    expect(normalizeTableRowHeight(1)).toBe(MIN_TABLE_ROW_HEIGHT);
    expect(normalizeTableRowHeight(9999)).toBe(MAX_TABLE_ROW_HEIGHT);
  });
});

describe("Scratch table structure", () => {
  it("rejects a live transaction that inserts a table inside a cell", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        TableKit.configure({ tableRow: false }),
        ScratchTableRow,
      ],
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
                        content: [{ type: "text", text: "Parent cell" }],
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

    try {
      editor.commands.setTextSelection(2);
      const originalDocument = editor.state.doc;
      const originalUndoDepth = undoDepth(editor.state);

      editor.commands.insertContent({
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
                    content: [{ type: "text", text: "Nested cell" }],
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(editor.state.doc.eq(originalDocument)).toBe(true);
      expect(editor.state.doc.textContent).toBe("Parent cell");
      expect(undoDepth(editor.state)).toBe(originalUndoDepth);
    } finally {
      editor.destroy();
    }
  });

  it("focuses only the table cell containing a text caret", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        TableKit.configure({ tableRow: false }),
        ScratchTableRow,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Before table" }],
          },
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
                        content: [{ type: "text", text: "A" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "C" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "D" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "After table" }],
          },
        ],
      },
    });

    try {
      const originalDocument = editor.state.doc;
      const originalUndoDepth = undoDepth(editor.state);
      const cellPositions: number[] = [];
      let outsideParagraphPosition: number | undefined;

      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "tableCell") {
          cellPositions.push(position);
        }
        if (
          node.type.name === "paragraph" &&
          node.textContent === "After table"
        ) {
          outsideParagraphPosition = position;
        }
      });

      expect(cellPositions).toHaveLength(4);
      expect(outsideParagraphPosition).toBeDefined();

      const focusedCellIndexes = () =>
        Array.from(editor.view.dom.querySelectorAll("td, th"))
          .map((cell, index) =>
            cell.classList.contains("scratch-table-cell-focused")
              ? index
              : -1,
          )
          .filter((index) => index >= 0);
      const setCaret = (position: number) => {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, position),
          ),
        );
      };

      setCaret(cellPositions[0] + 2);
      expect(focusedCellIndexes()).toEqual([0]);

      setCaret(cellPositions[1] + 2);
      expect(focusedCellIndexes()).toEqual([1]);

      setCaret(outsideParagraphPosition! + 1);
      expect(focusedCellIndexes()).toEqual([]);

      setCaret(cellPositions[0] + 2);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          CellSelection.create(
            editor.state.doc,
            cellPositions[0],
            cellPositions[1],
          ),
        ),
      );
      expect(editor.state.selection).toBeInstanceOf(CellSelection);
      expect(editor.view.dom.querySelectorAll(".selectedCell")).toHaveLength(2);
      expect(
        editor.view.dom.querySelectorAll(".scratch-table-cell-focused").length,
      ).toBeLessThanOrEqual(1);

      expect(editor.state.doc.eq(originalDocument)).toBe(true);
      expect(undoDepth(editor.state)).toBe(originalUndoDepth);
    } finally {
      editor.destroy();
    }
  });
});
