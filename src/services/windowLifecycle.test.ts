import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeWindowAfterSave } from "./windowLifecycle";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("closeWindowAfterSave", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("delegates the final close to the trusted Rust lifecycle command", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await closeWindowAfterSave();

    expect(invoke).toHaveBeenCalledWith("close_window_after_save");
  });
});
