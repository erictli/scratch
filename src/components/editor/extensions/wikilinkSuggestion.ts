import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import {
  WikilinkSuggestionList,
  type WikilinkSuggestionRef,
} from "../WikilinkSuggestion";
import type { NoteMetadata } from "../../../types/note";

export interface WikilinkSuggestionConfig {
  getNotes: () => NoteMetadata[];
}

export function createWikilinkSuggestion(
  config: WikilinkSuggestionConfig
): Omit<SuggestionOptions, "editor"> {
  return {
    char: "[[",
    allowSpaces: true,

    items: ({ query }) => {
      const queryLower = query.toLowerCase();
      return config.getNotes()
        .filter((note) => note.title.toLowerCase().includes(queryLower))
        .slice(0, 8);
    },

    render: () => {
      let component: ReactRenderer<WikilinkSuggestionRef> | null = null;
      let popup: TippyInstance[] | null = null;

      return {
        onStart: (props: SuggestionProps) => {
          component = new ReactRenderer(WikilinkSuggestionList, {
            props: {
              ...props,
              items: props.items,
              query: props.query,
            },
            editor: props.editor,
          });

          if (!props.clientRect) return;

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            offset: [0, 4],
          });
        },

        onUpdate: (props: SuggestionProps) => {
          component?.updateProps({
            ...props,
            items: props.items,
            query: props.query,
          });

          if (props.clientRect && popup?.[0]) {
            popup[0].setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          }
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },

        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}
