import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  handleTaskListClipboardCopy,
  normalizeTaskListClipboardHtml,
} from "./taskListClipboard";

describe("task-list clipboard HTML", () => {
  it("keeps checkbox and task text inside one label for Notion", () => {
    const tiptapHtml = [
      '<ul data-type="taskList">',
      '  <li data-type="taskItem" data-checked="true">',
      '    <label><input type="checkbox" checked><span></span></label>',
      '    <div><p>Tâche <strong>terminée</strong></p></div>',
      "  </li>",
      "</ul>",
    ].join("");

    const root = document.createElement("div");
    root.innerHTML = normalizeTaskListClipboardHtml(tiptapHtml);

    const todo = root.querySelector<HTMLElement>('li[data-type="taskItem"]');
    const label = todo?.querySelector<HTMLElement>(":scope > label");

    // Notion associates a checkbox with its text only when both belong to the
    // same label. A bare input followed by text becomes an empty “To-do” block
    // and a separate paragraph.
    expect(label?.querySelector(":scope > input[type='checkbox']")).not.toBeNull();
    expect(label?.textContent).toBe("Tâche terminée");
    expect(label?.querySelector("strong")?.textContent).toBe("terminée");
    expect(todo?.querySelector(":scope > div, :scope > p, :scope > br")).toBeNull();
    expect(
      Array.from(todo?.childNodes ?? []).filter(
        (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
      ),
    ).toEqual([label]);
  });

  it("keeps todo text beside its checkbox without a separate paragraph in Notion", () => {
    const tiptapHtml = [
      '<ul data-type="taskList">',
      '  <li data-type="taskItem" data-checked="true">',
      '    <label><input type="checkbox" checked><span></span></label>',
      "    <div>",
      '      <p>Tâche <strong>terminée</strong> avec un <a href="https://example.com">lien</a></p>',
      '      <ul data-type="taskList">',
      '        <li data-type="taskItem" data-checked="false">',
      '          <label><input type="checkbox"><span></span></label>',
      "          <div><p>Sous-tâche</p></div>",
      "        </li>",
      "      </ul>",
      "    </div>",
      "  </li>",
      "</ul>",
    ].join("");

    const normalizedHtml = normalizeTaskListClipboardHtml(tiptapHtml);
    const root = document.createElement("div");
    root.innerHTML = normalizedHtml;

    const todos = root.querySelectorAll('li[data-type="taskItem"]');
    const todo = todos[0];
    const label = todo?.querySelector(":scope > label");
    const checkbox = label?.querySelector(":scope > input[type='checkbox']");
    const nestedList = todo?.querySelector(':scope > ul[data-type="taskList"]');

    expect(todos).toHaveLength(2);
    expect(checkbox?.hasAttribute("checked")).toBe(true);
    expect(label?.textContent).toBe("Tâche terminée avec un lien");
    expect(label?.querySelector(":scope > strong")?.textContent).toBe("terminée");
    expect(label?.querySelector(":scope > a")?.getAttribute("href")).toBe(
      "https://example.com",
    );

    // Notion must receive one labelled checkbox, then only the optional nested
    // task list. A bare input or sibling div > p creates an extra block.
    expect(Array.from(todo?.children ?? []).map((child) => child.tagName)).toEqual([
      "LABEL",
      "UL",
    ]);
    expect(nestedList?.textContent).toBe("Sous-tâche");
    expect(todo?.querySelector("div, p")).toBeNull();
    expect(root.textContent).not.toContain("To-do");
  });

  it("normalizes the real HTML emitted by Tiptap 3.29.2", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Tâche terminée" }],
                  },
                ],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Tâche à faire" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      editor.commands.selectAll();
      const { dom } = editor.view.serializeForClipboard(
        editor.state.selection.content(),
      );

      expect(dom.innerHTML).toContain("<div><p>");

      const normalizedHtml = normalizeTaskListClipboardHtml(dom.innerHTML);
      const root = document.createElement("div");
      root.innerHTML = normalizedHtml;

      const todos = root.querySelectorAll('li[data-type="taskItem"]');
      expect(todos).toHaveLength(2);
      expect(todos[0]?.textContent).toBe("Tâche terminée");
      expect(todos[1]?.textContent).toBe("Tâche à faire");
      expect(
        todos[0]?.querySelector(":scope > label > input[type='checkbox']"),
      ).toBeInstanceOf(HTMLInputElement);
      expect(
        todos[1]?.querySelector(":scope > label > input[type='checkbox']"),
      ).toBeInstanceOf(HTMLInputElement);
      expect(root.querySelector("li[data-type='taskItem'] > div > p")).toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("writes the normalized task-list HTML through the editor copy handler", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Une seule ligne" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const clipboard = new Map<string, string>();
    let prevented = false;
    const clipboardData = {
      clearData: () => clipboard.clear(),
      setData: (type: string, value: string) => {
        clipboard.set(type, value);
        return true;
      },
    } as unknown as DataTransfer;
    const event = {
      clipboardData,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as ClipboardEvent;

    try {
      editor.commands.selectAll();

      expect(handleTaskListClipboardCopy(editor.view, event)).toBe(true);
      expect(prevented).toBe(true);
      expect(clipboard.get("text/html")).toContain(
        '<label><input type="checkbox">Une seule ligne</label>',
      );
      expect(clipboard.get("text/html")).not.toContain("<div><p>");
      expect(clipboard.get("text/plain")).toContain("Une seule ligne");
      expect(clipboard.get("text/plain")).not.toMatch(/\n\s*\n/);
    } finally {
      editor.destroy();
    }
  });

  it("exports real Tiptap tasks as labelled checkbox-list HTML for Notion", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Tâche terminée" }],
                  },
                ],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Tâche à faire" }],
                  },
                ],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Tâche avec " },
                      {
                        type: "text",
                        text: "texte en gras",
                        marks: [{ type: "bold" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Tâche avec un " },
                      {
                        type: "text",
                        text: "lien",
                        marks: [
                          {
                            type: "link",
                            attrs: { href: "https://example.com" },
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
    });
    const clipboard = new Map<string, string>();
    const event = {
      clipboardData: {
        clearData: () => clipboard.clear(),
        setData: (type: string, value: string) => {
          clipboard.set(type, value);
          return true;
        },
      } as unknown as DataTransfer,
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;

    try {
      editor.commands.selectAll();
      expect(handleTaskListClipboardCopy(editor.view, event)).toBe(true);

      const root = document.createElement("div");
      root.innerHTML = clipboard.get("text/html") ?? "";
      const todos = Array.from(
        root.querySelectorAll<HTMLElement>('li[data-type="taskItem"]'),
      );
      const expectedTexts = [
        "Tâche terminée",
        "Tâche à faire",
        "Tâche avec texte en gras",
        "Tâche avec un lien",
      ];

      expect(todos).toHaveLength(expectedTexts.length);
      todos.forEach((todo, index) => {
        const label = todo.querySelector<HTMLElement>(":scope > label");
        const checkbox = label?.querySelector(":scope > input[type='checkbox']");

        // Interop contract: input and phrasing content belong to the same
        // label. Tiptap's separate label + div creates an empty Notion todo.
        expect(checkbox).toBeInstanceOf(HTMLInputElement);
        expect((checkbox as HTMLInputElement).type).toBe("checkbox");
        expect(label?.textContent?.trim()).toBe(expectedTexts[index]);
        expect(
          todo.querySelector(":scope > div, :scope > p, :scope > br"),
        ).toBeNull();
      });

      expect(
        todos[0]
          ?.querySelector(":scope > label > input")
          ?.hasAttribute("checked"),
      ).toBe(true);
      expect(todos[2]?.querySelector(":scope > label > strong")?.textContent).toBe(
        "texte en gras",
      );
      expect(
        todos[3]?.querySelector(":scope > label > a")?.getAttribute("href"),
      ).toBe("https://example.com");
      expect(root.textContent).not.toContain("To-do");
    } finally {
      editor.destroy();
    }
  });
});
