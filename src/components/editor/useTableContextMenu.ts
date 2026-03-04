import { useCallback } from "react";
import { type Editor as TiptapEditor } from "@tiptap/react";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

export function useTableContextMenu(
  editor: TiptapEditor | null,
): (e: React.MouseEvent) => Promise<void> {
  return useCallback(
    async (e: React.MouseEvent) => {
      if (!editor) return;

      // Get the position at the click coordinates
      const clickPos = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });

      if (!clickPos) return;

      // Set the selection to the clicked position
      editor.chain().focus().setTextSelection(clickPos.pos).run();

      // Check if we're in a table after updating selection
      if (!editor.isActive("table")) return;

      e.preventDefault();

      try {
        const { state } = editor;
        const { selection } = state;
        const { $anchor } = selection;

        // Find the table cell/header node
        let cellDepth = $anchor.depth;
        while (
          cellDepth > 0 &&
          state.doc.resolve($anchor.pos).node(cellDepth).type.name !==
            "tableCell" &&
          state.doc.resolve($anchor.pos).node(cellDepth).type.name !==
            "tableHeader"
        ) {
          cellDepth--;
        }

        if (cellDepth <= 0) return;

        const resolvedNode = state.doc
          .resolve($anchor.pos)
          .node(cellDepth);
        if (
          resolvedNode.type.name !== "tableCell" &&
          resolvedNode.type.name !== "tableHeader"
        ) {
          return;
        }

        // Get the cell position
        const cellPos = $anchor.before(cellDepth);

        // Check if we're in the first column
        const rowNode = state.doc
          .resolve(cellPos)
          .node(cellDepth - 1);
        let cellIndex = 0;
        rowNode.forEach((_node, offset) => {
          if (offset < cellPos - $anchor.before(cellDepth - 1) - 1) {
            cellIndex++;
          }
        });
        const isFirstColumn = cellIndex === 0;

        // Check if we're in the first row
        const tableNode = state.doc
          .resolve(cellPos)
          .node(cellDepth - 2);
        let rowIndex = 0;
        tableNode.forEach((_node, offset) => {
          if (
            offset <
            $anchor.before(cellDepth - 1) -
              $anchor.before(cellDepth - 2) -
              1
          ) {
            rowIndex++;
          }
        });
        const isFirstRow = rowIndex === 0;

        const menuItems = [];

        if (!isFirstColumn) {
          menuItems.push(
            await MenuItem.new({
              text: "Add Column Before",
              action: () =>
                editor.chain().focus().addColumnBefore().run(),
            }),
          );
        }
        menuItems.push(
          await MenuItem.new({
            text: "Add Column After",
            action: () =>
              editor.chain().focus().addColumnAfter().run(),
          }),
        );
        menuItems.push(
          await MenuItem.new({
            text: "Delete Column",
            action: () =>
              editor.chain().focus().deleteColumn().run(),
          }),
        );
        menuItems.push(
          await PredefinedMenuItem.new({ item: "Separator" }),
        );

        if (!isFirstRow) {
          menuItems.push(
            await MenuItem.new({
              text: "Add Row Above",
              action: () =>
                editor.chain().focus().addRowBefore().run(),
            }),
          );
        }
        menuItems.push(
          await MenuItem.new({
            text: "Add Row Below",
            action: () =>
              editor.chain().focus().addRowAfter().run(),
          }),
        );
        menuItems.push(
          await MenuItem.new({
            text: "Delete Row",
            action: () =>
              editor.chain().focus().deleteRow().run(),
          }),
        );
        menuItems.push(
          await PredefinedMenuItem.new({ item: "Separator" }),
        );
        menuItems.push(
          await MenuItem.new({
            text: "Toggle Header Row",
            action: () =>
              editor.chain().focus().toggleHeaderRow().run(),
          }),
        );
        menuItems.push(
          await MenuItem.new({
            text: "Toggle Header Column",
            action: () =>
              editor.chain().focus().toggleHeaderColumn().run(),
          }),
        );
        menuItems.push(
          await PredefinedMenuItem.new({ item: "Separator" }),
        );
        menuItems.push(
          await MenuItem.new({
            text: "Delete Table",
            action: () =>
              editor.chain().focus().deleteTable().run(),
          }),
        );

        const menu = await Menu.new({ items: menuItems });
        await menu.popup();
      } catch (err) {
        console.error("Table context menu error:", err);
      }
    },
    [editor],
  );
}
