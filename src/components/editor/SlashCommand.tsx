import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { ReactNode } from "react";
import {
  PilcrowIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  BlockMathIcon,
  SeparatorIcon,
  ImageIcon,
  TableIcon,
  BracketsIcon,
  WorkflowIcon,
} from "../icons";
import { SlashCommandList, type SlashCommandListRef } from "./SlashCommandList";

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: ReactNode;
  aliases: string[];
  command: (editor: TiptapEditor) => void;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: "Text",
    description: "Plain body text",
    icon: <PilcrowIcon />,
    aliases: ["paragraph", "body", "plain", "normal"],
    command: (editor) => {
      editor.chain().focus().setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1Icon />,
    aliases: ["h1", "heading", "title"],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2Icon />,
    aliases: ["h2", "heading", "subtitle"],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3Icon />,
    aliases: ["h3", "heading"],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: "Heading 4",
    description: "Smallest section heading",
    icon: <Heading4Icon />,
    aliases: ["h4", "heading"],
    command: (editor) => {
      editor.chain().focus().toggleHeading({ level: 4 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: <ListIcon />,
    aliases: ["ul", "unordered", "list"],
    command: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: <ListOrderedIcon />,
    aliases: ["ol", "ordered", "list", "numbered"],
    command: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    title: "Task List",
    description: "List with checkboxes",
    icon: <CheckSquareIcon />,
    aliases: ["todo", "checklist", "checkbox"],
    command: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    title: "Blockquote",
    description: "Block quotation",
    icon: <QuoteIcon />,
    aliases: ["quote"],
    command: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    title: "Code Block",
    description: "Fenced code block",
    icon: <CodeIcon />,
    aliases: ["code", "fenced", "pre"],
    command: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    title: "Mermaid Diagram",
    description: "Mermaid diagram block",
    icon: <WorkflowIcon />,
    aliases: ["mermaid", "diagram", "flowchart", "chart"],
    command: (editor) => {
      editor.chain().focus().setCodeBlock({ language: "mermaid" }).run();
    },
  },
  {
    title: "Block Math",
    description: "Display math block",
    icon: <BlockMathIcon />,
    aliases: ["math", "equation"],
    command: (editor) => {
      editor.chain().focus().run();
      window.dispatchEvent(new CustomEvent("slash-command-block-math"));
    },
  },
  {
    title: "Horizontal Rule",
    description: "Visual divider",
    icon: <SeparatorIcon />,
    aliases: ["divider", "separator", "hr", "line"],
    command: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    title: "Image",
    description: "Insert from file",
    icon: <ImageIcon />,
    aliases: ["picture", "photo", "img"],
    command: (editor) => {
      editor.chain().focus().run();
      window.dispatchEvent(new CustomEvent("slash-command-image"));
    },
  },
  {
    title: "Table",
    description: "Insert a 3×3 table",
    icon: <TableIcon />,
    aliases: ["grid"],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: "Wikilink",
    description: "Link to another note",
    icon: <BracketsIcon />,
    aliases: ["link", "note", "wikilink", "[["],
    command: (editor) => {
      editor.chain().focus().insertContent("[[").run();
    },
  },
];

const slashCommandPluginKey = new PluginKey("slashCommand");
const SLASH_COMMAND_MENU_MAX_HEIGHT = 320;
const SLASH_COMMAND_MENU_OFFSET = 4;
const SLASH_COMMAND_VIEWPORT_PADDING = 12;

function getDocumentZoom(): number {
  const zoom = Number.parseFloat(
    getComputedStyle(document.documentElement).zoom,
  );
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function normalizeSlashCommandReferenceRect(
  rect: DOMRect | null | undefined,
  zoom = getDocumentZoom(),
): DOMRect {
  if (!rect) return new DOMRect();

  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return new DOMRect(
    rect.x / scale,
    rect.y / scale,
    rect.width / scale,
    rect.height / scale,
  );
}

export function getSlashCommandMenuMaxHeight(
  rect: DOMRect | null | undefined,
  viewportHeight: number,
  zoom: number,
): number {
  if (!rect) return SLASH_COMMAND_MENU_MAX_HEIGHT;

  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const availableHeight =
    (viewportHeight -
      rect.bottom -
      SLASH_COMMAND_MENU_OFFSET * scale -
      SLASH_COMMAND_VIEWPORT_PADDING) /
    scale;

  return Math.floor(
    Math.max(0, Math.min(SLASH_COMMAND_MENU_MAX_HEIGHT, availableHeight)),
  );
}

function prepareSlashCommandReferenceRect(
  rect: DOMRect | null | undefined,
  menuElement: HTMLElement | null,
): DOMRect {
  const zoom = getDocumentZoom();
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  menuElement?.style.setProperty(
    "--suggestion-menu-max-height",
    `${getSlashCommandMenuMaxHeight(rect, viewportHeight, zoom)}px`,
  );
  return normalizeSlashCommandReferenceRect(rect, zoom);
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: "/",
        pluginKey: slashCommandPluginKey,
        allowSpaces: false,
        startOfLine: true,

        allow: ({ editor }) => {
          return (
            !editor.isActive("codeBlock") && !editor.isActive("frontmatter")
          );
        },

        items: ({ query }) => {
          const q = query.toLowerCase();
          return SLASH_COMMANDS.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              item.aliases.some((alias) => alias.includes(q)),
          );
        },

        command: ({ editor, range, props: item }) => {
          editor.chain().focus().deleteRange(range).run();
          item.command(editor);
        },

        render: () => {
          let component: ReactRenderer<SlashCommandListRef> | null = null;
          let popup: TippyInstance | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandList, {
                props: {
                  items: props.items,
                  command: props.command,
                },
                editor: props.editor,
              });

              popup = tippy(document.body, {
                getReferenceClientRect: () =>
                  prepareSlashCommandReferenceRect(
                    props.clientRect?.(),
                    component?.element ?? null,
                  ),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                offset: [0, 4],
                popperOptions: {
                  modifiers: [
                    {
                      name: "flip",
                      enabled: false,
                    },
                  ],
                },
              });
            },

            onUpdate: (props) => {
              component?.updateProps({
                items: props.items,
                command: props.command,
              });

              popup?.setProps({
                getReferenceClientRect: () =>
                  prepareSlashCommandReferenceRect(
                    props.clientRect?.(),
                    component?.element ?? null,
                  ),
              });
            },

            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit: () => {
              popup?.destroy();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});
