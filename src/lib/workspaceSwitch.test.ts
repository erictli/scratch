import { describe, expect, it, vi } from "vitest";
import { runWorkspaceSwitch } from "./workspaceSwitch";

describe("runWorkspaceSwitch", () => {
  it("flushes the current draft before rebinding and loading the next workspace", async () => {
    const order: string[] = [];

    const path = await runWorkspaceSwitch("/notes/client", {
      flushCurrentDraft: vi.fn(async () => {
        order.push("flush");
      }),
      switchBackendWorkspace: vi.fn(async () => {
        order.push("switch");
        return "/notes/client";
      }),
      loadWorkspace: vi.fn(async () => {
        order.push("load");
      }),
    });

    expect(path).toBe("/notes/client");
    expect(order).toEqual(["flush", "switch", "load"]);
  });

  it("does not switch when the current draft cannot be persisted", async () => {
    const switchBackendWorkspace = vi.fn();
    const loadWorkspace = vi.fn();

    await expect(
      runWorkspaceSwitch("/notes/client", {
        flushCurrentDraft: vi.fn(async () => {
          throw new Error("disk unavailable");
        }),
        switchBackendWorkspace,
        loadWorkspace,
      }),
    ).rejects.toThrow("disk unavailable");

    expect(switchBackendWorkspace).not.toHaveBeenCalled();
    expect(loadWorkspace).not.toHaveBeenCalled();
  });

  it("does not clear the current workspace when the backend rebind fails", async () => {
    const loadWorkspace = vi.fn();

    await expect(
      runWorkspaceSwitch("/notes/client", {
        flushCurrentDraft: vi.fn(async () => undefined),
        switchBackendWorkspace: vi.fn(async () => {
          throw new Error("workspace unavailable");
        }),
        loadWorkspace,
      }),
    ).rejects.toThrow("workspace unavailable");

    expect(loadWorkspace).not.toHaveBeenCalled();
  });
});
