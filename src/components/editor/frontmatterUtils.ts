import type { Editor } from "@tiptap/core";

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function hasFrontmatterAtTop(editor: Editor): boolean {
  return editor.state.doc.firstChild?.type.name === "frontmatter";
}

export function insertObsidianFrontmatter(editor: Editor): "inserted" | "exists" {
  if (hasFrontmatterAtTop(editor)) {
    editor.commands.focus("start");
    return "exists";
  }

  const template = `tags: []\naliases: []\ncreated: ${todayDateString()}`;

  editor
    .chain()
    .focus()
    .insertContentAt(0, [
      {
        type: "frontmatter",
        content: [{ type: "text", text: template }],
      },
      { type: "paragraph" },
    ])
    .run();

  const frontmatterSize = editor.state.doc.firstChild?.nodeSize ?? 0;
  const paragraphStart = Math.max(1, frontmatterSize + 1);
  editor.commands.setTextSelection(paragraphStart);
  editor.commands.focus();

  return "inserted";
}
