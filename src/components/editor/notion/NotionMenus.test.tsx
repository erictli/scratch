import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionMenu, shouldShowSelectionMenu } from "./NotionMenus";
import {
  ScratchColor,
  ScratchHighlight,
  ScratchTextStyle,
} from "./markdownMarks";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
  true;

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
