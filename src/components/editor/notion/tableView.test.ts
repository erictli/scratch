import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Fragment } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ScratchTableMetadata } from "./tableMetadata";
import {
  ScratchTableView,
  createScratchTableColumnResizePreview,
} from "./tableView";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("ScratchTableView", () => {
  it("previews only the manipulated column and restores the exact DOM snapshot", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit, ScratchTableMetadata],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { fitToWidth: true },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
                    content: [paragraph("Long multiline heading A")],
                  },
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: [240] },
                    content: [paragraph("Long multiline heading B")],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      const view = new ScratchTableView(editor.state.doc.nodeAt(0)!, 80);
      const originalTableStyle = view.table.style.cssText;
      const originalFitToWidth = view.table.dataset.fitToWidth;
      const originalColumnStyles = Array.from(view.colgroup.children).map(
        (column) => (column as HTMLElement).style.cssText,
      );
      const preview = createScratchTableColumnResizePreview(
        view.table,
        [200, 240],
        0,
        80,
      );
      if (!preview) throw new Error("Missing resize preview session");

      expect(preview.apply(280)).toBe(280);
      expect(
        Array.from(view.colgroup.children).map(
          (column) => (column as HTMLElement).style.width,
        ),
      ).toEqual(["280px", "240px"]);
      expect(view.table.style.width).toBe("520px");
      expect(view.table.style.maxWidth).toBe("none");
      expect(view.table.dataset.fitToWidth).toBeUndefined();

      expect(preview.apply(-500)).toBe(80);
      expect(
        Array.from(view.colgroup.children).map(
          (column) => (column as HTMLElement).style.width,
        ),
      ).toEqual(["80px", "240px"]);
      expect(view.table.style.width).toBe("320px");

      preview.restore();
      expect(view.table.style.cssText).toBe(originalTableStyle);
      expect(view.table.dataset.fitToWidth).toBe(originalFitToWidth);
      expect(
        Array.from(view.colgroup.children).map(
          (column) => (column as HTMLElement).style.cssText,
        ),
      ).toEqual(originalColumnStyles);
    } finally {
      editor.destroy();
    }
  });

  it("keeps nineteen neighboring columns stable through rapid repeated previews", () => {
    const table = document.createElement("table");
    const colgroup = document.createElement("colgroup");
    table.append(colgroup, document.createElement("tbody"));
    const baseline = Array.from({ length: 20 }, (_, index) => 80 + index * 5);
    baseline.forEach(() => colgroup.append(document.createElement("col")));
    const preview = createScratchTableColumnResizePreview(
      table,
      baseline,
      10,
      80,
    );
    if (!preview) throw new Error("Missing large-table resize preview");

    for (let step = 0; step < 100; step += 1) {
      preview.apply(80 + step * 3);
    }

    expect(
      Array.from(colgroup.children).map((column, index) =>
        (column as HTMLElement).style.width === `${baseline[index]}px`,
      ).filter(Boolean),
    ).toHaveLength(19);
    expect((colgroup.children[10] as HTMLElement).style.width).toBe("377px");
    expect(table.style.width).toBe(
      `${baseline.reduce((sum, width) => sum + width, 0) - baseline[10] + 377}px`,
    );
  });

  it("allows fixed-width tables to overflow their wrapper without browser redistribution", () => {
    const appStyles = readFileSync(
      resolve(process.cwd(), "src/App.css"),
      "utf8",
    );
    const wrapperRule = appStyles.match(/\.tableWrapper table\s*\{([^}]*)\}/)?.[1];
    const tableStyleSection = appStyles.match(
      /\/\* Table styles \*\/[\s\S]*?\/\* Avoid double lines/,
    )?.[0];

    expect(wrapperRule).toContain("max-width: none");
    expect(wrapperRule).toContain("table-layout: fixed");
    expect(wrapperRule).not.toContain("max-width: 100% !important");
    expect(tableStyleSection).toContain("min-width: 80px");
    expect(tableStyleSection).not.toContain("min-width: 120px");
  });

  it("removes a stale DOM column width when the document width is undone", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit, ScratchTableMetadata],
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
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
                    content: [paragraph("A")],
                  },
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [paragraph("B")],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      const table = editor.state.doc.nodeAt(0)!;
      const firstRow = table.child(0);
      const firstCell = firstRow.child(0);
      const clearedCell = firstCell.type.create(
        { ...firstCell.attrs, colwidth: null },
        firstCell.content,
        firstCell.marks,
      );
      const clearedRow = firstRow.type.create(
        firstRow.attrs,
        Fragment.fromArray([clearedCell, firstRow.child(1)]),
        firstRow.marks,
      );
      const clearedTable = table.type.create(
        table.attrs,
        Fragment.fromArray([clearedRow]),
        table.marks,
      );
      const view = new ScratchTableView(table, 25);
      const firstColumn = view.colgroup.children[0] as HTMLElement;

      expect(firstColumn.style.width).toBe("160px");
      expect(view.update(clearedTable)).toBe(true);
      expect(firstColumn.style.width).toBe("");
      expect(firstColumn.style.minWidth).toBe("25px");
    } finally {
      editor.destroy();
    }
  });

  it("renders fit-to-width tables responsively instead of freezing pixel widths", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit, ScratchTableMetadata],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { fitToWidth: true },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
                    content: [paragraph("A")],
                  },
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: [240] },
                    content: [paragraph("B")],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      const table = editor.state.doc.nodeAt(0)!;
      const view = new ScratchTableView(table, 25);

      expect(view.table.dataset.fitToWidth).toBe("true");
      expect(view.table.style.width).toBe("100%");
      expect(view.table.style.minWidth).toBe("");
      expect((view.colgroup.children[0] as HTMLElement).style.width).toBe(
        "50%",
      );
      expect((view.colgroup.children[1] as HTMLElement).style.width).toBe(
        "50%",
      );
    } finally {
      editor.destroy();
    }
  });

  it("removes temporarily appended col elements during restore and is idempotent", () => {
    const table = document.createElement("table");
    const colgroup = document.createElement("colgroup");
    const originalCol = document.createElement("col");
    originalCol.style.width = "80px";
    colgroup.append(originalCol);
    table.append(colgroup, document.createElement("tbody"));
    document.body.append(table);

    try {
      const preview = createScratchTableColumnResizePreview(
        table,
        [80, 120],
        0,
        80,
      );
      if (!preview) throw new Error("Missing resize preview session");

      expect(colgroup.children).toHaveLength(2);
      expect((colgroup.children[1] as HTMLElement).style.width).toBe("");

      preview.apply(280);
      expect(colgroup.children).toHaveLength(2);
      expect((colgroup.children[1] as HTMLElement).style.width).toBe("120px");

      preview.restore();
      expect(colgroup.children).toHaveLength(1);
      expect(colgroup.children[0]).toBe(originalCol);
      expect((originalCol as HTMLElement).style.width).toBe("80px");

      preview.restore();
      expect(colgroup.children).toHaveLength(1);
    } finally {
      table.remove();
    }
  });
});
