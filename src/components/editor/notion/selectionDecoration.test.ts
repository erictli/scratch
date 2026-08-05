import { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ScratchColor,
  ScratchHighlight,
  ScratchTextStyle,
} from "./markdownMarks";
import { ScratchTextSelection } from "./selectionDecoration";

interface EditorViewWithDomObserver extends EditorView {
  domObserver: {
    flush: () => void;
  };
}

const moduleUrl = import.meta.url.startsWith("file:")
  ? import.meta.url
  : pathToFileURL(import.meta.filename).href;
const appStyles = readFileSync(
  fileURLToPath(new URL("../../../App.css", moduleUrl)),
  "utf8",
);

function dispatchNativeSelectionKey(
  editor: Editor,
  key: "ArrowLeft" | "ArrowRight",
  metaKey = false,
) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    metaKey,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

  editor.view.dom.dispatchEvent(event);
  return event;
}

function setDirectedSelection(editor: Editor, anchor: number, head: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, anchor, head),
    ),
  );
}

function syncNativeDOMHead(editor: Editor, head: number) {
  const domSelection = editor.view.dom.ownerDocument.getSelection();
  if (!domSelection) {
    throw new Error("Expected a DOM selection");
  }

  const anchor = editor.state.selection.anchor;
  const bias = head < anchor ? 1 : head > anchor ? -1 : 0;
  const headDOM = editor.view.domAtPos(head, bias);
  domSelection.extend(headDOM.node, headDOM.offset);
  editor.view.dom.ownerDocument.dispatchEvent(new Event("selectionchange"));
  (editor.view as EditorViewWithDomObserver).domObserver.flush();
}

describe("ScratchTextSelection", () => {
  it("decorates only a non-empty text selection", () => {
    const editor = new Editor({
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Quand je sélectionne un texte</p>",
    });

    try {
      editor.commands.setTextSelection({ from: 1, to: 6 });

      const decoratedSelection = editor.view.dom.querySelector(
        ".scratch-text-selection",
      );
      expect(decoratedSelection?.textContent).toBe("Quand");
      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(6);

      editor.commands.setTextSelection(6);

      expect(
        editor.view.dom.querySelector(".scratch-text-selection"),
      ).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("does not rewrite the selected DOM while the editor keeps focus", () => {
    const mount = document.createElement("div");
    const outsideButton = document.createElement("button");
    document.body.append(mount, outsideButton);
    const editor = new Editor({
      element: mount,
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Quand je sélectionne un texte</p>",
    });

    try {
      editor.view.focus();
      editor.commands.setTextSelection({ from: 1, to: 6 });

      expect(editor.view.hasFocus()).toBe(true);
      expect(
        editor.view.dom.querySelector(".scratch-text-selection"),
      ).toBeNull();

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 5),
        ),
      );

      expect(
        editor.view.dom.querySelector(".scratch-text-selection"),
      ).toBeNull();

      outsideButton.focus();

      expect(editor.view.hasFocus()).toBe(false);
      expect(
        editor.view.dom.querySelector(".scratch-text-selection")?.textContent,
      ).toBe("Quan");
    } finally {
      editor.destroy();
      mount.remove();
      outsideButton.remove();
    }
  });

  it("decorates all document text after selectAll", () => {
    const editor = new Editor({
      extensions: [StarterKit, ScratchTextSelection],
      content: "<h1>Titre</h1><p>Premier paragraphe</p><p>Dernier bloc</p>",
    });

    try {
      editor.commands.selectAll();

      expect(editor.state.selection).toBeInstanceOf(AllSelection);
      expect(
        Array.from(
          editor.view.dom.querySelectorAll(".scratch-text-selection"),
          (element) => element.textContent,
        ).join(" "),
      ).toBe("Titre Premier paragraphe Dernier bloc");
    } finally {
      editor.destroy();
    }
  });

  it("keeps a selected text color visible while adding a highlight", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ScratchTextStyle,
        ScratchColor,
        ScratchHighlight.configure({ multicolor: true }),
        ScratchTextSelection,
      ],
      content: "<p>Texte combiné</p>",
    });

    try {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.chain().setColor("#dc2626").setHighlight({ color: "#fde047" }).run();

      const marks = editor.state.doc.child(0).child(0).marks.map(
        (mark) => mark.type.name,
      );
      const selectedText = editor.view.dom.querySelector<HTMLElement>(
        ".scratch-text-selection",
      );
      const highlight = editor.view.dom.querySelector<HTMLElement>("mark");

      expect(marks).toEqual(expect.arrayContaining(["textStyle", "highlight"]));
      expect(selectedText?.textContent).toBe("Texte");
      expect(highlight?.style.color).toBe("");
      expect(selectedText?.style.color).toBe("");
      expect(appStyles).toMatch(
        /\.scratch-text-selection\s*{[^}]*color:\s*inherit;/s,
      );
      expect(appStyles).toMatch(
        /\.ProseMirror mark\s*{[^}]*color:\s*inherit;/s,
      );
    } finally {
      editor.destroy();
    }
  });

  it("lets native Shift+ArrowLeft shrink and Shift+ArrowRight extend a forward selection", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = new Editor({
      element: mount,
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Texte de sélection</p>",
    });

    try {
      editor.view.focus();
      setDirectedSelection(editor, 9, 19);

      const leftEvent = dispatchNativeSelectionKey(editor, "ArrowLeft");
      expect(leftEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 18);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(18);

      const rightEvent = dispatchNativeSelectionKey(editor, "ArrowRight");
      expect(rightEvent.defaultPrevented).toBe(false);
      // happy-dom has no keyboard-selection default. The browser owns the
      // extension once Scratch leaves this event unhandled.
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(18);
    } finally {
      editor.destroy();
      mount.remove();
    }
  });

  it("lets native Shift+ArrowRight shrink and Shift+ArrowLeft extend a backward selection", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = new Editor({
      element: mount,
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Texte de sélection</p>",
    });

    try {
      editor.view.focus();
      setDirectedSelection(editor, 9, 1);

      const rightEvent = dispatchNativeSelectionKey(editor, "ArrowRight");
      expect(rightEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 2);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(2);

      const leftEvent = dispatchNativeSelectionKey(editor, "ArrowLeft");
      expect(leftEvent.defaultPrevented).toBe(false);
      // happy-dom has no keyboard-selection default. The browser owns the
      // extension once Scratch leaves this event unhandled.
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(2);
    } finally {
      editor.destroy();
      mount.remove();
    }
  });

  it("keeps native Cmd+Shift+ArrowRight then ArrowLeft anchored in the middle", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = new Editor({
      element: mount,
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Texte de sélection</p>",
    });

    try {
      editor.view.focus();
      setDirectedSelection(editor, 9, 9);

      const rightEvent = dispatchNativeSelectionKey(
        editor,
        "ArrowRight",
        true,
      );
      expect(rightEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 19);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(19);

      const leftEvent = dispatchNativeSelectionKey(editor, "ArrowLeft", true);
      expect(leftEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 9);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(9);
      expect(editor.state.selection.empty).toBe(true);
    } finally {
      editor.destroy();
      mount.remove();
    }
  });

  it("keeps native Cmd+Shift+ArrowLeft then ArrowRight anchored in the middle", () => {
    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = new Editor({
      element: mount,
      extensions: [StarterKit, ScratchTextSelection],
      content: "<p>Texte de sélection</p>",
    });

    try {
      editor.view.focus();
      setDirectedSelection(editor, 9, 9);

      const leftEvent = dispatchNativeSelectionKey(editor, "ArrowLeft", true);
      expect(leftEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 1);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(1);

      const rightEvent = dispatchNativeSelectionKey(
        editor,
        "ArrowRight",
        true,
      );
      expect(rightEvent.defaultPrevented).toBe(false);
      syncNativeDOMHead(editor, 9);
      expect(editor.state.selection.anchor).toBe(9);
      expect(editor.state.selection.head).toBe(9);
      expect(editor.state.selection.empty).toBe(true);
    } finally {
      editor.destroy();
      mount.remove();
    }
  });
});
