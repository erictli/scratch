import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { undoDepth } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ScratchTableRow } from "./tableExtensions";
import { ScratchTableMetadata } from "./tableMetadata";
import {
  clearTableColumn,
  clearTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  fitTableColumnsToWidth,
  insertTableColumn,
  deleteTableColumn,
  deleteTableRow,
  insertTableRow,
  moveTableColumn,
  moveTableRow,
  setTableColumnBackgroundColor,
  setTableColumnWidths,
  setTableRowBackgroundColor,
  setTableRowHeight,
  setTableRowHeightPreview,
  resizeTableAtEnd,
  toggleTableHeaderColumn,
  toggleTableHeaderRow,
} from "./tableTransactions";

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function cell(
  text: string,
  type: "tableCell" | "tableHeader",
  width: number,
): JSONContent {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
    content: [paragraph(text)],
  };
}

function createEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      TableKit.configure({ tableRow: false }),
      ScratchTableRow,
      ScratchTableMetadata,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              attrs: { rowHeight: 40 },
              type: "tableRow",
              content: [
                cell("A", "tableHeader", 120),
                cell("B", "tableHeader", 180),
                cell("C", "tableHeader", 240),
              ],
            },
            {
              attrs: { rowHeight: 50 },
              type: "tableRow",
              content: [
                cell("1A", "tableCell", 120),
                cell("1B", "tableCell", 180),
                cell("1C", "tableCell", 240),
              ],
            },
            {
              attrs: { rowHeight: 60 },
              type: "tableRow",
              content: [
                cell("2A", "tableCell", 120),
                cell("2B", "tableCell", 180),
                cell("2C", "tableCell", 240),
              ],
            },
          ],
        },
      ],
    },
  });
}

function tableMatrix(editor: Editor): string[][] {
  const table = editor.state.doc.nodeAt(0);
  if (!table || table.type.name !== "table") return [];

  return Array.from({ length: table.childCount }, (_, rowIndex) => {
    const row = table.child(rowIndex);
    return Array.from(
      { length: row.childCount },
      (_, cellIndex) => row.child(cellIndex).textContent,
    );
  });
}

describe("Scratch table structural transactions", () => {
  const editors: Editor[] = [];

  function editor() {
    const instance = createEditor();
    editors.push(instance);
    return instance;
  }

  afterEach(() => {
    editors.splice(0).forEach((instance) => instance.destroy());
  });

  it("moves and duplicates rows without changing cell types", () => {
    const instance = editor();

    expect(moveTableRow(instance, 0, 2, 1)).toBe(true);
    expect(instance.isActive("table")).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["A", "B", "C"],
      ["2A", "2B", "2C"],
      ["1A", "1B", "1C"],
    ]);

    expect(duplicateTableRow(instance, 0, 1)).toBe(true);
    expect(instance.isActive("table")).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["A", "B", "C"],
      ["2A", "2B", "2C"],
      ["2A", "2B", "2C"],
      ["1A", "1B", "1C"],
    ]);
    expect(instance.state.doc.nodeAt(0)?.child(0).child(0).type.name).toBe(
      "tableHeader",
    );
  });

  it("moves and duplicates columns across every row", () => {
    const instance = editor();

    expect(moveTableColumn(instance, 0, 2, 0)).toBe(true);
    expect(instance.isActive("table")).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["C", "A", "B"],
      ["1C", "1A", "1B"],
      ["2C", "2A", "2B"],
    ]);

    expect(duplicateTableColumn(instance, 0, 1)).toBe(true);
    expect(instance.isActive("table")).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["C", "A", "A", "B"],
      ["1C", "1A", "1A", "1B"],
      ["2C", "2A", "2A", "2B"],
    ]);
  });

  it("clears one row or column without removing its structure and supports undo", () => {
    const instance = editor();
    const initialDoc = instance.state.doc;

    expect(clearTableRow(instance, 0, 1)).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["A", "B", "C"],
      ["", "", ""],
      ["2A", "2B", "2C"],
    ]);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);

    expect(clearTableColumn(instance, 0, 1)).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["A", "", "C"],
      ["1A", "", "1C"],
      ["2A", "", "2C"],
    ]);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);
  });

  it("fits every column to the available width as one persistent undoable change", () => {
    const instance = editor();
    const initialDoc = instance.state.doc;

    expect(fitTableColumnsToWidth(instance, 0, 600)).toBe(true);
    const table = instance.state.doc.nodeAt(0)!;
    expect(table.attrs.fitToWidth).toBe(true);
    for (let rowIndex = 0; rowIndex < table.childCount; rowIndex += 1) {
      const row = table.child(rowIndex);
      expect(
        Array.from(
          { length: row.childCount },
          (_, columnIndex) => row.child(columnIndex).attrs.colwidth,
        ),
      ).toEqual([[200], [200], [200]]);
    }

    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.fitToWidth).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(0).child(0).attrs.colwidth).toEqual([
      200,
    ]);
  });

  it("commits explicit column widths across every row as one undoable change", () => {
    const instance = editor();
    expect(fitTableColumnsToWidth(instance, 0, 600)).toBe(true);
    const fittedDocument = instance.state.doc;
    const historyBefore = undoDepth(instance.state);

    expect(setTableColumnWidths(instance, 0, [160, 280, 340])).toBe(true);
    const resizedTable = instance.state.doc.nodeAt(0)!;
    expect(resizedTable.attrs.fitToWidth).toBe(false);
    expect(
      Array.from({ length: resizedTable.childCount }, (_, rowIndex) =>
        Array.from(
          { length: resizedTable.child(rowIndex).childCount },
          (_, columnIndex) =>
            resizedTable.child(rowIndex).child(columnIndex).attrs.colwidth?.[0],
        ),
      ),
    ).toEqual([
      [160, 280, 340],
      [160, 280, 340],
      [160, 280, 340],
    ]);
    expect(undoDepth(instance.state)).toBe(historyBefore + 1);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(fittedDocument)).toBe(true);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(0).child(1).attrs.colwidth).toEqual([
      280,
    ]);
  });

  it("clamps committed column widths and rejects malformed geometry", () => {
    const instance = editor();

    expect(setTableColumnWidths(instance, 0, [1, 180.4, 240.6])).toBe(true);
    expect(
      Array.from(
        { length: 3 },
        (_, columnIndex) =>
          instance.state.doc.nodeAt(0)?.child(0).child(columnIndex).attrs
            .colwidth?.[0],
      ),
    ).toEqual([80, 180, 241]);
    const resizedDocument = instance.state.doc;
    const historyBefore = undoDepth(instance.state);
    expect(setTableColumnWidths(instance, 0, [100, Number.NaN, 300])).toBe(false);
    expect(setTableColumnWidths(instance, 0, [100, 200])).toBe(false);
    expect(instance.state.doc.eq(resizedDocument)).toBe(true);
    expect(undoDepth(instance.state)).toBe(historyBefore);
  });

  it("toggles header rows and columns as one persistent undoable change", () => {
    const instance = editor();
    const initialDoc = instance.state.doc;

    expect(toggleTableHeaderRow(instance, 0)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerRow).toBe(false);
    expect(instance.state.doc.nodeAt(0)?.child(0).child(0).type.name).toBe(
      "tableCell",
    );
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerRow).toBe(false);

    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerColumn).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).child(0).type.name).toBe(
      "tableHeader",
    );
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerColumn).toBe(false);
  });

  it("activates a header column on a one-row Markdown table without confusing it with the header row", () => {
    const instance = editor();
    const table = instance.state.doc.nodeAt(0)!;
    const oneRowTable = table.type.create(table.attrs, [table.child(0)]);
    instance.view.dispatch(
      instance.state.tr.replaceWith(0, table.nodeSize, oneRowTable),
    );

    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerColumn).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.attrs.headerRow).toBe(true);

    expect(toggleTableHeaderRow(instance, 0)).toBe(true);
    const updated = instance.state.doc.nodeAt(0)!;
    expect(updated.attrs.headerRow).toBe(false);
    expect(updated.attrs.headerColumn).toBe(true);
    expect(updated.child(0).child(0).type.name).toBe("tableHeader");
    expect(updated.child(0).child(1).type.name).toBe("tableCell");
  });

  it("keeps header-column semantics on the first column after moves and duplication", () => {
    const instance = editor();

    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);
    expect(moveTableColumn(instance, 0, 2, 0)).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["C", "A", "B"],
      ["1C", "1A", "1B"],
      ["2C", "2A", "2B"],
    ]);

    let table = instance.state.doc.nodeAt(0)!;
    expect(
      Array.from({ length: table.childCount }, (_, rowIndex) =>
        table.child(rowIndex).child(0).type.name,
      ),
    ).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
    expect(table.child(1).child(1).type.name).toBe("tableCell");

    expect(duplicateTableColumn(instance, 0, 0)).toBe(true);
    table = instance.state.doc.nodeAt(0)!;
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(table.child(2).child(1).type.name).toBe("tableCell");
    expect(table.attrs.headerColumn).toBe(true);
  });

  it("keeps exactly one header column when inserting beside or deleting the first column", () => {
    const instance = editor();
    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);

    expect(insertTableColumn(instance, 0, 1)).toBe(true);
    let table = instance.state.doc.nodeAt(0)!;
    expect(table.child(0).childCount).toBe(4);
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(table.child(2).child(1).type.name).toBe("tableCell");
    expect(instance.commands.undo()).toBe(true);
    expect(instance.commands.redo()).toBe(true);

    expect(deleteTableColumn(instance, 0, 0)).toBe(true);
    table = instance.state.doc.nodeAt(0)!;
    expect(table.child(0).childCount).toBe(3);
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(table.attrs.headerColumn).toBe(true);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).child(0).type.name).toBe(
      "tableHeader",
    );
  });

  it("inserts and deletes body rows without losing header-row or header-column semantics", () => {
    const instance = editor();
    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);

    expect(insertTableRow(instance, 0, 1)).toBe(true);
    let table = instance.state.doc.nodeAt(0)!;
    expect(table.childCount).toBe(4);
    expect(
      Array.from({ length: table.child(0).childCount }, (_, columnIndex) =>
        table.child(0).child(columnIndex).type.name,
      ),
    ).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(instance.commands.undo()).toBe(true);
    expect(instance.commands.redo()).toBe(true);

    expect(deleteTableRow(instance, 0, 1)).toBe(true);
    table = instance.state.doc.nodeAt(0)!;
    expect(table.childCount).toBe(3);
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(deleteTableRow(instance, 0, 0)).toBe(false);
  });

  it("refuses insertion above a pinned header row", () => {
    const instance = editor();
    const before = instance.state.doc;
    const tableBefore = before.nodeAt(0)!;
    const headerLabels = Array.from(
      { length: tableBefore.child(0).childCount },
      (_, columnIndex) => tableBefore.child(0).child(columnIndex).textContent,
    );

    expect(insertTableRow(instance, 0, 0)).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
    const tableAfter = instance.state.doc.nodeAt(0)!;
    expect(
      Array.from(
        { length: tableAfter.child(0).childCount },
        (_, columnIndex) => tableAfter.child(0).child(columnIndex).textContent,
      ),
    ).toEqual(headerLabels);
    expect(
      Array.from(
        { length: tableAfter.child(0).childCount },
        (_, columnIndex) => tableAfter.child(0).child(columnIndex).type.name,
      ),
    ).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
  });

  it("changes multiple edge rows or columns in one history entry while preserving headers", () => {
    const instance = editor();
    expect(toggleTableHeaderColumn(instance, 0)).toBe(true);
    const initialColumns = instance.state.doc.nodeAt(0)?.child(0).childCount;
    const historyBefore = instance.state.doc;

    expect(resizeTableAtEnd(instance, 0, "column", 2)).toBe(true);
    let table = instance.state.doc.nodeAt(0)!;
    expect(table.child(0).childCount).toBe((initialColumns ?? 0) + 2);
    expect(table.child(1).child(0).type.name).toBe("tableHeader");
    expect(table.child(1).child(1).type.name).toBe("tableCell");
    expect(table.child(1).child(4).type.name).toBe("tableCell");
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(historyBefore)).toBe(true);
    expect(instance.commands.redo()).toBe(true);

    expect(resizeTableAtEnd(instance, 0, "row", 2)).toBe(true);
    table = instance.state.doc.nodeAt(0)!;
    expect(table.childCount).toBe(5);
    expect(table.child(4).child(0).type.name).toBe("tableHeader");
    expect(table.child(4).child(1).type.name).toBe("tableCell");
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.childCount).toBe(3);
  });

  it("colors a complete row or column safely and keeps each action undoable", () => {
    const instance = editor();
    const initialDoc = instance.state.doc;

    expect(setTableRowBackgroundColor(instance, 0, 1, "#fde047")).toBe(
      true,
    );
    expect(
      Array.from(
        { length: 3 },
        (_, columnIndex) =>
          instance.state.doc.nodeAt(0)?.child(1).child(columnIndex).attrs
            .backgroundColor,
      ),
    ).toEqual(["#fde047", "#fde047", "#fde047"]);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);

    expect(setTableColumnBackgroundColor(instance, 0, 2, "#bae6fd")).toBe(
      true,
    );
    expect(
      Array.from(
        { length: 3 },
        (_, rowIndex) =>
          instance.state.doc.nodeAt(0)?.child(rowIndex).child(2).attrs
            .backgroundColor,
      ),
    ).toEqual(["#bae6fd", "#bae6fd", "#bae6fd"]);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);

    expect(
      setTableRowBackgroundColor(
        instance,
        0,
        1,
        "url(javascript:alert(1))",
      ),
    ).toBe(false);
    expect(instance.state.doc.eq(initialDoc)).toBe(true);
  });

  it("stores clamped row heights and rejects invalid indexes", () => {
    const instance = editor();

    expect(setTableRowHeight(instance, 0, 1, 10)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).attrs.rowHeight).toBe(28);
    expect(setTableRowHeight(instance, 0, 1, 9999)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).attrs.rowHeight).toBe(480);

    expect(moveTableRow(instance, 0, -1, 1)).toBe(false);
    expect(moveTableColumn(instance, 0, 8, 0)).toBe(false);
    expect(duplicateTableRow(instance, 999, 0)).toBe(false);
  });

  it("previews row height outside history, then commits one undoable change", () => {
    const instance = editor();
    const previewTransactions: unknown[] = [];
    instance.on("transaction", ({ transaction }) => {
      previewTransactions.push(
        transaction.getMeta("scratchTableRowResizePreview"),
      );
    });

    expect(setTableRowHeightPreview(instance, 0, 1, 86)).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).attrs.rowHeight).toBe(86);
    expect(previewTransactions[previewTransactions.length - 1]).toBe(true);

    expect(setTableRowHeightPreview(instance, 0, 1, 50)).toBe(true);
    expect(setTableRowHeight(instance, 0, 1, 86)).toBe(true);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).attrs.rowHeight).toBe(50);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.nodeAt(0)?.child(1).attrs.rowHeight).toBe(86);
  });

  it("keeps the Markdown header row fixed", () => {
    const instance = editor();

    expect(moveTableRow(instance, 0, 0, 1)).toBe(false);
    expect(moveTableRow(instance, 0, 1, 0)).toBe(false);
    expect(duplicateTableRow(instance, 0, 0)).toBe(false);
    expect(tableMatrix(instance)).toEqual([
      ["A", "B", "C"],
      ["1A", "1B", "1C"],
      ["2A", "2B", "2C"],
    ]);
  });

  it("preserves geometry and supports undo and redo around row and column moves", () => {
    const instance = editor();
    const geometry = () => {
      const table = instance.state.doc.nodeAt(0)!;
      return {
        rows: Array.from(
          { length: table.childCount },
          (_, index) => table.child(index).attrs.rowHeight,
        ),
        columns: Array.from(
          { length: table.child(0).childCount },
          (_, index) => table.child(0).child(index).attrs.colwidth?.[0],
        ),
      };
    };

    expect(moveTableRow(instance, 0, 2, 1)).toBe(true);
    expect(moveTableColumn(instance, 0, 2, 0)).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["C", "A", "B"],
      ["2C", "2A", "2B"],
      ["1C", "1A", "1B"],
    ]);
    expect(geometry()).toEqual({
      rows: [40, 60, 50],
      columns: [240, 120, 180],
    });

    expect(instance.commands.undo()).toBe(true);
    expect(geometry()).toEqual({
      rows: [40, 60, 50],
      columns: [120, 180, 240],
    });
    expect(instance.commands.undo()).toBe(true);
    expect(tableMatrix(instance)).toEqual([
      ["A", "B", "C"],
      ["1A", "1B", "1C"],
      ["2A", "2B", "2C"],
    ]);
    expect(geometry()).toEqual({
      rows: [40, 50, 60],
      columns: [120, 180, 240],
    });

    expect(instance.commands.redo()).toBe(true);
    expect(instance.commands.redo()).toBe(true);
    expect(geometry()).toEqual({
      rows: [40, 60, 50],
      columns: [240, 120, 180],
    });
  });

  it("refuses destructive column operations on merged cells", () => {
    const instance = editor();
    const table = instance.state.doc.nodeAt(0);
    expect(table).toBeTruthy();

    const mergedHeader = table!.child(0).child(0).type.create(
      { colspan: 2, rowspan: 1, colwidth: null },
      table!.child(0).child(0).content,
    );
    const header = table!.child(0).type.create(
      table!.child(0).attrs,
      [mergedHeader, table!.child(0).child(2)],
    );
    const mergedTable = table!.type.create(table!.attrs, [
      header,
      table!.child(1),
      table!.child(2),
    ]);
    instance.view.dispatch(
      instance.state.tr.replaceWith(0, table!.nodeSize, mergedTable),
    );

    expect(moveTableColumn(instance, 0, 0, 1)).toBe(false);
    expect(duplicateTableColumn(instance, 0, 0)).toBe(false);
    expect(moveTableRow(instance, 0, 0, 1)).toBe(false);
    expect(duplicateTableRow(instance, 0, 0)).toBe(false);
  });
});
