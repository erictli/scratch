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
  SeparatorIcon,
  ImageIcon,
  TableIcon,
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
];

const slashCommandPluginKey = new PluginKey("slashCommand");

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
                  props.clientRect?.() ?? new DOMRect(),
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
                      options: { fallbackPlacements: ["top-start"] },
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
                  props.clientRect?.() ?? new DOMRect(),
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
