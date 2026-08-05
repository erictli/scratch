import { Editor, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { replaceEditorContentWithoutHistory } from "./editorHistory";

describe("editor note history", () => {
  it("never lets undo erase the content loaded from the note", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p></p>",
    });

    try {
      const loadedContent = "Contenu chargé depuis la note";

      replaceEditorContentWithoutHistory(
        editor,
        `<p>${loadedContent}</p>`,
      );

      const paragraphEnd = editor.state.doc.content.size - 1;
      editor.commands.insertContentAt(paragraphEnd, " + saisie");
      expect(editor.getText()).toBe(`${loadedContent} + saisie`);

      expect(editor.commands.undo()).toBe(true);
      expect(editor.getText()).toBe(loadedContent);

      expect(editor.commands.undo()).toBe(false);
      expect(editor.getText()).toBe(loadedContent);
    } finally {
      editor.destroy();
    }
  });

  it("flattens nested tables while preserving parent and nested cell text", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: "<p></p>",
    });

    const loadedContent: JSONContent = {
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
                                  content: [
                                    { type: "text", text: "Nested cell" },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      replaceEditorContentWithoutHistory(editor, loadedContent);

      const cellsContainingNestedTables: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name !== "tableCell" && node.type.name !== "tableHeader") {
          return;
        }

        let containsTable = false;
        node.descendants((descendant) => {
          if (descendant.type.name === "table") {
            containsTable = true;
            return false;
          }
        });

        if (containsTable) {
          cellsContainingNestedTables.push(node.textContent);
        }
      });

      expect(cellsContainingNestedTables).toEqual([]);
      expect(editor.state.doc.textContent).toContain("Parent cell");
      expect(editor.state.doc.textContent).toContain("Nested cell");
    } finally {
      editor.destroy();
    }
  });

  it("parses loaded HTML in an inert document without running attributes", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Before</p>",
    });
    const createInertDocument = vi.spyOn(
      document.implementation,
      "createHTMLDocument",
    );
    let eventHandlerRan = false;
    (globalThis as typeof globalThis & { markLoaded?: () => void }).markLoaded =
      () => {
        eventHandlerRan = true;
      };

    try {
      replaceEditorContentWithoutHistory(
        editor,
        '<p>Safe</p><img src="https://invalid.example/image.png" onerror="markLoaded()">',
      );

      expect(createInertDocument).toHaveBeenCalledWith("");
      expect(eventHandlerRan).toBe(false);
      expect(editor.getText()).toBe("Safe");
    } finally {
      delete (globalThis as typeof globalThis & { markLoaded?: () => void })
        .markLoaded;
      createInertDocument.mockRestore();
      editor.destroy();
    }
  });
});
