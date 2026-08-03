import { DndContext } from "@dnd-kit/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FolderNode } from "../../types/note";
import { FolderItemComponent } from "./FolderTreeView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("FolderItemComponent", () => {
  it("does not expose a per-folder descendant-collapse action", () => {
    const child: FolderNode = {
      name: "docs",
      path: "Point/docs",
      children: [],
      notes: [],
    };
    const parent: FolderNode = {
      name: "Point",
      path: "Point",
      children: [child],
      notes: [],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <DndContext>
          <FolderItemComponent
            folder={parent}
            depth={0}
            collapsedFolders={new Set()}
            onToggleCollapse={vi.fn()}
            selectedNoteId={null}
            pinnedIds={new Set()}
            multiSelectedNoteIds={new Set()}
            onNoteClick={vi.fn()}
            focusedItemKey={null}
            onCreateNoteHere={vi.fn()}
            onNewSubfolder={vi.fn()}
            onRenameFolder={vi.fn()}
            onDeleteFolder={vi.fn()}
            onPinNote={vi.fn(async () => undefined)}
            onUnpinNote={vi.fn(async () => undefined)}
            onDuplicateNote={vi.fn(async () => undefined)}
            onDeleteNote={vi.fn()}
            onMoveNoteToParent={vi.fn()}
            onMoveFolderToParent={vi.fn()}
          />
        </DndContext>,
      );
    });

    expect(
      container.querySelector(
        'button[aria-label="Collapse all subfolders in Point"]',
      ),
    ).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });
});
