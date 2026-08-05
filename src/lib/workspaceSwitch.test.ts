import { describe, expect, it, vi } from "vitest";
import { runWorkspaceSwitch } from "./workspaceSwitch";
import { createSerializedTaskQueue } from "./serializedWriter";

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

  it("loads the backend-confirmed workspace path instead of the requested path", async () => {
    const loadWorkspace = vi.fn(async () => undefined);

    await expect(
      runWorkspaceSwitch("/notes/requested", {
        flushCurrentDraft: vi.fn(async () => undefined),
        switchBackendWorkspace: vi.fn(async () => "/notes/canonical"),
        loadWorkspace,
      }),
    ).resolves.toBe("/notes/canonical");

    expect(loadWorkspace).toHaveBeenCalledWith("/notes/canonical");
  });

  it("serializes two rapid CLI workspace synchronizations", async () => {
    const queue = createSerializedTaskQueue();
    let releaseFirstLoad!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve;
    });
    const loaded: string[] = [];

    const sync = (path: string) =>
      queue(() =>
        runWorkspaceSwitch(path, {
          flushCurrentDraft: vi.fn(async () => undefined),
          switchBackendWorkspace: vi.fn(async () => path),
          loadWorkspace: vi.fn(async (activePath) => {
            if (activePath === "/notes/a") await firstLoad;
            loaded.push(activePath);
          }),
        }),
      );

    const first = sync("/notes/a");
    const second = sync("/notes/b");

    await Promise.resolve();
    expect(loaded).toEqual([]);
    releaseFirstLoad();
    await Promise.all([first, second]);

    expect(loaded).toEqual(["/notes/a", "/notes/b"]);
  });
});
