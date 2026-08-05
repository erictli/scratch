import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { undoDepth } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";
import {
  getTableBlockHandleReferenceRect,
  getTopLevelBlockDragTargetFromDom,
  hasExceededBlockPointerDragThreshold,
  isTableBlockHandleProximity,
  moveBlockAtPoint,
  moveBlockByKeyboard,
  moveTopLevelBlockAtPoint,
  type BlockDragTarget,
} from "./blockDrag";
import { resolveTableProximityTarget } from "./tableProximity";

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

describe("Notion block drag fallback", () => {
  it("reserves a dedicated table block-handle zone near the top-left corner", () => {
    const tableRect = createRect(100, 100, 500, 300);

    expect(
      isTableBlockHandleProximity(tableRect, { left: 50, top: 100 }),
    ).toBe(true);
    expect(
      isTableBlockHandleProximity(tableRect, { left: 300, top: 200 }),
    ).toBe(false);
    expect(
      isTableBlockHandleProximity(tableRect, { left: 100, top: 250 }),
    ).toBe(false);

    const firstRowPoint = { left: 75, top: 110 };
    expect(
      resolveTableProximityTarget(
        {
          tableRect,
          rowRects: [createRect(100, 100, 500, 140)],
          columnRects: [createRect(100, 100, 500, 300)],
        },
        firstRowPoint,
      ),
    ).toEqual({ kind: "row", index: 0 });
    expect(isTableBlockHandleProximity(tableRect, firstRowPoint)).toBe(false);
  });

  it("anchors the table block handle near the top instead of its full-height center", () => {
    const tableRect = createRect(100, 100, 500, 300);

    const referenceRect = getTableBlockHandleReferenceRect(tableRect);

    expect(referenceRect.top).toBe(tableRect.top);
    expect(referenceRect.bottom).toBeLessThan(150);
    expect(referenceRect.height).toBeLessThan(tableRect.height / 2);
  });

  it("starts a direct block drag from a top-level image", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content:
        '<p>Before</p><img src="asset://localhost/assets/photo.png"><p>After</p>',
    });

    try {
      const image = editor.view.dom.querySelector("img");
      if (!image) throw new Error("Missing image element");

      const target = getTopLevelBlockDragTargetFromDom(editor, image);
      expect(target?.node.type.name).toBe("image");
      expect(target?.node.attrs.src).toBe(
        "asset://localhost/assets/photo.png",
      );
      expect(target?.pos).toBe(editor.state.doc.child(0).nodeSize);
      expect(
        hasExceededBlockPointerDragThreshold(
          { left: 100, top: 100 },
          { left: 104, top: 103 },
        ),
      ).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("moves an image block after the last paragraph without losing its source", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content:
        '<p>Before</p><img src="asset://localhost/assets/photo.png"><p>After</p>',
    });
    const firstParagraph = editor.state.doc.child(0);
    const imagePosition = firstParagraph.nodeSize;
    const imageNode = editor.state.doc.nodeAt(imagePosition);
    const lastParagraphPosition =
      imagePosition + editor.state.doc.child(1).nodeSize;

    if (!imageNode) throw new Error("Missing image block");
    const target: BlockDragTarget = { node: imageNode, pos: imagePosition };
    const lastParagraphElement = document.createElement("p");
    lastParagraphElement.getBoundingClientRect = () =>
      createRect(100, 200, 700, 240);

    editor.view.dom.getBoundingClientRect = () =>
      createRect(0, 0, 800, 500);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: lastParagraphPosition + 1,
      inside: lastParagraphPosition,
    });
    vi.spyOn(editor.view, "nodeDOM").mockImplementation((position) =>
      position === lastParagraphPosition ? lastParagraphElement : null,
    );

    try {
      expect(
        moveTopLevelBlockAtPoint(editor, target, { left: 400, top: 235 }),
      ).toBe(true);
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "paragraph",
        "paragraph",
        "image",
        "paragraph",
      ]);
      expect(editor.getJSON().content?.[2]).toMatchObject({
        type: "image",
        attrs: { src: "asset://localhost/assets/photo.png" },
      });
    } finally {
      editor.destroy();
    }
  });

  it("moves a paragraph by pointer without crossing the protected title", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<h1>Protected title</h1><p>Alpha</p><p>Beta</p>",
    });
    const title = editor.state.doc.child(0);
    const alphaPosition = title.nodeSize;
    const alpha = editor.state.doc.nodeAt(alphaPosition);
    const betaPosition = alphaPosition + editor.state.doc.child(1).nodeSize;
    const titleElement = document.createElement("h1");
    const alphaElement = document.createElement("p");
    const betaElement = document.createElement("p");
    titleElement.getBoundingClientRect = () => createRect(100, 20, 700, 60);
    alphaElement.getBoundingClientRect = () => createRect(100, 80, 700, 120);
    betaElement.getBoundingClientRect = () => createRect(100, 140, 700, 180);
    editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 300);
    vi.spyOn(editor.view, "nodeDOM").mockImplementation((position) => {
      if (position === 0) return titleElement;
      if (position === alphaPosition) return alphaElement;
      if (position === betaPosition) return betaElement;
      return null;
    });
    if (!alpha) throw new Error("Missing paragraph pointer target");

    try {
      expect(
        moveTopLevelBlockAtPoint(
          editor,
          { node: alpha, pos: alphaPosition },
          { left: 400, top: 180 },
        ),
      ).toBe(true);
      expect(
        Array.from(
          { length: editor.state.doc.childCount },
          (_, index) => editor.state.doc.child(index).textContent,
        ),
      ).toEqual(["Protected title", "Beta", "Alpha"]);
    } finally {
      editor.destroy();
    }
  });

  it("moves a table by pointer as one atomic top-level block", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content:
        "<p>Before</p>" +
        "<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>" +
        "<p>After</p>",
    });
    const before = editor.state.doc.child(0);
    const tablePosition = before.nodeSize;
    const table = editor.state.doc.nodeAt(tablePosition);
    const tableJson = table?.toJSON();
    const afterPosition = tablePosition + (table?.nodeSize ?? 0);
    const beforeElement = document.createElement("p");
    const tableElement = document.createElement("table");
    const afterElement = document.createElement("p");
    beforeElement.getBoundingClientRect = () => createRect(100, 20, 700, 60);
    tableElement.getBoundingClientRect = () => createRect(100, 80, 700, 180);
    afterElement.getBoundingClientRect = () => createRect(100, 200, 700, 240);
    editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 320);
    vi.spyOn(editor.view, "nodeDOM").mockImplementation((position) => {
      if (position === 0) return beforeElement;
      if (position === tablePosition) return tableElement;
      if (position === afterPosition) return afterElement;
      return null;
    });
    if (!table || !tableJson) throw new Error("Missing table pointer target");

    try {
      expect(
        moveTopLevelBlockAtPoint(
          editor,
          { node: table, pos: tablePosition },
          { left: 400, top: 240 },
        ),
      ).toBe(true);
      expect(editor.state.doc.child(0).textContent).toBe("Before");
      expect(editor.state.doc.child(1).textContent).toBe("After");
      expect(editor.state.doc.child(2).toJSON()).toEqual(tableJson);
    } finally {
      editor.destroy();
    }
  });

  it("moves one bulleted item after an atomic table without targeting a cell", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content:
        "<ul><li><p>Move me</p></li><li><p>Keep me</p></li></ul>" +
        "<table><tbody><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>" +
        "<p>After</p>",
    });
    const initialDocument = editor.getJSON();
    const sourceList = editor.state.doc.child(0);
    const tablePosition = sourceList.nodeSize;
    const tableNode = editor.state.doc.nodeAt(tablePosition);
    const paragraphPosition = tablePosition + (tableNode?.nodeSize ?? 0);
    let itemPosition = -1;
    let itemNode: BlockDragTarget["node"] | null = null;

    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "listItem" && node.textContent === "Move me") {
        itemPosition = position;
        itemNode = node;
        return false;
      }
      return true;
    });
    if (!itemNode || itemPosition < 0 || !tableNode) {
      throw new Error("Missing list/table drag fixture");
    }

    const listElement = editor.view.nodeDOM(0);
    const tableElement = editor.view.nodeDOM(tablePosition);
    const paragraphElement = editor.view.nodeDOM(paragraphPosition);
    if (
      !(listElement instanceof HTMLElement) ||
      !(tableElement instanceof HTMLElement) ||
      !(paragraphElement instanceof HTMLElement)
    ) {
      throw new Error("Missing top-level drag fixture DOM");
    }
    editor.view.dom.getBoundingClientRect = () =>
      createRect(100, 0, 700, 400);
    listElement.getBoundingClientRect = () => createRect(100, 20, 700, 100);
    tableElement.getBoundingClientRect = () => createRect(100, 120, 700, 260);
    paragraphElement.getBoundingClientRect = () =>
      createRect(100, 280, 700, 320);

    const historyBefore = undoDepth(editor.state);
    const tableBefore = tableNode.toJSON();
    const target = { node: itemNode, pos: itemPosition };

    try {
      expect(moveBlockAtPoint(editor, target, { left: 400, top: 252 })).toBe(
        true,
      );
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "bulletList",
        "table",
        "bulletList",
        "paragraph",
      ]);
      expect(editor.state.doc.child(0).textContent).toBe("Keep me");
      expect(editor.state.doc.child(1).toJSON()).toEqual(tableBefore);
      expect(editor.state.doc.child(2).textContent).toBe("Move me");
      expect(editor.state.doc.child(1).descendants((node) => {
        expect(node.type.name).not.toBe("bulletList");
        return true;
      })).toBeUndefined();
      expect(undoDepth(editor.state)).toBe(historyBefore + 1);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(initialDocument);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "bulletList",
        "table",
        "bulletList",
        "paragraph",
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("moves a bulleted item before a table while preserving the table as one block", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content:
        "<table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>" +
        "<ul><li><p>Move before</p></li><li><p>Stay after</p></li></ul>" +
        "<p>Tail</p>",
    });
    const tableNode = editor.state.doc.child(0);
    const sourceListPosition = tableNode.nodeSize;
    const sourceList = editor.state.doc.child(1);
    const paragraphPosition = sourceListPosition + sourceList.nodeSize;
    let itemPosition = -1;
    let itemNode: BlockDragTarget["node"] | null = null;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "listItem" && node.textContent === "Move before") {
        itemPosition = position;
        itemNode = node;
        return false;
      }
      return true;
    });
    if (!itemNode || itemPosition < 0) {
      throw new Error("Missing before-table list fixture");
    }

    const tableElement = editor.view.nodeDOM(0);
    const listElement = editor.view.nodeDOM(sourceListPosition);
    const paragraphElement = editor.view.nodeDOM(paragraphPosition);
    if (
      !(tableElement instanceof HTMLElement) ||
      !(listElement instanceof HTMLElement) ||
      !(paragraphElement instanceof HTMLElement)
    ) {
      throw new Error("Missing before-table fixture DOM");
    }
    editor.view.dom.getBoundingClientRect = () =>
      createRect(100, 0, 700, 440);
    tableElement.getBoundingClientRect = () => createRect(100, 100, 700, 240);
    listElement.getBoundingClientRect = () => createRect(100, 260, 700, 340);
    paragraphElement.getBoundingClientRect = () =>
      createRect(100, 360, 700, 400);

    try {
      expect(
        moveBlockAtPoint(
          editor,
          { node: itemNode, pos: itemPosition },
          { left: 400, top: 104 },
        ),
      ).toBe(true);
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "bulletList",
        "table",
        "bulletList",
        "paragraph",
      ]);
      expect(editor.state.doc.child(0).textContent).toBe("Move before");
      expect(editor.state.doc.child(1).toJSON()).toEqual(tableNode.toJSON());
      expect(editor.state.doc.child(2).textContent).toBe("Stay after");
    } finally {
      editor.destroy();
    }
  });

  it("moves a one-item bullet list past a table without losing its wrapper", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content:
        "<p>Before</p>" +
        "<ul><li><p>Solo bullet</p></li></ul>" +
        "<table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>",
    });
    const paragraphNode = editor.state.doc.child(0);
    const listPosition = paragraphNode.nodeSize;
    const sourceList = editor.state.doc.child(1);
    const tablePosition = listPosition + sourceList.nodeSize;
    const tableNode = editor.state.doc.child(2);
    const listElement = editor.view.nodeDOM(listPosition);
    const tableElement = editor.view.nodeDOM(tablePosition);
    let itemPosition = -1;
    let itemNode: BlockDragTarget["node"] | null = null;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "listItem") {
        itemPosition = position;
        itemNode = node;
        return false;
      }
      return true;
    });
    if (
      !itemNode ||
      itemPosition < 0 ||
      !(listElement instanceof HTMLElement) ||
      !(tableElement instanceof HTMLElement)
    ) {
      throw new Error("Missing one-item list fixture");
    }
    editor.view.dom.getBoundingClientRect = () =>
      createRect(100, 0, 700, 400);
    listElement.getBoundingClientRect = () => createRect(100, 80, 700, 120);
    tableElement.getBoundingClientRect = () => createRect(100, 140, 700, 280);

    try {
      expect(
        moveBlockAtPoint(
          editor,
          { node: itemNode, pos: itemPosition },
          { left: 400, top: 276 },
        ),
      ).toBe(true);
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "paragraph",
        "table",
        "bulletList",
        "paragraph",
      ]);
      expect(editor.state.doc.child(1).toJSON()).toEqual(tableNode.toJSON());
      expect(editor.state.doc.child(2).textContent).toBe("Solo bullet");
    } finally {
      editor.destroy();
    }
  });

  it("moves a top-level block by keyboard in one undoable transaction", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>One</p><p>Two</p><p>Three</p>",
    });
    const targetPosition = editor.state.doc.child(0).nodeSize;
    const targetNode = editor.state.doc.nodeAt(targetPosition);
    if (!targetNode) throw new Error("Missing keyboard block target");
    const target = { node: targetNode, pos: targetPosition };
    const historyBefore = undoDepth(editor.state);
    const topLevelTexts = () =>
      Array.from(
        { length: editor.state.doc.childCount },
        (_, index) => editor.state.doc.child(index).textContent,
      );

    try {
      const movedTarget = moveBlockByKeyboard(editor, target, -1);
      expect(movedTarget).not.toBeNull();
      expect(topLevelTexts()).toEqual(["Two", "One", "Three"]);
      expect(undoDepth(editor.state)).toBe(historyBefore + 1);
      expect(editor.commands.undo()).toBe(true);
      expect(topLevelTexts()).toEqual(["One", "Two", "Three"]);

      const movedTarget2 = moveBlockByKeyboard(editor, target, 1);
      expect(movedTarget2).not.toBeNull();
      expect(topLevelTexts()).toEqual(["One", "Three", "Two"]);
    } finally {
      editor.destroy();
    }
  });

  it("never moves the protected leading H1", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<h1>Protected title</h1><p>Body</p>",
    });
    const initialDocument = editor.getJSON();
    const title = editor.state.doc.child(0);

    try {
      expect(moveBlockByKeyboard(editor, { node: title, pos: 0 }, 1)).toBeNull();
      expect(editor.getJSON()).toEqual(initialDocument);
    } finally {
      editor.destroy();
    }
  });

  it("keeps keyboard-moved body blocks after the protected leading H1", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<h1>Protected title</h1><p>Body</p>",
    });
    const initialDocument = editor.getJSON();
    const title = editor.state.doc.child(0);
    const body = editor.state.doc.nodeAt(title.nodeSize);
    if (!body) throw new Error("Missing body block");

    try {
      expect(
        moveBlockByKeyboard(editor, { node: body, pos: title.nodeSize }, -1),
      ).toBeNull();
      expect(editor.getJSON()).toEqual(initialDocument);
    } finally {
      editor.destroy();
    }
  });

  it("rejects pointer drops before the protected leading H1", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<h1>Protected title</h1><p>Body</p>",
    });
    const initialDocument = editor.getJSON();
    const title = editor.state.doc.child(0);
    const bodyPosition = title.nodeSize;
    const body = editor.state.doc.nodeAt(bodyPosition);
    const titleElement = editor.view.nodeDOM(0);
    const bodyElement = editor.view.nodeDOM(bodyPosition);
    if (
      !body ||
      !(titleElement instanceof HTMLElement) ||
      !(bodyElement instanceof HTMLElement)
    ) {
      throw new Error("Missing protected-title pointer fixture");
    }
    editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 300);
    titleElement.getBoundingClientRect = () => createRect(0, 20, 800, 60);
    bodyElement.getBoundingClientRect = () => createRect(0, 80, 800, 120);

    try {
      expect(
        moveTopLevelBlockAtPoint(
          editor,
          { node: body, pos: bodyPosition },
          { left: 100, top: 20 },
        ),
      ).toBe(false);
      expect(editor.getJSON()).toEqual(initialDocument);
    } finally {
      editor.destroy();
    }
  });

  it("keeps the title, table, and image intact while moving a paragraph", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        Image.configure({ inline: false }),
        TableKit,
      ],
      content:
        '<h1>Protected title</h1><p>Alpha</p><p>Beta</p><table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table><img src="asset://localhost/assets/preserved.png">',
    });
    const titleNode = editor.state.doc.child(0);
    const alphaPosition = titleNode.nodeSize;
    const betaPosition =
      alphaPosition + editor.state.doc.child(1).nodeSize;
    const betaNode = editor.state.doc.nodeAt(betaPosition);
    if (!betaNode) throw new Error("Missing mixed-document block target");
    const tableBefore = editor.state.doc.child(3).toJSON();
    const imageBefore = editor.state.doc.child(4).toJSON();
    const historyBefore = undoDepth(editor.state);

    try {
      const movedTarget = moveBlockByKeyboard(
        editor,
        { node: betaNode, pos: betaPosition },
        -1,
      );
      expect(movedTarget).not.toBeNull();
      expect(editor.state.doc.child(0).toJSON()).toEqual(titleNode.toJSON());
      expect(editor.state.doc.child(1).textContent).toBe("Beta");
      expect(editor.state.doc.child(2).textContent).toBe("Alpha");
      expect(editor.state.doc.child(3).toJSON()).toEqual(tableBefore);
      expect(editor.state.doc.child(4).toJSON()).toEqual(imageBefore);
      expect(undoDepth(editor.state)).toBe(historyBefore + 1);

      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.child(0).toJSON()).toEqual(titleNode.toJSON());
      expect(editor.state.doc.child(1).textContent).toBe("Alpha");
      expect(editor.state.doc.child(2).textContent).toBe("Beta");
      expect(editor.state.doc.child(3).toJSON()).toEqual(tableBefore);
      expect(editor.state.doc.child(4).toJSON()).toEqual(imageBefore);
    } finally {
      editor.destroy();
    }
  });

  it("reorders sibling list items without nesting or adding an empty item", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content:
        "<ul><li><p>Item One</p></li><li><p>Item Two</p></li></ul>",
    });
    const firstItemPosition = 1;
    const firstItem = editor.state.doc.nodeAt(firstItemPosition);
    if (!firstItem) throw new Error("Missing list-item keyboard target");
    const historyBefore = undoDepth(editor.state);

    try {
      const movedTarget = moveBlockByKeyboard(
        editor,
        { node: firstItem, pos: firstItemPosition },
        1,
      );
      expect(movedTarget).not.toBeNull();

      const movedList = editor.state.doc.child(0);
      expect(movedList.type.name).toBe("bulletList");
      expect(movedList.childCount).toBe(2);
      expect(movedList.child(0).textContent).toBe("Item Two");
      expect(movedList.child(1).textContent).toBe("Item One");
      expect(movedList.child(0).childCount).toBe(1);
      expect(movedList.child(1).childCount).toBe(1);
      expect(undoDepth(editor.state)).toBe(historyBefore + 1);

      expect(editor.commands.undo()).toBe(true);
      const restoredList = editor.state.doc.child(0);
      expect(restoredList.childCount).toBe(2);
      expect(restoredList.child(0).textContent).toBe("Item One");
      expect(restoredList.child(1).textContent).toBe("Item Two");
    } finally {
      editor.destroy();
    }
  });
});
