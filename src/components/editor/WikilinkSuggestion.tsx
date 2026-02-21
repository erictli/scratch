import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { NoteMetadata } from "../../types/note";
import type { WikilinkStorage } from "./Wikilink";
import {
  WikilinkSuggestionList,
  type WikilinkSuggestionListRef,
} from "./WikilinkSuggestionList";

const wikilinkSuggestionPluginKey = new PluginKey("wikilinkSuggestion");

export const WikilinkSuggestion = Extension.create({
  name: "wikilinkSuggestion",

  addProseMirrorPlugins() {
    return [
      Suggestion<NoteMetadata>({
        editor: this.editor,
        char: "[[",
        pluginKey: wikilinkSuggestionPluginKey,
        allowSpaces: true,
        startOfLine: false,

        allow: ({ editor }) => {
          return (
            !editor.isActive("codeBlock") &&
            !editor.isActive("frontmatter") &&
            !editor.isActive("code")
          );
        },

        items: ({ query }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const notes = (
            (this.editor.storage as any).wikilink as WikilinkStorage | undefined
          )?.notes;
          if (!notes) return [];
          const q = query.toLowerCase();
          return notes
            .filter((note) => note.title.toLowerCase().includes(q))
            .slice(0, 10);
        },

        command: ({ editor, range, props: note }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikilink",
              attrs: { noteTitle: note.title },
            })
            .run();
        },

        render: () => {
          let component: ReactRenderer<WikilinkSuggestionListRef> | null =
            null;
          let popup: TippyInstance | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(WikilinkSuggestionList, {
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
