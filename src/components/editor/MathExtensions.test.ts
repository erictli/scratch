import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { ScratchBlockMath } from "./MathExtensions";

describe("ScratchBlockMath selection", () => {
  it("keeps ProseMirror's native selection synchronized for later clicks", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        ScratchBlockMath.configure({ onClick: () => undefined }),
      ],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          { type: "blockMath", attrs: { latex: "x^2" } },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      },
    });

    try {
      const mathPosition = editor.state.doc.child(0).nodeSize;
      editor.view.focus();
      editor.commands.setNodeSelection(mathPosition);

      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect(editor.view.dom.ownerDocument.getSelection()?.rangeCount).toBe(1);
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});
