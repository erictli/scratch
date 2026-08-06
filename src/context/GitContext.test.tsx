import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_CHANGED_DOM_EVENT,
  type SettingsChangedEvent,
} from "../lib/settingsScope";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isGitAvailable: vi.fn(),
  getGitStatus: vi.fn(),
  gitFetch: vi.fn(),
  listen: vi.fn(),
  useNotesData: vi.fn(),
}));

vi.mock("../services/notes", () => ({
  getSettings: mocks.getSettings,
  updateGitEnabled: vi.fn(),
}));
vi.mock("../services/git", () => ({
  isGitAvailable: mocks.isGitAvailable,
  getGitStatus: mocks.getGitStatus,
  gitFetch: mocks.gitFetch,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./NotesContext", () => ({ useNotesData: mocks.useNotesData }));

import { GitProvider } from "./GitContext";

describe("GitProvider settings scope", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue({ gitEnabled: false });
    mocks.isGitAvailable.mockReset().mockResolvedValue(false);
    mocks.getGitStatus.mockReset();
    mocks.gitFetch.mockReset();
    mocks.listen.mockReset().mockResolvedValue(() => undefined);
    mocks.useNotesData.mockReset().mockReturnValue({
      notesFolder: "/notes/current",
    });
  });

  it("reloads git settings only for relevant workspace events", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<GitProvider>Git settings</GitProvider>);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getSettings).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<SettingsChangedEvent>(SETTINGS_CHANGED_DOM_EVENT, {
          detail: { scope: "workspace", workspace: "/notes/other" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getSettings).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent<SettingsChangedEvent>(SETTINGS_CHANGED_DOM_EVENT, {
          detail: { scope: "workspace", workspace: "/notes/current" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getSettings).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });
});
