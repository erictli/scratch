import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  listenMock,
  saveNoteMock,
  readNoteMock,
  getNotesFolderMock,
  listNotesMock,
} = vi.hoisted(() => ({
  listenMock: vi.fn().mockResolvedValue(() => {}),
  saveNoteMock: vi.fn(),
  readNoteMock: vi.fn(),
  getNotesFolderMock: vi.fn().mockResolvedValue(null),
  listNotesMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

vi.mock("../services/notes", () => ({
  saveNote: (...args: unknown[]) => saveNoteMock(...args),
  readNote: (...args: unknown[]) => readNoteMock(...args),
  getNotesFolder: (...args: unknown[]) => getNotesFolderMock(...args),
  listNotes: (...args: unknown[]) => listNotesMock(...args),
  setNotesFolder: vi.fn(),
  listWorkspaces: vi.fn(),
  openWorkspaceWindow: vi.fn(),
  switchWorkspace: vi.fn(),
  removeWorkspaceFromList: vi.fn(),
  persistRecoverySnapshot: vi.fn(),
  deleteNote: vi.fn(),
  createNote: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  renameFolder: vi.fn(),
  moveNote: vi.fn(),
  moveFolder: vi.fn(),
  duplicateNote: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn(),
  updateGlobalSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
  updateGitEnabled: vi.fn(),
  searchNotes: vi.fn(),
  startFileWatcher: vi.fn(),
}));

const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});

import { NotesProvider, useNotesActions, useNotesData } from "../context/NotesContext";

function TestConsumer() {
  const { selectNote, saveNote } = useNotesActions();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await selectNote("note-1");
      if (cancelled) return;
      await saveNote("new content", "note-1");
      if (cancelled) return;
      window.dispatchEvent(new CustomEvent("save-complete"));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectNote, saveNote]);

  return null;
}

function ErrorConsumer() {
  const { saveNote } = useNotesActions();
  const { error } = useNotesData();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await saveNote("content", "note-1");
      } catch {
        // expected
      }
      if (cancelled) return;
      window.dispatchEvent(new CustomEvent("error-emitted"));
    })();
    return () => {
      cancelled = true;
    };
  }, [saveNote]);

  return <span data-testid="error">{error ?? ""}</span>;
}

describe("NotesContext saveNote call chain", () => {
  afterEach(() => {
    saveNoteMock.mockReset();
    readNoteMock.mockReset();
    listNotesMock.mockReset();
    consoleErrorMock.mockClear();
    listenMock.mockClear();
    document.body.replaceChildren();
  });

  it("resolves the revision and calls notesService.saveNote in the correct order", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    readNoteMock.mockResolvedValueOnce({
      id: "note-1",
      title: "Note",
      content: "old content",
      path: "/notes/note-1.md",
      modified: 1,
      revision: "rev-1",
    });
    saveNoteMock.mockResolvedValueOnce({
      status: "saved",
      note: { id: "note-1", revision: "rev-2" },
    });

    const saveCompletePromise = new Promise<void>((resolve) => {
      const handler = () => {
        window.removeEventListener("save-complete", handler);
        resolve();
      };
      window.addEventListener("save-complete", handler);
    });

    try {
      await act(async () => {
        root.render(
          <NotesProvider>
            <TestConsumer />
          </NotesProvider>,
        );
      });

      await saveCompletePromise;

      expect(saveNoteMock).toHaveBeenCalledTimes(1);
      expect(saveNoteMock).toHaveBeenCalledWith(
        "note-1",
        "new content",
        "rev-1",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});

describe("NotesContext missing revision error", () => {
  afterEach(() => {
    saveNoteMock.mockReset();
    readNoteMock.mockReset();
    consoleErrorMock.mockClear();
    listenMock.mockClear();
    document.body.replaceChildren();
  });

  it("logs the note id to console and surfaces an actionable user-facing error", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const errorEmittedPromise = new Promise<void>((resolve) => {
      const handler = () => {
        window.removeEventListener("error-emitted", handler);
        resolve();
      };
      window.addEventListener("error-emitted", handler);
    });

    try {
      await act(async () => {
        root.render(
          <NotesProvider>
            <ErrorConsumer />
          </NotesProvider>,
        );
      });

      await errorEmittedPromise;

      const errorText = host.querySelector<HTMLSpanElement>("[data-testid='error']")?.textContent;
      expect(errorText).not.toContain("note-1");
      expect(errorText).toContain("editor's base revision is missing");
      expect(consoleErrorMock).toHaveBeenCalledWith(
        "Missing base revision for note-1",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
