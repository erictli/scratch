import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export interface WikilinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onNavigate: (noteId: string) => void;
  onCreate: (title: string) => void;
  suggestion: Omit<SuggestionOptions, "editor">;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      setWikilink: (attributes: { title: string; noteId?: string }) => ReturnType;
    };
  }
}

// Regex to match [[wikilinks]]
const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

export const Wikilink = Node.create<WikilinkOptions>({
  name: "wikilink",

  group: "inline",

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: () => {},
      onCreate: () => {},
      suggestion: {
        char: "[[",
        command: ({ editor, range, props }) => {
          // Delete the [[ trigger and query text, then insert wikilink node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikilink",
              attrs: { title: props.title, noteId: props.id || null },
            })
            .run();
        },
      } as Omit<SuggestionOptions, "editor">,
    };
  },

  addAttributes() {
    return {
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) => ({
          "data-title": attributes.title,
        }),
      },
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note-id"),
        renderHTML: (attributes) => ({
          "data-note-id": attributes.noteId,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wikilink"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "wikilink", class: "wikilink" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      node.attrs.title,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className =
        "wikilink text-blue-600 dark:text-blue-400 cursor-pointer hover:underline bg-blue-50 dark:bg-blue-900/20 px-1 rounded";
      dom.textContent = node.attrs.title;
      dom.setAttribute("data-type", "wikilink");
      dom.setAttribute("data-title", node.attrs.title);

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.noteId) {
          this.options.onNavigate(node.attrs.noteId);
        } else {
          this.options.onCreate(node.attrs.title);
        }
      });

      return { dom };
    };
  },

  addCommands() {
    return {
      setWikilink:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },

  addProseMirrorPlugins() {
    const wikilinkPluginKey = new PluginKey("wikilink");

    return [
      // Suggestion plugin for [[ autocomplete
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
      // Decoration plugin for highlighting [[wikilinks]] in raw text
      new Plugin({
        key: wikilinkPluginKey,
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            const doc = state.doc;

            doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                let match;
                const text = node.text;
                WIKILINK_REGEX.lastIndex = 0;

                while ((match = WIKILINK_REGEX.exec(text)) !== null) {
                  const start = pos + match.index;
                  const end = start + match[0].length;

                  decorations.push(
                    Decoration.inline(start, end, {
                      class: "wikilink-syntax",
                    })
                  );
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
