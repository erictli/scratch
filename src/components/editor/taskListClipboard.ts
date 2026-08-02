import type { EditorView } from "@tiptap/pm/view";

/**
 * Tiptap renders a task item's checkbox and text as sibling blocks:
 *
 *   <label><input><span></span></label><div><p>Task</p></div>
 *
 * Some rich-text targets (including Notion) interpret those siblings as an
 * empty todo followed by a paragraph. Keep Scratch's editor DOM unchanged and
 * write standard labelled-checkbox HTML to the clipboard instead:
 *
 *   <li><label><input type="checkbox">Task</label></li>
 *
 * Keeping the input and its phrasing content in the same label is important:
 * Notion otherwise imports an empty todo followed by a separate paragraph.
 */
export function normalizeTaskListClipboardHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const taskItems = Array.from(
    template.content.querySelectorAll<HTMLElement>(
      'li[data-type="taskItem"]',
    ),
  );
  let changed = false;

  const removeStructuralWhitespace = (element: Element) => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) {
        child.remove();
      }
    }
  };

  for (const taskItem of taskItems) {
    const label = Array.from(taskItem.children).find(
      (child) => child.tagName === "LABEL",
    );
    const content = Array.from(taskItem.children).find(
      (child) => child.tagName === "DIV",
    );
    const checkbox = label?.querySelector<HTMLInputElement>(
      ':scope > input[type="checkbox"]',
    );

    if (!label || !content || !checkbox) continue;

    removeStructuralWhitespace(taskItem);
    removeStructuralWhitespace(label);
    removeStructuralWhitespace(content);
    for (const nestedList of Array.from(
      content.querySelectorAll('ul[data-type="taskList"]'),
    )) {
      removeStructuralWhitespace(nestedList);
    }

    const paragraphs = Array.from(content.children).filter(
      (child) => child.tagName === "P",
    );
    if (paragraphs.length === 0) continue;

    for (const child of Array.from(label.childNodes)) {
      if (child !== checkbox) child.remove();
    }

    paragraphs.forEach((paragraph, index) => {
      if (index > 0 && paragraph.textContent?.trim()) {
        label.append(document.createTextNode(" "));
      }
      while (paragraph.firstChild) {
        label.append(paragraph.firstChild);
      }
      paragraph.remove();
    });

    // A nested task list remains after the task item's inline checkbox/text.
    while (content.firstChild) {
      taskItem.append(content.firstChild);
    }
    content.remove();
    changed = true;
  }

  return changed ? template.innerHTML : html;
}

export function normalizeTaskListClipboardText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[\t ]*\n+/g, "\n")
    .trim();
}

export function handleTaskListClipboardCopy(
  view: EditorView,
  event: ClipboardEvent,
): boolean {
  if (!event.clipboardData || view.state.selection.empty) return false;

  const { dom, text } = view.serializeForClipboard(
    view.state.selection.content(),
  );
  const html = dom.innerHTML;
  const normalizedHtml = normalizeTaskListClipboardHtml(html);

  // Preserve ProseMirror's native copy path for every selection that does not
  // contain a task item.
  if (normalizedHtml === html) return false;

  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", normalizedHtml);
  event.clipboardData.setData("text/plain", normalizeTaskListClipboardText(text));
  return true;
}
