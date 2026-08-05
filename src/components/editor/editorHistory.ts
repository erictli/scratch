import type { Content, Editor } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { normalizeNestedTablesInJson } from "./notion/tableIntegrity";

function normalizeLoadedContent(editor: Editor, content: Content): Content {
  if (typeof content === "string") {
    const inertDocument = document.implementation.createHTMLDocument("");
    const container = inertDocument.createElement("div");
    container.innerHTML = content;
    const parsed = ProseMirrorDOMParser.fromSchema(editor.schema).parse(container);
    return normalizeNestedTablesInJson(parsed.toJSON());
  }

  if (Array.isArray(content)) {
    return (
      normalizeNestedTablesInJson({ type: "doc", content }).content ?? []
    );
  }

  return content ? normalizeNestedTablesInJson(content) : content;
}

/**
 * Replace the document loaded from disk and start a fresh undo history.
 *
 * A note load is not a user edit. Keeping the setContent transaction in the
 * ProseMirror history lets a second Cmd+Z restore the previous (often empty)
 * document, which can then be autosaved over the note on disk.
 */
export function replaceEditorContentWithoutHistory(
  editor: Editor,
  content: Content,
): void {
  editor.commands.setContent(normalizeLoadedContent(editor, content));

  const loadedState = editor.state;
  // Recreating state intentionally resets transient plugin state for the newly loaded note.
  editor.view.updateState(
    EditorState.create({
      schema: loadedState.schema,
      doc: loadedState.doc,
      selection: loadedState.selection,
      plugins: loadedState.plugins,
    }),
  );
}
