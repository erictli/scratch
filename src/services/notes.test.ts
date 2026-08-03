import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  listWorkspaces,
  openWorkspaceWindow,
  persistRecoverySnapshot,
  removeWorkspaceFromList,
  saveNote,
  switchWorkspace,
  updateGlobalSettings,
  updateWorkspaceSettings,
} from "./notes";

describe("draft recovery", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("/recovery/Plan.md");
  });

  it("persists the exact dirty markdown before an unsafe close", async () => {
    await persistRecoverySnapshot({
      noteId: "folder/Plan",
      sourcePath: "/notes/folder/Plan.md",
      content: "# Plan\n\nUnsaved draft",
      reason: "window-close",
    });

    expect(invokeMock).toHaveBeenCalledWith("persist_recovery_snapshot", {
      noteId: "folder/Plan",
      sourcePath: "/notes/folder/Plan.md",
      content: "# Plan\n\nUnsaved draft",
      reason: "window-close",
    });
  });
});

describe("revision-aware note persistence", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends the exact revision that the editor originally loaded", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "saved",
      note: {
        id: "Plan",
        title: "Plan",
        content: "# Plan\n\nUpdated",
        path: "/notes/Plan.md",
        modified: 1,
        revision: "revision-after-save",
      },
    });

    await saveNote("Plan", "# Plan\n\nUpdated", "revision-before-save");

    expect(invokeMock).toHaveBeenCalledWith("save_note", {
      id: "Plan",
      content: "# Plan\n\nUpdated",
      expectedRevision: "revision-before-save",
    });
  });

  it("preserves a typed conflict returned by the backend", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "conflict",
      current: {
        content: "# Plan\n\nRemote edit",
        revision: "remote-revision",
      },
    });

    const result = await saveNote(
      "Plan",
      "# Plan\n\nLocal draft",
      "stale-revision",
    );

    expect(result).toEqual({
      status: "conflict",
      current: {
        content: "# Plan\n\nRemote edit",
        revision: "remote-revision",
      },
    });
  });
});

describe("workspace windows", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("lists saved spaces for the calling window", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await listWorkspaces();

    expect(invokeMock).toHaveBeenCalledWith("list_workspaces");
  });

  it("opens a folder without changing the current folder location", async () => {
    invokeMock.mockResolvedValueOnce("workspace-client");

    await openWorkspaceWindow("/notes/client");

    expect(invokeMock).toHaveBeenCalledWith("open_workspace_window", {
      path: "/notes/client",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("set_notes_folder", {
      path: "/notes/client",
    });
  });

  it("switches the calling window without opening another window", async () => {
    invokeMock.mockResolvedValueOnce("/notes/client");

    await switchWorkspace("/notes/client");

    expect(invokeMock).toHaveBeenCalledWith("switch_workspace", {
      path: "/notes/client",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("open_workspace_window", {
      path: "/notes/client",
    });
  });

  it("removes a remembered folder without invoking a filesystem delete", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await removeWorkspaceFromList("/notes/archive");

    expect(invokeMock).toHaveBeenCalledWith("remove_workspace_from_list", {
      path: "/notes/archive",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("delete_folder", {
      path: "/notes/archive",
    });
  });
});

describe("scoped settings writes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("patches one global field without sending stale workspace settings", async () => {
    await updateGlobalSettings({ interfaceZoom: 1.2 });

    expect(invokeMock).toHaveBeenCalledWith("update_global_settings", {
      patch: { interfaceZoom: 1.2 },
    });
  });

  it("patches workspace pins without sending stale appearance settings", async () => {
    await updateWorkspaceSettings({ pinnedNoteIds: ["Plan"] });

    expect(invokeMock).toHaveBeenCalledWith("update_workspace_settings", {
      patch: { pinnedNoteIds: ["Plan"] },
    });
  });
});
