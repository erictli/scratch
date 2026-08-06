import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { undoDepth } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScratchTableRow } from "./tableExtensions";
import { ScratchTableMetadata } from "./tableMetadata";
import {
  TableControls,
  hasValidRowResizeGeometry,
  layoutsEquivalent,
  selectTableAxis,
  type TableLayout,
} from "./TableControls";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
  true;

const REMOVED_TABLE_CONTROL_SELECTOR = [
  ".notion-table-row-handle",
  ".notion-table-column-handle",
  ".notion-table-add-control",
].join(", ");

function createRect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

function layoutWith(
  rows: DOMRect[],
  columns: DOMRect[],
  tableRect = createRect(100, 100, 500, 220),
): TableLayout {
  return {
    tablePos: 0,
    rowIndex: 0,
    columnIndex: 0,
    tableRect,
    rowRects: rows,
    columnRects: columns,
    rowElements: rows.map(() => document.createElement("tr")),
  };
}

describe("table control geometry guards", () => {
  it("rejects a stale DOM layout with fewer measured rows than the document", () => {
    const rows = [document.createElement("tr"), document.createElement("tr")];
    const rects = [
      createRect(100, 100, 500, 160),
      createRect(100, 160, 500, 220),
    ];

    expect(hasValidRowResizeGeometry(rows, rects, 3, 2)).toBe(false);
    expect(hasValidRowResizeGeometry(rows, rects, 3, 1)).toBe(true);
  });

  it("detects structural and geometric layout changes at the same table position", () => {
    const base = layoutWith(
      [createRect(100, 100, 500, 220)],
      [createRect(100, 100, 300, 220), createRect(300, 100, 500, 220)],
    );
    const insertedColumn = layoutWith(
      base.rowRects,
      [
        createRect(100, 100, 233, 220),
        createRect(233, 100, 366, 220),
        createRect(366, 100, 500, 220),
      ],
    );
    const movedTable = layoutWith(
      base.rowRects,
      base.columnRects,
      createRect(120, 100, 520, 220),
    );

    expect(layoutsEquivalent(base, base)).toBe(true);
    expect(layoutsEquivalent(base, insertedColumn)).toBe(false);
    expect(layoutsEquivalent(base, movedTable)).toBe(false);
  });

  it("rejects a stale row index without reading past the table", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: "<table><tbody><tr><td><p>A1</p></td></tr></tbody></table>",
    });
    const staleLayout = layoutWith(
      [createRect(100, 100, 500, 160), createRect(100, 160, 500, 220)],
      [createRect(100, 100, 500, 220)],
    );

    try {
      expect(selectTableAxis(editor, staleLayout, "row", 1)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});

async function flushLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

interface TableFixture {
  editor: Editor;
  root: Root;
  editorHost: HTMLElement;
  rows: HTMLTableRowElement[];
  cells: HTMLTableCellElement[][];
}

function createTableFixture(): TableFixture {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TableKit.configure({
        tableRow: false,
        table: {
          resizable: true,
          handleWidth: 6,
          cellMinWidth: 80,
          lastColumnResizable: true,
        },
      }),
      ScratchTableRow,
      ScratchTableMetadata,
    ],
    content: [
      "<table>",
      "<tbody>",
      "<tr><td><p>A1</p></td><td><p>B1</p></td></tr>",
      "<tr><td><p>A2</p></td><td><p>B2</p></td></tr>",
      "</tbody>",
      "</table>",
    ].join(""),
  });

  const editorHost = document.createElement("div");
  const controlsHost = document.createElement("div");
  editorHost.append(editor.view.dom, controlsHost);
  document.body.append(editorHost);
  const root = createRoot(controlsHost);

  const table = editor.view.dom.querySelector("table");
  if (!table) throw new Error("Missing table fixture");
  const rows = Array.from(table.rows);
  const cells = rows.map((row) => Array.from(row.cells));
  if (rows.length !== 2 || cells.some((row) => row.length !== 2)) {
    throw new Error("Expected a 2 x 2 table fixture");
  }

  editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 600);
  table.getBoundingClientRect = () => createRect(100, 100, 500, 220);
  rows[0].getBoundingClientRect = () => createRect(100, 100, 500, 160);
  rows[1].getBoundingClientRect = () => createRect(100, 160, 500, 220);
  cells[0][0].getBoundingClientRect = () => createRect(100, 100, 300, 160);
  cells[0][1].getBoundingClientRect = () => createRect(300, 100, 500, 160);
  cells[1][0].getBoundingClientRect = () => createRect(100, 160, 300, 220);
  cells[1][1].getBoundingClientRect = () => createRect(300, 160, 500, 220);

  let firstTextPosition: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (firstTextPosition === null && node.isText) {
      firstTextPosition = position;
    }
  });
  if (firstTextPosition === null) throw new Error("Missing table cell text");
  editor.commands.setTextSelection(firstTextPosition);

  return { editor, root, editorHost, rows, cells };
}

async function movePointer(
  fixture: TableFixture,
  left: number,
  top: number,
  target: EventTarget = fixture.editor.view.dom,
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: left,
        clientY: top,
        isPrimary: true,
        pointerId: 1,
      }),
    );
    await flushLayout();
  });
}

async function dragRowResizeHandle(
  handle: HTMLButtonElement,
  start: { left: number; top: number },
  end: { left: number; top: number },
  pointerId: number,
): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: start.left,
        clientY: start.top,
        isPrimary: true,
        pointerId,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: end.left,
        clientY: end.top,
        isPrimary: true,
        pointerId,
      }),
    );
    await flushLayout();
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: end.left,
        clientY: end.top,
        isPrimary: true,
        pointerId,
      }),
    );
    await flushLayout();
  });
}

describe("TableControls without postponed structural controls", () => {
  let fixture: TableFixture | null = null;

  beforeEach(() => {
    class ResizeObserverMock implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(async () => {
    if (fixture) {
      const currentFixture = fixture;
      fixture = null;
      await act(async () => currentFixture.root.unmount());
      currentFixture.editor.destroy();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.style.removeProperty("zoom");
  });

  async function renderFixture(): Promise<TableFixture> {
    fixture = createTableFixture();
    await act(async () => {
      fixture?.root.render(<TableControls editor={fixture.editor} />);
      await flushLayout();
    });
    return fixture;
  }

  it("does not render postponed controls before pointer interaction", async () => {
    await renderFixture();

    expect(document.querySelector(".notion-table-controls")).not.toBeNull();
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("never renders row grabs, column grabs, or add controls around a table", async () => {
    const currentFixture = await renderFixture();

    for (const point of [
      { left: 96, top: 190 },
      { left: 400, top: 96 },
      { left: 300, top: 236 },
      { left: 516, top: 160 },
    ]) {
      await movePointer(currentFixture, point.left, point.top);
      expect(document.querySelector(".notion-table-controls")).not.toBeNull();
      expect(document.querySelector(".notion-table-row-handle")).toBeNull();
      expect(document.querySelector(".notion-table-column-handle")).toBeNull();
      expect(document.querySelector(".notion-table-add-control")).toBeNull();
      expect(document.querySelector(".notion-table-edge-resize")).toBeNull();
    }
  });

  it("resizes one column live without moving its neighbors or mutating history early", async () => {
    const currentFixture = await renderFixture();
    const initialDocument = currentFixture.editor.state.doc;
    const historyBefore = undoDepth(currentFixture.editor.state);
    const table = currentFixture.editor.view.dom.querySelector("table");
    if (!table) throw new Error("Missing live resize table");

    await movePointer(currentFixture, 300, 130, currentFixture.cells[0][0]);
    const handle = document.querySelector<HTMLButtonElement>(
      '.notion-table-column-resize[aria-label="Resize column 1"]',
    );
    if (!handle) throw new Error("Missing column border resize handle");
    expect(handle.style.left).toBe("292px");

    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 300,
          clientY: 130,
          isPrimary: true,
          pointerId: 91,
        }),
      );
      for (const clientX of [320, 340, 360]) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX,
            clientY: 130,
            isPrimary: true,
            pointerId: 91,
          }),
        );
      }
      await flushLayout();
    });

    const columns = Array.from(table.querySelectorAll("col"));
    expect(columns.map((column) => column.style.width)).toEqual([
      "260px",
      "200px",
    ]);
    expect(table.style.width).toBe("460px");
    expect(handle.style.left).toBe("352px");
    expect(currentFixture.editor.state.doc.eq(initialDocument)).toBe(true);
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore);

    const selectStart = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    const dragStart = new Event("dragstart", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(selectStart);
    window.dispatchEvent(dragStart);
    expect(selectStart.defaultPrevented).toBe(true);
    expect(dragStart.defaultPrevented).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 360,
          clientY: 130,
          isPrimary: true,
          pointerId: 91,
        }),
      );
      await flushLayout();
    });

    const resizedTable = currentFixture.editor.state.doc.firstChild!;
    expect(
      Array.from({ length: resizedTable.childCount }, (_, rowIndex) =>
        Array.from(
          { length: resizedTable.child(rowIndex).childCount },
          (_, columnIndex) =>
            resizedTable.child(rowIndex).child(columnIndex).attrs.colwidth?.[0],
        ),
      ),
    ).toEqual([
      [260, 200],
      [260, 200],
    ]);
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore + 1);
    expect(document.body.classList.contains("notion-table-column-resizing"))
      .toBe(false);
    expect(currentFixture.editor.commands.undo()).toBe(true);
    expect(currentFixture.editor.state.doc.eq(initialDocument)).toBe(true);
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("keeps rapid 120% column resizing pointer-aligned and clamps the minimum", async () => {
    document.documentElement.style.zoom = "1.2";
    const currentFixture = createTableFixture();
    fixture = currentFixture;
    const table = currentFixture.editor.view.dom.querySelector("table");
    if (!table) throw new Error("Missing zoomed resize table");
    table.getBoundingClientRect = () => createRect(120, 120, 600, 264);
    currentFixture.rows[0].getBoundingClientRect = () =>
      createRect(120, 120, 600, 192);
    currentFixture.rows[1].getBoundingClientRect = () =>
      createRect(120, 192, 600, 264);
    currentFixture.cells[0][0].getBoundingClientRect = () =>
      createRect(120, 120, 360, 192);
    currentFixture.cells[0][1].getBoundingClientRect = () =>
      createRect(360, 120, 600, 192);
    currentFixture.cells[1][0].getBoundingClientRect = () =>
      createRect(120, 192, 360, 264);
    currentFixture.cells[1][1].getBoundingClientRect = () =>
      createRect(360, 192, 600, 264);

    await act(async () => {
      currentFixture.root.render(
        <TableControls editor={currentFixture.editor} />,
      );
      await flushLayout();
    });

    await movePointer(currentFixture, 360, 150, currentFixture.cells[0][0]);
    const handle = document.querySelector<HTMLButtonElement>(
      '.notion-table-column-resize[aria-label="Resize column 1"]',
    );
    if (!handle) throw new Error("Missing zoomed column border resize handle");
    expect(handle.style.left).toBe("292px");

    await act(async () => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 360,
          clientY: 150,
          isPrimary: true,
          pointerId: 92,
        }),
      );
      for (const clientX of [384, 96, 408]) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX,
            clientY: 150,
            isPrimary: true,
            pointerId: 92,
          }),
        );
      }
      await flushLayout();
    });

    expect(
      Array.from(table.querySelectorAll("col")).map(
        (column) => column.style.width,
      ),
    ).toEqual(["240px", "200px"]);
    expect(handle.style.left).toBe("332px");
    expect(table.style.width).toBe("440px");

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          clientX: 96,
          clientY: 150,
          isPrimary: true,
          pointerId: 92,
        }),
      );
      await flushLayout();
    });
    expect(
      Array.from(table.querySelectorAll("col")).map(
        (column) => column.style.width,
      ),
    ).toEqual(["80px", "200px"]);

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: 92,
        }),
      );
      await flushLayout();
    });
    expect(currentFixture.editor.state.doc.firstChild?.child(0).child(0).attrs
      .colwidth).toBeNull();
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("keeps the table block gutter free for global editor controls", async () => {
    const currentFixture = await renderFixture();

    await movePointer(currentFixture, 72, 72);

    expect(document.querySelector(".notion-table-options-handle")).toBeNull();
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("preserves TableKit Tab navigation between cells", async () => {
    const currentFixture = await renderFixture();

    await act(async () => {
      currentFixture.editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Tab",
        }),
      );
      await flushLayout();
    });

    expect(currentFixture.editor.state.selection.$from.parent.textContent).toBe(
      "B1",
    );
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("does not swallow the postponed row-action shortcut while grips are absent", async () => {
    const currentFixture = await renderFixture();
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "†",
      code: "KeyT",
      altKey: true,
      shiftKey: true,
    });

    await act(async () => {
      currentFixture.editor.view.dom.dispatchEvent(shortcut);
      await flushLayout();
    });

    expect(shortcut.defaultPrevented).toBe(false);
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
  });

  it("preserves existing row-height resizing without exposing reorder grabs", async () => {
    const currentFixture = await renderFixture();
    const initialDocument = currentFixture.editor.state.doc;
    const historyBefore = undoDepth(currentFixture.editor.state);

    await movePointer(currentFixture, 200, 160);
    const resizeHandle = document.querySelector<HTMLButtonElement>(
      '.notion-table-row-resize[aria-label="Resize row 1"]',
    );
    if (!resizeHandle) throw new Error("Missing existing row resize handle");

    await dragRowResizeHandle(
      resizeHandle,
      { left: 200, top: 160 },
      { left: 200, top: 180 },
      51,
    );

    expect(currentFixture.editor.state.doc.firstChild?.child(0).attrs.rowHeight)
      .toBe(80);
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore + 1);
    expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
    expect(currentFixture.editor.commands.undo()).toBe(true);
    expect(currentFixture.editor.state.doc.eq(initialDocument)).toBe(true);
  });

  it("keeps rapid row resizing continuous, pointer-aligned, and selection-free", async () => {
    const currentFixture = await renderFixture();
    const initialDocument = currentFixture.editor.state.doc;
    const historyBefore = undoDepth(currentFixture.editor.state);

    await movePointer(currentFixture, 200, 160);
    const resizeHandle = document.querySelector<HTMLButtonElement>(
      '.notion-table-row-resize[aria-label="Resize row 1"]',
    );
    if (!resizeHandle) throw new Error("Missing rapid row resize handle");
    expect(resizeHandle.style.top).toBe("152px");

    await act(async () => {
      resizeHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 200,
          clientY: 160,
          isPrimary: true,
          pointerId: 52,
        }),
      );
      for (const clientY of [170, 200, 180]) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 200,
            clientY,
            isPrimary: true,
            pointerId: 52,
          }),
        );
      }
      await flushLayout();
    });

    expect(currentFixture.editor.state.doc.firstChild?.child(0).attrs.rowHeight)
      .toBeNull();
    expect(currentFixture.editor.state.doc.firstChild?.child(1).attrs.rowHeight)
      .toBeNull();
    const previewStyle = document.querySelector<HTMLStyleElement>(
      "[data-scratch-table-row-resize-preview]",
    );
    const previewRule = previewStyle?.sheet?.cssRules[0];
    expect(previewRule).toBeInstanceOf(CSSStyleRule);
    expect((previewRule as CSSStyleRule).style.height).toBe("80px");
    expect((previewRule as CSSStyleRule).selectorText).toContain(
      "data-scratch-row-resize-preview-id",
    );
    expect(currentFixture.rows[0].style.height).toBe("");
    expect(currentFixture.rows[1].style.height).toBe("");
    expect(resizeHandle.style.top).toBe("172px");
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore);
    const selectStart = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    const dragStart = new Event("dragstart", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(selectStart);
    window.dispatchEvent(dragStart);
    expect(selectStart.defaultPrevented).toBe(true);
    expect(dragStart.defaultPrevented).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 200,
          clientY: 180,
          isPrimary: true,
          pointerId: 52,
        }),
      );
      await flushLayout();
    });

    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore + 1);
    expect(currentFixture.editor.state.doc.firstChild?.child(0).attrs.rowHeight)
      .toBe(80);
    expect(currentFixture.editor.commands.undo()).toBe(true);
    expect(currentFixture.editor.state.doc.eq(initialDocument)).toBe(true);
  });

  it("keeps rapid row resizing pointer-aligned at 120% interface zoom", async () => {
    document.documentElement.style.zoom = "1.2";
    const currentFixture = createTableFixture();
    fixture = currentFixture;
    const table = currentFixture.editor.view.dom.querySelector("table");
    if (!table) throw new Error("Missing zoomed row resize table");
    table.getBoundingClientRect = () => createRect(120, 120, 600, 264);
    currentFixture.rows[0].getBoundingClientRect = () =>
      createRect(120, 120, 600, 192);
    currentFixture.rows[1].getBoundingClientRect = () =>
      createRect(120, 192, 600, 264);
    currentFixture.cells[0][0].getBoundingClientRect = () =>
      createRect(120, 120, 360, 192);
    currentFixture.cells[0][1].getBoundingClientRect = () =>
      createRect(360, 120, 600, 192);
    currentFixture.cells[1][0].getBoundingClientRect = () =>
      createRect(120, 192, 360, 264);
    currentFixture.cells[1][1].getBoundingClientRect = () =>
      createRect(360, 192, 600, 264);
    const initialDocument = currentFixture.editor.state.doc;
    const historyBefore = undoDepth(currentFixture.editor.state);

    await act(async () => {
      currentFixture.root.render(
        <TableControls editor={currentFixture.editor} />,
      );
      await flushLayout();
    });
    await movePointer(currentFixture, 240, 192);
    const resizeHandle = document.querySelector<HTMLButtonElement>(
      '.notion-table-row-resize[aria-label="Resize row 1"]',
    );
    if (!resizeHandle) throw new Error("Missing zoomed row resize handle");
    expect(resizeHandle.style.top).toBe("152px");

    await act(async () => {
      resizeHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 240,
          clientY: 192,
          isPrimary: true,
          pointerId: 53,
        }),
      );
      for (const clientY of [204, 240, 216]) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            clientX: 240,
            clientY,
            isPrimary: true,
            pointerId: 53,
          }),
        );
      }
      await flushLayout();
    });

    const previewStyle = document.querySelector<HTMLStyleElement>(
      "[data-scratch-table-row-resize-preview]",
    );
    const previewRule = previewStyle?.sheet?.cssRules[0];
    expect((previewRule as CSSStyleRule).style.height).toBe("80px");
    expect(resizeHandle.style.top).toBe("172px");
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore);

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 240,
          clientY: 216,
          isPrimary: true,
          pointerId: 53,
        }),
      );
      await flushLayout();
    });

    expect(currentFixture.editor.state.doc.firstChild?.child(0).attrs.rowHeight)
      .toBe(80);
    expect(undoDepth(currentFixture.editor.state)).toBe(historyBefore + 1);
    expect(currentFixture.editor.commands.undo()).toBe(true);
    expect(currentFixture.editor.state.doc.eq(initialDocument)).toBe(true);
  });

  it("keeps removed controls absent at 120% interface zoom", async () => {
    document.documentElement.style.zoom = "1.2";
    const currentFixture = await renderFixture();
    const table = currentFixture.editor.view.dom.querySelector("table");
    if (!table) throw new Error("Missing zoomed table");
    table.getBoundingClientRect = () => createRect(120, 120, 600, 264);
    currentFixture.rows[0].getBoundingClientRect = () =>
      createRect(120, 120, 600, 192);
    currentFixture.rows[1].getBoundingClientRect = () =>
      createRect(120, 192, 600, 264);
    currentFixture.cells[0][0].getBoundingClientRect = () =>
      createRect(120, 120, 360, 192);
    currentFixture.cells[0][1].getBoundingClientRect = () =>
      createRect(360, 120, 600, 192);
    currentFixture.cells[1][0].getBoundingClientRect = () =>
      createRect(120, 192, 360, 264);
    currentFixture.cells[1][1].getBoundingClientRect = () =>
      createRect(360, 192, 600, 264);

    for (const point of [
      { left: 115.2, top: 228 },
      { left: 480, top: 115.2 },
      { left: 360, top: 283.2 },
      { left: 619.2, top: 192 },
    ]) {
      await movePointer(currentFixture, point.left, point.top);
      expect(document.querySelector(REMOVED_TABLE_CONTROL_SELECTOR)).toBeNull();
    }
  });

  it("keeps absent controls outside the keyboard focus order", async () => {
    await renderFixture();

    expect(document.querySelectorAll(REMOVED_TABLE_CONTROL_SELECTOR)).toHaveLength(
      0,
    );
  });
});
