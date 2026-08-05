import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNotesFolderMock, listenMock, saveNoteMock } = vi.hoisted(() => ({
  getNotesFolderMock: vi.fn(),
  listenMock: vi.fn(),
  saveNoteMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../services/notes", () => ({
  getNotesFolder: getNotesFolderMock,
  saveNote: saveNoteMock,
}));

import {
  NotesProvider,
  useNotesActions,
  useNotesData,
} from "./NotesContext";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("NotesProvider save failures", () => {
  beforeEach(() => {
    getNotesFolderMock.mockReset().mockResolvedValue(null);
    listenMock.mockReset().mockResolvedValue(vi.fn());
    saveNoteMock.mockReset();
  });

  it("keeps the UI error and rejects so safe close can recover the draft", async () => {
    const failure = new Error("disk full");
    saveNoteMock.mockRejectedValueOnce(failure);

    let actions: ReturnType<typeof useNotesActions> | null = null;
    let error: string | null = null;

    function Probe() {
      actions = useNotesActions();
      error = useNotesData().error;
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <NotesProvider>
          <Probe />
        </NotesProvider>,
      );
    });

    expect(actions).not.toBeNull();

    await act(async () => {
      await expect(
        actions!.saveNote("# Draft\n\nLatest content", "draft.md"),
      ).rejects.toBe(failure);
    });

    expect(saveNoteMock).toHaveBeenCalledWith(
      "draft.md",
      "# Draft\n\nLatest content",
    );
    expect(error).toBe("disk full");

    await act(async () => root.unmount());
  });
});
