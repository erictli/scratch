import { TableRow } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { docContainsNestedTable } from "./tableIntegrity";

export const MIN_TABLE_ROW_HEIGHT = 28;
export const MAX_TABLE_ROW_HEIGHT = 480;

export function normalizeTableRowHeight(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;

  return Math.min(
    MAX_TABLE_ROW_HEIGHT,
    Math.max(MIN_TABLE_ROW_HEIGHT, Math.round(parsed)),
  );
}

export const ScratchTableRow = TableRow.extend({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("scratchTableIntegrity"),
        filterTransaction(transaction) {
          return (
            !transaction.docChanged ||
            !docContainsNestedTable(transaction.doc)
          );
        },
        props: {
          decorations(state) {
            const { selection } = state;
            if (!selection.empty || selection instanceof CellSelection) {
              return DecorationSet.empty;
            }

            for (let depth = selection.$head.depth; depth > 0; depth -= 1) {
              const cell = selection.$head.node(depth);
              if (
                cell.type.name !== "tableCell" &&
                cell.type.name !== "tableHeader"
              ) {
                continue;
              }

              const cellPos = selection.$head.before(depth);
              return DecorationSet.create(state.doc, [
                Decoration.node(cellPos, cellPos + cell.nodeSize, {
                  class: "scratch-table-cell-focused",
                }),
              ]);
            }

            return DecorationSet.empty;
          },
        },
      }),
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeTableRowHeight(element.getAttribute("data-row-height")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const rowHeight = normalizeTableRowHeight(attributes.rowHeight);
          if (!rowHeight) return {};

          return {
            "data-row-height": String(rowHeight),
            style: `height: ${rowHeight}px`,
          };
        },
      },
    };
  },
});
