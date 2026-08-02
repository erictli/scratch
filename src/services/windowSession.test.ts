import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { getWindowSession, updateWindowSession } from "./windowSession";

describe("window session service", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the session scoped by the calling Tauri window", async () => {
    invokeMock.mockResolvedValueOnce(null);

    await getWindowSession();

    expect(invokeMock).toHaveBeenCalledWith("get_window_session");
  });

  it("updates a partial session patch without manufacturing other fields", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const patch = {
      selectedNoteId: "projects/plan",
      sidebarVisible: false,
    };

    await updateWindowSession(patch);

    expect(invokeMock).toHaveBeenCalledWith("update_window_session", { patch });
  });
});
