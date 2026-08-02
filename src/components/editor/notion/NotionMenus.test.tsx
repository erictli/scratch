import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlockDragControls,
  getBlockDragHandleReferenceRect,
  SelectionMenu,
  shouldShowSelectionMenu,
} from "./NotionMenus";
import {
  ScratchColor,
  ScratchHighlight,
  ScratchTextStyle,
} from "./markdownMarks";
import { SCRATCH_TRAILING_NODE_OPTIONS } from "./editorBehavior";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
  true;

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

async function flushAnimationFrames(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("block drag handle layout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("zoom");
    document.body.replaceChildren();
  });

  it("keeps hidden block controls out of tab order and exposes a button grip on hover", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Keyboard movable block</p>",
    });
    const controls = document.createElement("div");
    document.body.append(editor.view.dom, controls);
    const root = createRoot(controls);
    const block = editor.view.dom.querySelector("p");
    if (!block) throw new Error("Missing keyboard block fixture");
    block.getBoundingClientRect = () => createRect(100, 80, 600, 112);
    editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 400);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });
      const hiddenAdd = document.querySelector<HTMLButtonElement>(
        '.notion-block-add[aria-label="Add block"]',
      );
      const hiddenGrip = document.querySelector<HTMLElement>(
        '.notion-block-grip[aria-label="Move block with Arrow Up or Arrow Down"]',
      );
      expect(hiddenAdd?.tabIndex).toBe(-1);
      expect(hiddenGrip?.tagName).toBe("BUTTON");
      expect(hiddenGrip?.tabIndex).toBe(-1);

      await act(async () => {
        block.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 120,
            clientY: 96,
          }),
        );
        await flushAnimationFrames();
      });

      expect(hiddenAdd?.tabIndex).toBe(0);
      expect(hiddenGrip?.tabIndex).toBe(0);
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
    }
  });

  it("uses centered vector icons for both block controls", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Aligned block controls</p>",
    });
    const controls = document.createElement("div");
    document.body.append(editor.view.dom, controls);
    const root = createRoot(controls);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });

      const add = document.querySelector<HTMLButtonElement>(
        '.notion-block-add[aria-label="Add block"]',
      );
      const grip = document.querySelector<HTMLButtonElement>(
        '.notion-block-grip[aria-label="Move block with Arrow Up or Arrow Down"]',
      );

      expect(add?.querySelector("svg.notion-block-control-icon")).not.toBeNull();
      expect(
        grip?.querySelector("svg.notion-block-control-icon"),
      ).not.toBeNull();
      expect(add?.textContent?.trim()).toBe("");
      expect(grip?.textContent?.trim()).toBe("");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
    }
  });

  it("anchors the shared block grip to the top-left of an image", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: '<img src="asset://localhost/assets/photo.png">',
    });
    const image = editor.view.dom.querySelector("img");
    const imageNode = editor.state.doc.child(0);
    if (!image) throw new Error("Missing image drag-handle fixture");
    image.getBoundingClientRect = () => createRect(120, 80, 620, 380);

    try {
      const referenceRect = getBlockDragHandleReferenceRect(editor, {
        node: imageNode,
        pos: 0,
      });

      expect(referenceRect?.left).toBe(120);
      expect(referenceRect?.top).toBe(80);
      expect(referenceRect?.bottom).toBeLessThanOrEqual(108);
      expect(referenceRect?.height).toBeLessThan(image.getBoundingClientRect().height);
    } finally {
      editor.destroy();
    }
  });

  it("shows the same block grip when an image is hovered", async () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: '<img src="asset://localhost/assets/photo.png">',
    });
    const controls = document.createElement("div");
    document.body.append(editor.view.dom, controls);
    const root = createRoot(controls);
    const image = editor.view.dom.querySelector("img");
    if (!image) throw new Error("Missing hovered image fixture");
    editor.view.dom.getBoundingClientRect = () => createRect(0, 0, 800, 500);
    image.getBoundingClientRect = () => createRect(120, 80, 620, 380);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });
      await act(async () => {
        image.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 140,
            clientY: 94,
          }),
        );
        await flushAnimationFrames();
      });

      const handle = document.querySelector<HTMLElement>(
        ".notion-block-drag-handle.is-block-hovered",
      );
      expect(handle).not.toBeNull();
      expect(
        handle?.querySelector(".notion-block-grip svg.notion-block-control-icon"),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
    }
  });

  it.each([0.7, 1.2, 1.25, 1.5])(
    "normalizes block coordinates around the positioned shell at CSS zoom %s",
    async (zoom) => {
      document.documentElement.style.zoom = String(zoom);

      const editor = new Editor({
        extensions: [StarterKit],
        content: "<p>Zoomed text block</p>",
      });
      const host = document.createElement("div");
      host.className = "notion-editor-shell";
      const controls = document.createElement("div");
      host.append(editor.view.dom, controls);
      document.body.append(host);
      const root = createRoot(controls);
      const block = editor.view.dom.querySelector("p");
      if (!block) throw new Error("Missing zoomed paragraph block");

      Object.defineProperties(editor.view.dom, {
        offsetWidth: { configurable: true, value: 900 },
        offsetHeight: { configurable: true, value: 400 },
      });
      const shellLeft = 80 * zoom;
      host.getBoundingClientRect = () =>
        createRect(shellLeft, 0, shellLeft + 900 * zoom, 400 * zoom);
      editor.view.dom.getBoundingClientRect = () =>
        createRect(0, 0, 900 * zoom, 400 * zoom);
      block.getBoundingClientRect = () =>
        createRect(200 * zoom, 80 * zoom, 600 * zoom, 112 * zoom);

      try {
        await act(async () => {
          root.render(<BlockDragControls editor={editor} />);
        });

        await act(async () => {
          block.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: 220 * zoom,
              clientY: 96 * zoom,
            }),
          );
          await flushAnimationFrames();
        });

        const handle = document.querySelector<HTMLElement>(
          ".notion-block-drag-handle",
        );
        expect(handle).not.toBeNull();
        expect(handle?.style.visibility).not.toBe("hidden");
        const expectedLeft = shellLeft + (200 * zoom - shellLeft) / zoom;
        expect(Number.parseFloat(handle?.style.left ?? "NaN")).toBeCloseTo(
          expectedLeft,
          3,
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        editor.destroy();
      }
    },
  );

  it("shows the drag handle as soon as its block is hovered at 120 percent zoom", async () => {
    document.documentElement.style.zoom = "1.2";

    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Reachable drag handle</p>",
    });
    const host = document.createElement("div");
    host.className = "notion-editor-shell";
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    const block = editor.view.dom.querySelector("p");
    if (!block) throw new Error("Missing drag-handle paragraph block");

    editor.view.dom.getBoundingClientRect = () =>
      createRect(100, 0, 800, 300);
    host.getBoundingClientRect = () => createRect(100, 0, 800, 300);
    block.getBoundingClientRect = () => createRect(180, 80, 700, 112);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });

      await act(async () => {
        block.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 220,
            clientY: 96,
          }),
        );
        await flushAnimationFrames();
      });

      const handle = document.querySelector<HTMLElement>(
        ".notion-block-drag-handle",
      );
      expect(handle).not.toBeNull();
      expect(handle?.style.visibility).not.toBe("hidden");
      expect(handle?.classList.contains("is-block-hovered")).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("remeasures the same block after its editor layout changes", async () => {
    let resizeObserverCallback: ResizeObserverCallback | null = null;

    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Resizable text block</p>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    const block = editor.view.dom.querySelector("p");
    if (!block) throw new Error("Missing paragraph block");

    let blockLeft = 400;
    editor.view.dom.getBoundingClientRect = () =>
      createRect(0, 0, 900, 500);
    block.getBoundingClientRect = () =>
      createRect(blockLeft, 80, blockLeft + 420, 112);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });

      await act(async () => {
        block.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: blockLeft + 12,
            clientY: 92,
          }),
        );
        await flushAnimationFrames();
      });

      const handle = document.querySelector<HTMLElement>(
        ".notion-block-drag-handle",
      );
      expect(handle).not.toBeNull();
      expect(handle?.style.visibility).not.toBe("hidden");
      const initialLeft = handle?.style.left;

      blockLeft = 40;
      expect(resizeObserverCallback).not.toBeNull();
      await act(async () => {
        resizeObserverCallback?.([], {} as ResizeObserver);
        await flushAnimationFrames();
      });

      expect(handle?.style.visibility).toBe("hidden");

      await act(async () => {
        block.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: blockLeft + 12,
            clientY: 92,
          }),
        );
        await flushAnimationFrames();
      });

      expect(handle?.style.visibility).not.toBe("hidden");
      expect(handle?.style.left).not.toBe(initialLeft);
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it.each([
    ["bullet list", "<ul><li><p>List item</p></li></ul>"],
    ["numbered list", "<ol><li><p>List item</p></li></ol>"],
  ])(
    "positions a %s handle before its marker while keeping the item row",
    (_label, content) => {
      const editor = new Editor({ extensions: [StarterKit], content });
      const list = editor.view.dom.querySelector("ul, ol");
      const listItem = editor.view.dom.querySelector("li");
      const node = editor.state.doc.nodeAt(1);
      if (!list || !listItem || !node) {
        throw new Error("Missing list fixture nodes");
      }

      list.getBoundingClientRect = () => createRect(100, 180, 700, 280);
      listItem.getBoundingClientRect = () => createRect(122, 220, 700, 252);

      try {
        expect(
          getBlockDragHandleReferenceRect(editor, { node, pos: 1 }),
        ).toMatchObject({
          left: 100,
          top: 220,
          right: 700,
          bottom: 252,
          width: 600,
          height: 32,
        });
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    ["paragraph", "<p>Wrapped paragraph</p>", "p", 0, 32],
    ["heading 1", "<h1>Wrapped heading</h1>", "h1", 0, 44],
    ["heading 2", "<h2>Wrapped heading</h2>", "h2", 0, 36],
    ["heading 3", "<h3>Wrapped heading</h3>", "h3", 0, 32],
    ["heading 4", "<h4>Wrapped heading</h4>", "h4", 0, 28],
    [
      "bullet list",
      "<ul><li><p>Wrapped list item</p></li></ul>",
      "li",
      1,
      32,
    ],
    [
      "numbered list",
      "<ol><li><p>Wrapped list item</p></li></ol>",
      "li",
      1,
      32,
    ],
  ])(
    "anchors a multi-line %s handle to the first line, not the block center, without shifting it horizontally",
    (_label, content, selector, position, firstLineHeight) => {
      const editor = new Editor({ extensions: [StarterKit], content });
      const element = editor.view.dom.querySelector<HTMLElement>(selector);
      const node = editor.state.doc.nodeAt(position);
      if (!element || !node) {
        throw new Error("Missing multi-line block fixture nodes");
      }

      element.style.lineHeight = `${firstLineHeight}px`;
      element.getBoundingClientRect = () => createRect(100, 180, 700, 276);
      const list = element.closest("ul, ol");
      if (list) {
        list.getBoundingClientRect = () => createRect(100, 160, 700, 276);
      }

      try {
        const referenceRect = getBlockDragHandleReferenceRect(editor, {
          node,
          pos: position,
        });
        if (!referenceRect) {
          throw new Error("Missing multi-line handle reference rectangle");
        }

        expect(referenceRect).toMatchObject({
          left: 100,
          top: 180,
          right: 700,
          bottom: 180 + firstLineHeight,
          width: 600,
          height: firstLineHeight,
        });
        expect(referenceRect.top + referenceRect.height / 2).not.toBe(228);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    ["bullet list", "<p>Before</p><ul><li><p>List item</p></li></ul>"],
    ["numbered list", "<p>Before</p><ol><li><p>List item</p></li></ol>"],
  ])(
    "keeps a one-line %s draggable across its full row height",
    async (_label, content) => {
      const editor = new Editor({ extensions: [StarterKit], content });
      const topBlock = editor.view.dom.querySelector(":scope > p");
      const list = editor.view.dom.querySelector("ul, ol");
      const listItem = editor.view.dom.querySelector("li");
      const listParagraph = listItem?.querySelector("p");
      if (!topBlock || !list || !listItem || !listParagraph) {
        throw new Error("Missing list hover fixture nodes");
      }

      let listTextPosition = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === "List item") {
          listTextPosition = pos + 1;
        }
      });
      if (listTextPosition < 0) throw new Error("Missing list text position");

      editor.view.dom.getBoundingClientRect = () =>
        createRect(100, 80, 700, 300);
      topBlock.getBoundingClientRect = () => createRect(100, 100, 700, 132);
      list.getBoundingClientRect = () => createRect(100, 180, 700, 204);
      listItem.getBoundingClientRect = () => createRect(122, 180, 700, 204);
      listParagraph.getBoundingClientRect = () =>
        createRect(144, 180, 700, 204);
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
        pos: listTextPosition,
        inside: listTextPosition - 1,
      });

      const host = document.createElement("div");
      const controls = document.createElement("div");
      host.append(editor.view.dom, controls);
      document.body.append(host);
      const root = createRoot(controls);

      try {
        await act(async () => {
          root.render(<BlockDragControls editor={editor} />);
        });

        await act(async () => {
          listParagraph.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: 174,
              clientY: 185,
            }),
          );
          await flushAnimationFrames();
        });

        const handle = document.querySelector<HTMLElement>(
          ".notion-block-drag-handle",
        );
        expect(handle?.style.visibility).not.toBe("hidden");
      } finally {
        await act(async () => {
          root.unmount();
        });
        editor.destroy();
      }
    },
  );

  it("adds one empty item with the same bullet style and line rhythm", async () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          trailingNode: SCRATCH_TRAILING_NODE_OPTIONS,
        }),
      ],
      content: "<ul><li><p>List item</p></li></ul>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    const list = editor.view.dom.querySelector("ul");
    const listItem = list?.querySelector("li");
    const listParagraph = listItem?.querySelector("p");
    if (!list || !listItem || !listParagraph) {
      throw new Error("Missing bulleted-list add fixture nodes");
    }

    let listTextPosition = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "List item") {
        listTextPosition = pos + 1;
      }
    });
    if (listTextPosition < 0) throw new Error("Missing list text position");

    editor.view.dom.getBoundingClientRect = () =>
      createRect(100, 0, 700, 240);
    list.getBoundingClientRect = () => createRect(100, 80, 700, 120);
    listItem.getBoundingClientRect = () => createRect(122, 80, 700, 120);
    listParagraph.getBoundingClientRect = () =>
      createRect(144, 80, 700, 120);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: listTextPosition,
      inside: listTextPosition - 1,
    });

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });

      await act(async () => {
        listParagraph.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 174,
            clientY: 96,
          }),
        );
        await flushAnimationFrames();
      });

      const addButton = document.querySelector<HTMLButtonElement>(
        '.notion-block-add[aria-label="Add block"]',
      );
      expect(addButton).not.toBeNull();
      expect(
        editor.getJSON().content?.map((node) => node.type),
      ).toEqual(["bulletList"]);

      await act(async () => {
        addButton?.click();
      });

      const content = editor.getJSON().content ?? [];
      expect(content.map((node) => node.type)).toEqual(["bulletList"]);
      const bulletList = editor.state.doc.child(0);
      expect(bulletList.childCount).toBe(2);
      expect(bulletList.child(0).type.name).toBe("listItem");
      expect(bulletList.child(0).child(0).type.name).toBe("paragraph");
      expect(bulletList.child(0).textContent).toBe("");
      expect(bulletList.child(1).textContent).toBe("List item");
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      const listItems = editor.view.dom.querySelectorAll("ul > li");
      expect(listItems).toHaveLength(2);
      expect(
        listItems[0]?.querySelector("p > br.ProseMirror-trailingBreak"),
      ).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });
});

describe("macOS image block pointer drag", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    document.documentElement.style.removeProperty("zoom");
    document.body.replaceChildren();
  });

  it.each([0.7, 1.25, 1.5])(
    "keeps the pointer drop indicator aligned at CSS zoom %s",
    async (zoom) => {
      document.documentElement.style.zoom = String(zoom);
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      const editor = new Editor({
        extensions: [StarterKit, Image.configure({ inline: false })],
        content:
          '<p>Before</p><img src="asset://localhost/assets/photo.png"><p>After</p>',
      });
      const host = document.createElement("div");
      const controls = document.createElement("div");
      host.append(editor.view.dom, controls);
      document.body.append(host);
      const root = createRoot(controls);

      const [before, after] = editor.view.dom.querySelectorAll("p");
      const image = editor.view.dom.querySelector("img");
      if (!image) throw new Error("Missing zoomed image fixture");
      editor.view.dom.getBoundingClientRect = () =>
        createRect(100 * zoom, 0, 700 * zoom, 400 * zoom);
      before.getBoundingClientRect = () =>
        createRect(100 * zoom, 20 * zoom, 700 * zoom, 60 * zoom);
      image.getBoundingClientRect = () =>
        createRect(100 * zoom, 80 * zoom, 500 * zoom, 120 * zoom);
      after.getBoundingClientRect = () =>
        createRect(100 * zoom, 140 * zoom, 700 * zoom, 180 * zoom);

      try {
        await act(async () => {
          root.render(<BlockDragControls editor={editor} />);
        });

        await act(async () => {
          image.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX: 300 * zoom,
              clientY: 100 * zoom,
              isPrimary: true,
              pointerId: 1,
            }),
          );
          document.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              clientX: 300 * zoom,
              clientY: 170 * zoom,
              isPrimary: true,
              pointerId: 1,
            }),
          );
        });

        const indicator = document.querySelector<HTMLElement>(
          ".notion-block-drop-indicator",
        );
        expect(indicator).not.toBeNull();
        expect(indicator?.style.left).toBe("100px");
        expect(indicator?.style.top).toBe("180px");
        expect(indicator?.style.width).toBe("600px");
      } finally {
        await act(async () => {
          root.unmount();
        });
        editor.destroy();
      }
    },
  );

  it("moves an image directly without relying on an HTML drop event", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content:
        '<p>Before</p><img src="asset://localhost/assets/photo.png"><p>After</p>',
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);

    const [before, after] = editor.view.dom.querySelectorAll("p");
    const image = editor.view.dom.querySelector("img");
    if (!image) throw new Error("Missing image element");
    editor.view.dom.getBoundingClientRect = () => createRect(100, 0, 700, 400);
    before.getBoundingClientRect = () => createRect(100, 20, 700, 60);
    image.getBoundingClientRect = () => createRect(100, 80, 500, 120);
    after.getBoundingClientRect = () => createRect(100, 140, 700, 180);

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });

      await act(async () => {
        image.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 300,
            clientY: 100,
            isPrimary: true,
            pointerId: 1,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 300,
            clientY: 170,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });

      expect(document.querySelector(".notion-block-drop-indicator")).not.toBeNull();

      await act(async () => {
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 300,
            clientY: 170,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });

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
      expect(document.querySelector(".notion-block-drop-indicator")).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("moves a bullet past an atomic table at 120 percent zoom and honors Escape", async () => {
    const zoom = 1.2;
    document.documentElement.style.zoom = String(zoom);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content:
        "<ul><li><p>Move me</p></li><li><p>Keep me</p></li></ul>" +
        "<table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>" +
        "<p>After</p>",
    });
    const initialDocument = editor.getJSON();
    const sourceList = editor.state.doc.child(0);
    const tablePosition = sourceList.nodeSize;
    const tableNode = editor.state.doc.child(1);
    const paragraphPosition = tablePosition + tableNode.nodeSize;
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    const list = editor.view.nodeDOM(0);
    const table = editor.view.nodeDOM(tablePosition);
    const after = editor.view.nodeDOM(paragraphPosition);
    const firstListParagraph = editor.view.dom.querySelector("li p");
    let listTextPosition = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "paragraph" && node.textContent === "Move me") {
        listTextPosition = position + 1;
        return false;
      }
      return true;
    });
    if (
      !(list instanceof HTMLElement) ||
      !(table instanceof HTMLElement) ||
      !(after instanceof HTMLElement) ||
      !firstListParagraph ||
      listTextPosition < 0
    ) {
      throw new Error("Missing 120 percent list/table fixture");
    }
    editor.view.dom.getBoundingClientRect = () =>
      createRect(100 * zoom, 0, 700 * zoom, 440 * zoom);
    host.getBoundingClientRect = () =>
      createRect(100 * zoom, 0, 700 * zoom, 440 * zoom);
    list.getBoundingClientRect = () =>
      createRect(100 * zoom, 20 * zoom, 700 * zoom, 100 * zoom);
    table.getBoundingClientRect = () =>
      createRect(100 * zoom, 120 * zoom, 700 * zoom, 260 * zoom);
    after.getBoundingClientRect = () =>
      createRect(100 * zoom, 280 * zoom, 700 * zoom, 320 * zoom);
    firstListParagraph.getBoundingClientRect = () =>
      createRect(144 * zoom, 20 * zoom, 700 * zoom, 56 * zoom);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: listTextPosition,
      inside: listTextPosition - 1,
    });

    const startDrag = async (pointerId: number) => {
      firstListParagraph.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 174 * zoom,
          clientY: 38 * zoom,
        }),
      );
      await flushAnimationFrames();
      const grip = document.querySelector<HTMLElement>(".notion-block-grip");
      grip?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 90 * zoom,
          clientY: 38 * zoom,
          isPrimary: true,
          pointerId,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 300 * zoom,
          clientY: 252 * zoom,
          isPrimary: true,
          pointerId,
        }),
      );
    };

    try {
      await act(async () => {
        root.render(<BlockDragControls editor={editor} />);
      });
      await act(async () => startDrag(1));
      expect(
        document.querySelector<HTMLElement>(".notion-block-drop-indicator")
          ?.style.top,
      ).toBe("280px");

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });
      expect(document.querySelector(".notion-block-drop-indicator")).toBeNull();
      expect(editor.getJSON()).toEqual(initialDocument);

      await act(async () => startDrag(2));
      await act(async () => {
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 300 * zoom,
            clientY: 252 * zoom,
            isPrimary: true,
            pointerId: 2,
          }),
        );
      });
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
        "bulletList",
        "table",
        "bulletList",
        "paragraph",
      ]);
      expect(editor.state.doc.child(1).toJSON()).toEqual(tableNode.toJSON());
      expect(editor.state.doc.child(2).textContent).toBe("Move me");
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
    }
  });

  it.each([
    [
      "bullet list",
      "ul",
      "bulletList",
      "<p>Before</p><ul><li><p>First wrapped list line</p></li><li><p>Second item</p></li></ul><p>After</p>",
    ],
    [
      "numbered list",
      "ol",
      "orderedList",
      "<p>Before</p><ol><li><p>First wrapped list line</p></li><li><p>Second item</p></li></ol><p>After</p>",
    ],
  ])(
    "reorders the hovered %s item through the macOS pointer fallback",
    async (_label, selector, listType, content) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      const editor = new Editor({ extensions: [StarterKit], content });
      const host = document.createElement("div");
      const controls = document.createElement("div");
      host.append(editor.view.dom, controls);
      document.body.append(host);
      const root = createRoot(controls);

      const [before, after] = editor.view.dom.querySelectorAll(":scope > p");
      const list = editor.view.dom.querySelector<HTMLElement>(selector);
      const listItems = list?.querySelectorAll("li");
      const firstListParagraph = listItems?.[0]?.querySelector("p");
      if (
        !before ||
        !after ||
        !list ||
        !listItems ||
        listItems.length !== 2 ||
        !firstListParagraph
      ) {
        throw new Error("Missing pointer list drag fixture nodes");
      }

      let listTextPosition = -1;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "paragraph" &&
          node.textContent === "First wrapped list line"
        ) {
          listTextPosition = pos + 1;
        }
      });
      if (listTextPosition < 0) throw new Error("Missing list text position");

      editor.view.dom.getBoundingClientRect = () =>
        createRect(100, 0, 700, 400);
      before.getBoundingClientRect = () => createRect(100, 20, 700, 60);
      list.getBoundingClientRect = () => createRect(100, 80, 700, 180);
      listItems[0].getBoundingClientRect = () =>
        createRect(122, 80, 700, 128);
      listItems[1].getBoundingClientRect = () =>
        createRect(122, 132, 700, 180);
      firstListParagraph.getBoundingClientRect = () =>
        createRect(144, 80, 700, 128);
      after.getBoundingClientRect = () => createRect(100, 220, 700, 260);
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
        pos: listTextPosition,
        inside: listTextPosition - 1,
      });
      try {
        await act(async () => {
          root.render(<BlockDragControls editor={editor} />);
        });

        await act(async () => {
          firstListParagraph.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: 174,
              clientY: 96,
            }),
          );
          await flushAnimationFrames();
        });

        const grip = document.querySelector<HTMLElement>(
          ".notion-block-grip",
        );
        expect(grip).not.toBeNull();

        await act(async () => {
          grip?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX: 90,
              clientY: 96,
              isPrimary: true,
              pointerId: 1,
            }),
          );
          document.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              clientX: 300,
              clientY: 176,
              isPrimary: true,
              pointerId: 1,
            }),
          );
        });

        expect(
          document.querySelector(".notion-block-drop-indicator"),
        ).not.toBeNull();

        await act(async () => {
          document.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              clientX: 300,
              clientY: 176,
              isPrimary: true,
              pointerId: 1,
            }),
          );
        });

        expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
          "paragraph",
          listType,
          "paragraph",
        ]);
        const movedList = editor.state.doc.child(1);
        expect(movedList.child(0).textContent).toBe("Second item");
        expect(movedList.child(1).textContent).toBe(
          "First wrapped list line",
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        editor.destroy();
      }
    },
  );
});

describe("selection menu icon consistency", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("uses the shared SVG icon family for actions also present in the main toolbar", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Selected text</p>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    editor.commands.setTextSelection({ from: 1, to: 9 });

    try {
      await act(async () => {
        root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
      });

      for (const label of [
        "Bold",
        "Italic",
        "Strikethrough",
        "Inline code",
        "Add link",
      ]) {
        expect(
          document.querySelector(`button[aria-label="${label}"] svg`),
          `${label} should use the shared SVG icon family`,
        ).not.toBeNull();
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("exposes accessible light and dark theme values on color swatches", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Selected text</p>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    editor.commands.setTextSelection({ from: 1, to: 9 });

    try {
      await act(async () => {
        root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
      });

      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Text color"]',
      );
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });

      const red = document.querySelector<HTMLElement>(
        '[aria-label="text #dc2626"]',
      );
      expect(red).not.toBeNull();
      expect(red?.style.getPropertyValue("--notion-color-light")).toBe(
        "#b91c1c",
      );
      expect(red?.style.getPropertyValue("--notion-color-dark")).toBe(
        "#fca5a5",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("keeps selection while applying text color then highlight from both menus", async () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ScratchTextStyle,
        ScratchColor,
        ScratchHighlight.configure({ multicolor: true }),
      ],
      content: "<p>Selected text</p>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    editor.commands.setTextSelection({ from: 1, to: 9 });

    const openMenu = async (label: string) => {
      const trigger = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });
    };

    try {
      await act(async () => {
        root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
      });

      await openMenu("Text color");
      await act(async () => {
        document.querySelector<HTMLElement>('[aria-label="text #dc2626"]')?.click();
      });
      expect(editor.state.selection).toMatchObject({ from: 1, to: 9 });

      await openMenu("Highlight color");
      await act(async () => {
        document
          .querySelector<HTMLElement>('[aria-label="highlight #fde047"]')
          ?.click();
      });

      const selectedText = editor.state.doc.child(0).child(0);
      expect(editor.state.selection).toMatchObject({ from: 1, to: 9 });
      expect(
        selectedText.marks.find((mark) => mark.type.name === "textStyle")
          ?.attrs.color,
      ).toBe("#dc2626");
      expect(
        selectedText.marks.find((mark) => mark.type.name === "highlight")
          ?.attrs.color,
      ).toBe("#fde047");
      expect(
        editor.view.dom.querySelector('[data-text-color="#dc2626"]'),
      ).not.toBeNull();
      expect(
        editor.view.dom.querySelector('mark[data-color="#fde047"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("changes the selected block style from text to heading 2", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Selected text</p>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    editor.commands.setTextSelection({ from: 1, to: 9 });

    try {
      await act(async () => {
        root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
      });

      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Block style: Text"]',
      );
      expect(trigger).not.toBeNull();

      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });

      const heading2 = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.includes("Heading 2"));
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
        ).map((item) => item.textContent?.trim()),
      ).toEqual([
        "Text",
        "Heading 1",
        "Heading 2",
        "Heading 3",
        "Heading 4",
        "Bulleted list",
        "Numbered list",
        "Task list",
        "Quote",
      ]);
      expect(heading2).not.toBeNull();

      await act(async () => {
        heading2?.click();
      });

      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: "heading",
        attrs: { level: 2 },
      });
      expect(
        document.querySelector('button[aria-label="Block style: H2"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it.each([
    ["Bulleted list", "Bullets", "bulletList"],
    ["Numbered list", "Numbered", "orderedList"],
    ["Task list", "Tasks", "taskList"],
    ["Quote", "Quote", "blockquote"],
  ])(
    "changes selected text to %s",
    async (label, shortLabel, expectedNodeType) => {
      const editor = new Editor({
        extensions: [
          StarterKit,
          TaskList,
          TaskItem.configure({ nested: true }),
        ],
        content: "<p>Selected text</p>",
      });
      const host = document.createElement("div");
      const controls = document.createElement("div");
      host.append(editor.view.dom, controls);
      document.body.append(host);
      const root = createRoot(controls);
      editor.commands.setTextSelection({ from: 1, to: 9 });

      try {
        await act(async () => {
          root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
        });

        const trigger = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Block style: Text"]',
        );
        await act(async () => {
          trigger?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              isPrimary: true,
              pointerId: 1,
            }),
          );
        });

        const item = document.querySelector<HTMLElement>(
          `[aria-label="Set block style to ${label}"]`,
        );
        expect(item).not.toBeNull();

        await act(async () => {
          item?.click();
        });

        expect(editor.getJSON().content?.[0]?.type).toBe(expectedNodeType);
        expect(
          document.querySelector(
            `button[aria-label="Block style: ${shortLabel}"]`,
          ),
        ).not.toBeNull();
      } finally {
        await act(async () => {
          root.unmount();
        });
        editor.destroy();
      }
    },
  );

  it("changes a bulleted list to a numbered list in one undoable transaction", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<ul><li><p>Selected text</p></li></ul>",
    });
    const host = document.createElement("div");
    const controls = document.createElement("div");
    host.append(editor.view.dom, controls);
    document.body.append(host);
    const root = createRoot(controls);
    editor.commands.setTextSelection({ from: 3, to: 11 });
    expect(editor.isActive("bulletList")).toBe(true);

    try {
      await act(async () => {
        root.render(<SelectionMenu editor={editor} onEditLink={vi.fn()} />);
      });

      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Block style: Bullets"]',
      );
      expect(trigger).not.toBeNull();
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
          }),
        );
      });

      const numberedList = document.querySelector<HTMLElement>(
        '[aria-label="Set block style to Numbered list"]',
      );
      expect(numberedList).not.toBeNull();
      await act(async () => {
        numberedList?.click();
      });

      expect(editor.getJSON().content?.[0]?.type).toBe("orderedList");
      expect(
        document.querySelector('button[aria-label="Block style: Numbered"]'),
      ).not.toBeNull();

      await act(async () => {
        editor.commands.undo();
      });
      expect(editor.getJSON().content?.[0]?.type).toBe("bulletList");
    } finally {
      await act(async () => {
        root.unmount();
      });
      editor.destroy();
    }
  });

  it("stays hidden when an image node is selected", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: '<p>Before</p><img src="asset://localhost/assets/photo.png">',
    });

    try {
      editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize);
      expect(shouldShowSelectionMenu(editor, editor.state)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
});
