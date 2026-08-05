import { describe, expect, it, vi } from "vitest";
import { runConflictResolution } from "./conflictResolution";

const draft = { content: "# Plan\n\nLocal", dirty: true };
const remote = { content: "# Plan\n\nRemote", revision: "remote-2" };

describe("runConflictResolution", () => {
  it("checkpoints the local draft before explicitly keeping it", async () => {
    const order: string[] = [];

    await runConflictResolution("keepLocal", { draft, remote }, {
      persistRecovery: async () => {
        order.push("recovery");
        return "/recovery/Plan.md";
      },
      overwriteRemote: async () => {
        order.push("overwrite");
      },
      recreateDeleted: async () => {
        order.push("recreate");
      },
      acceptRemote: async () => {
        order.push("accept");
      },
    });

    expect(order).toEqual(["recovery", "overwrite"]);
  });

  it("checkpoints the draft before accepting the disk version", async () => {
    const order: string[] = [];

    await runConflictResolution("useRemote", { draft, remote }, {
      persistRecovery: async () => {
        order.push("recovery");
        return "/recovery/Plan.md";
      },
      overwriteRemote: async () => undefined,
      recreateDeleted: async () => undefined,
      acceptRemote: async () => {
        order.push("accept");
      },
    });

    expect(order).toEqual(["recovery", "accept"]);
  });

  it("recreates a deleted note only after recovery", async () => {
    const recreateDeleted = vi.fn(async () => undefined);

    await runConflictResolution("keepLocal", { draft, remote: null }, {
      persistRecovery: async () => "/recovery/Plan.md",
      overwriteRemote: async () => undefined,
      recreateDeleted,
      acceptRemote: async () => undefined,
    });

    expect(recreateDeleted).toHaveBeenCalledWith(draft);
  });

  it("aborts resolution when a dirty draft cannot be recovered", async () => {
    const overwriteRemote = vi.fn(async () => undefined);

    await expect(
      runConflictResolution("keepLocal", { draft, remote }, {
        persistRecovery: async () => undefined,
        overwriteRemote,
        recreateDeleted: async () => undefined,
        acceptRemote: async () => undefined,
      }),
    ).rejects.toThrow("Recovery snapshot was not created");

    expect(overwriteRemote).not.toHaveBeenCalled();
  });
});
