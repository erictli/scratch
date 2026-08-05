import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { replaceEditorContentWithoutHistory } from "../editorHistory";
import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "./markdownDocument";
import { ScratchTableRow } from "./tableExtensions";
import { containsNestedTable } from "./tableIntegrity";
import { moveTableColumn, moveTableRow } from "./tableTransactions";

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function cell(
  text: string,
  type: "tableCell" | "tableHeader" = "tableCell",
): JSONContent {
  return { type, content: [paragraph(text)] };
}

function row(...cells: JSONContent[]): JSONContent {
  return { type: "tableRow", content: cells };
}

function table(...rows: JSONContent[]): JSONContent {
  return { type: "table", content: rows };
}

function documentWith(tableNode: JSONContent): JSONContent {
  return { type: "doc", content: [tableNode] };
}

function tableTexts(editor: Editor): string[] {
  const tableNode = editor.state.doc.nodeAt(0);
  if (!tableNode || tableNode.type.name !== "table") return [];

  return Array.from({ length: tableNode.childCount }, (_, rowIndex) => {
    const rowNode = tableNode.child(rowIndex);
    return Array.from(
      { length: rowNode.childCount },
      (_, columnIndex) => rowNode.child(columnIndex).textContent,
    );
  }).flat();
}

function expectSafeRectangularTables(editor: Editor): void {
  const tableWidths: number[][] = [];
  const forbiddenDescendants: string[] = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name === "table") {
      const widths = Array.from(
        { length: node.childCount },
        (_, rowIndex) => node.child(rowIndex).childCount,
      );
      tableWidths.push(widths);
    }

    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      node.descendants((descendant) => {
        if (
          descendant.type.name === "table" ||
          descendant.type.name === "tableRow" ||
          descendant.type.name === "tableCell" ||
          descendant.type.name === "tableHeader"
        ) {
          forbiddenDescendants.push(descendant.type.name);
        }
      });
    }
  });

  expect(tableWidths.length).toBeGreaterThan(0);
  for (const widths of tableWidths) {
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(new Set(widths).size).toBe(1);
  }
  expect(containsNestedTable(editor.getJSON())).toBe(false);
  expect(forbiddenDescendants).toEqual([]);
}

describe("table non-regression integrity", () => {
  const editors: Editor[] = [];

  function createEditor(content?: JSONContent): Editor {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ trailingNode: false }),
        TableKit.configure({ tableRow: false }),
        ScratchTableRow,
        Markdown,
      ],
      content,
    });
    editors.push(editor);
    return editor;
  }

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it("keeps every cell rectangular and unnested through successive moves, undo, and redo", () => {
    const editor = createEditor(
      documentWith(
        table(
          row(...[1, 2, 3, 4].map((value) => cell(`H${value}`, "tableHeader"))),
          ...["A", "B", "C"].map((prefix) =>
            row(...[1, 2, 3, 4].map((value) => cell(`${prefix}${value}`))),
          ),
        ),
      ),
    );
    const initialDocument = editor.state.doc;
    const expectedTexts = [...tableTexts(editor)].sort();
    const assertInvariant = () => {
      expectSafeRectangularTables(editor);
      expect([...tableTexts(editor)].sort()).toEqual(expectedTexts);
    };

    expect(moveTableRow(editor, 0, 3, 1)).toBe(true);
    assertInvariant();
    expect(moveTableRow(editor, 0, 3, 2)).toBe(true);
    assertInvariant();
    expect(moveTableColumn(editor, 0, 3, 0)).toBe(true);
    assertInvariant();
    expect(moveTableColumn(editor, 0, 1, 3)).toBe(true);
    assertInvariant();

    const movedDocument = editor.state.doc;
    expect(tableTexts(editor)).toEqual([
      "H4", "H2", "H3", "H1",
      "C4", "C2", "C3", "C1",
      "B4", "B2", "B3", "B1",
      "A4", "A2", "A3", "A1",
    ]);

    for (let index = 0; index < 4; index += 1) {
      expect(editor.commands.undo()).toBe(true);
      assertInvariant();
    }
    expect(editor.state.doc.eq(initialDocument)).toBe(true);
    expect(editor.commands.undo()).toBe(false);

    for (let index = 0; index < 4; index += 1) {
      expect(editor.commands.redo()).toBe(true);
      assertInvariant();
    }
    expect(editor.state.doc.eq(movedDocument)).toBe(true);
    expect(editor.commands.redo()).toBe(false);
  });

  it("rejects destructive or invalid moves on a 1 x 1 table without document or history changes", () => {
    const editor = createEditor(documentWith(table(row(cell("Only cell")))));
    const originalDocument = editor.state.doc;
    const originalUndoDepth = undoDepth(editor.state);
    const originalRedoDepth = redoDepth(editor.state);

    expect(moveTableRow(editor, 0, 0, 0)).toBe(false);
    expect(moveTableRow(editor, 0, 0, 1)).toBe(false);
    expect(moveTableRow(editor, 0, -1, 0)).toBe(false);
    expect(moveTableColumn(editor, 0, 0, 0)).toBe(false);
    expect(moveTableColumn(editor, 0, 0, 1)).toBe(false);
    expect(moveTableColumn(editor, 0, -1, 0)).toBe(false);

    expect(editor.state.doc.eq(originalDocument)).toBe(true);
    expect(undoDepth(editor.state)).toBe(originalUndoDepth);
    expect(redoDepth(editor.state)).toBe(originalRedoDepth);
    expectSafeRectangularTables(editor);
  });

  it("keeps parent and nested text unnested after normalization, serialization, and reopening", () => {
    const editor = createEditor();
    const malformedDocument = documentWith(
      table(
        row(cell("Heading", "tableHeader")),
        row({
          type: "tableCell",
          content: [
            paragraph("Parent text"),
            table(row(cell("Nested table text"))),
            cell("Nested cell text"),
          ],
        }),
      ),
    );

    replaceEditorContentWithoutHistory(editor, malformedDocument);
    expectSafeRectangularTables(editor);

    const markdown = serializeMarkdownDocument(
      editor.storage.markdown.manager,
      editor.getJSON(),
    );
    const reopenedEditor = createEditor();
    replaceEditorContentWithoutHistory(
      reopenedEditor,
      parseMarkdownDocument(reopenedEditor.storage.markdown.manager, markdown),
    );

    expectSafeRectangularTables(reopenedEditor);
    for (const text of [
      "Parent text",
      "Nested table text",
      "Nested cell text",
    ]) {
      expect(reopenedEditor.state.doc.textContent).toContain(text);
    }
  });
});
