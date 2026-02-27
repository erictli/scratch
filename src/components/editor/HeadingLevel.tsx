import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Extension that adds heading level indicators (H1, H2, etc.) to the left of headings
 */
export const HeadingLevel = Extension.create({
  name: "headingLevel",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headingLevel"),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            const { doc } = state;

            doc.descendants((node, pos) => {
              if (node.type.name === "heading") {
                const level = node.attrs.level;
                const decoration = Decoration.widget(
                  pos + 1,
                  () => {
                    const span = document.createElement("span");
                    span.className = "heading-level-indicator";
                    span.textContent = `H${level}`;
                    span.contentEditable = "false";
                    span.setAttribute("data-heading-level", level.toString());
                    return span;
                  },
                  {
                    side: -1,
                    key: `heading-level-${pos}`,
                  }
                );
                decorations.push(decoration);
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
