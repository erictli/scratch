import { DndContext } from "@dnd-kit/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFolderTree,
  getVisibleItemsForFolderSection,
} from "../../lib/folderTree";
import type { FolderNode, NoteMetadata } from "../../types/note";
import { FolderItemComponent, FolderTreeView } from "./FolderTreeView";

// Hoisted mocks for FolderTreeView integration test
const { mockUseNotes, mockListFolders } = vi.hoisted(() => ({
  mockUseNotes: vi.fn(),
  mockListFolders: vi.fn(),
}));

vi.mock("../../context/NotesContext", () => ({
  useNotes: mockUseNotes,
}));

vi.mock("../../services/notes", () => ({
  listFolders: mockListFolders,
  getNotesFolder: vi.fn().mockResolvedValue("/tmp/notes"),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

afterEach(() => {
  document.body.replaceChildren();
});

function note(id: string, modified: number): NoteMetadata {
  return { id, title: id, preview: "", modified };
}

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

describe("getVisibleItemsForFolderSection keyboard navigation", () => {
  it("excludes folder items from keyboard navigation while section is collapsed and includes them when expanded", () => {
    const tree = buildFolderTree(
      [note("pinned", 30), note("docs/inside", 20), note("recent", 10)],
      new Set(["pinned"]),
      ["docs"],
    );

    // When collapsed: folder items are excluded from keyboard navigation
    const collapsed = getVisibleItemsForFolderSection(
      tree,
      new Set(["pinned"]),
      new Set(),
      true,
    );
    expect(collapsed).toEqual([
      { type: "note", id: "pinned" },
      { type: "note", id: "recent" },
    ]);
    expect(collapsed.some((item) => item.type === "folder")).toBe(false);

    // When expanded: folder items are included in keyboard navigation
    const expanded = getVisibleItemsForFolderSection(
      tree,
      new Set(["pinned"]),
      new Set(),
      false,
    );
    expect(
      expanded.some((item) => item.type === "folder" && item.path === "docs"),
    ).toBe(true);
    expect(
      expanded.some(
        (item) => item.type === "note" && item.id === "docs/inside",
      ),
    ).toBe(true);
  });
});

describe("FolderTreeView folder section collapse and reopening", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined" && localStorage !== null) {
      localStorage.clear();
    }
    vi.clearAllMocks();
    mockListFolders.mockResolvedValue(["docs"]);
    mockUseNotes.mockReturnValue({
      notes: [note("note1", 1000), note("docs/note2", 2000)],
      selectedNoteId: null,
      currentNote: null,
      notesFolder: null,
      isLoading: false,
      error: null,
      searchQuery: "",
      searchResults: [],
      isSearching: false,
      hasExternalChanges: false,
      reloadVersion: 0,
      selectNote: vi.fn(),
      createNote: vi.fn(),
      consumePendingNewNote: vi.fn(),
      saveNote: vi.fn(),
      deleteNote: vi.fn(),
      duplicateNote: vi.fn(),
      refreshNotes: vi.fn(),
      reloadCurrentNote: vi.fn(),
      setNotesFolder: vi.fn(),
      syncNotesFolder: vi.fn(),
      search: vi.fn(),
      clearSearch: vi.fn(),
      pinNote: vi.fn(),
      unpinNote: vi.fn(),
      createNoteInFolder: vi.fn(),
      createFolder: vi.fn(),
      deleteFolder: vi.fn(),
      renameFolder: vi.fn(),
      moveNote: vi.fn(),
      moveFolder: vi.fn(),
    });
  });

  it("reopens a collapsed Folders section when an expand-folder event fires", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <FolderTreeView
            sortOrder="newest"
            pinnedIds={new Set()}
            settings={null}
            multiSelectedNoteIds={new Set()}
            setMultiSelectedNoteIds={vi.fn()}
            lastClickedNoteId={null}
            setLastClickedNoteId={vi.fn()}
          />
        </DndContext>,
      );
    });

    // Wait for async listFolders to resolve and tree to build
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Initially expanded (default localStorage state is false/expanded)
    expect(
      container.querySelector('button[aria-label="Collapse Folders"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Expand Folders"]'),
    ).toBeNull();

    // Collapse the section
    act(() => {
      (
        container.querySelector(
          'button[aria-label="Collapse Folders"]',
        ) as HTMLButtonElement | null
      )?.click();
    });

    // Section is now collapsed
    expect(
      container.querySelector('button[aria-label="Expand Folders"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Collapse Folders"]'),
    ).toBeNull();

    // Dispatch expand-folder event to reopen
    act(() => {
      window.dispatchEvent(new CustomEvent("expand-folder", { detail: "docs" }));
    });

    // Section is now expanded again
    expect(
      container.querySelector('button[aria-label="Collapse Folders"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Expand Folders"]'),
    ).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("does not block native Enter activation on the Folders disclosure", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <FolderTreeView
            sortOrder="newest"
            pinnedIds={new Set()}
            settings={null}
            multiSelectedNoteIds={new Set()}
            setMultiSelectedNoteIds={vi.fn()}
            lastClickedNoteId={null}
            setLastClickedNoteId={vi.fn()}
          />
        </DndContext>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const disclosure = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse Folders"]',
    );
    expect(disclosure).not.toBeNull();
    disclosure?.focus();

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      disclosure?.dispatchEvent(enter);
    });

    expect(enter.defaultPrevented).toBe(false);

    act(() => root.unmount());
    container.remove();
  });
});
