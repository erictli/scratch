import { describe, expect, it, vi } from "vitest";
import { runSafeWindowClose } from "./windowClose";

describe("runSafeWindowClose", () => {
  it("requests a native close only after the pending draft is durably flushed", async () => {
    const order: string[] = [];

    await runSafeWindowClose({
      flushDraft: async () => {
        order.push("flush");
      },
      persistRecovery: async () => {
        order.push("recovery");
        return undefined;
      },
      closeWindow: async () => {
        order.push("close");
      },
    });

    expect(order).toEqual(["flush", "close"]);
  });

  it("persists recovery before closing when normal save conflicts", async () => {
    const order: string[] = [];

    const result = await runSafeWindowClose({
      flushDraft: async () => {
        order.push("flush");
        throw new Error("revision conflict");
      },
      persistRecovery: async () => {
        order.push("recovery");
        return "/recovery/Plan.md";
      },
      closeWindow: async () => {
        order.push("close");
      },
    });

    expect(order).toEqual(["flush", "recovery", "close"]);
    expect(result).toEqual({
      recoveredTo: "/recovery/Plan.md",
      saveError: expect.any(Error),
    });
  });

  it("keeps the window open when both save and recovery fail", async () => {
    const closeWindow = vi.fn(async () => undefined);

    await expect(
      runSafeWindowClose({
        flushDraft: async () => {
          throw new Error("storage offline");
        },
        persistRecovery: async () => {
          throw new Error("recovery storage offline");
        },
        closeWindow,
      }),
    ).rejects.toThrow("recovery storage offline");

    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("does not treat a native close failure as a save failure", async () => {
    const persistRecovery = vi.fn(async () => "/recovery/Plan.md");
    const closeWindow = vi.fn(async () => {
      throw new Error("native close failed");
    });

    await expect(
      runSafeWindowClose({
        flushDraft: async () => undefined,
        persistRecovery,
        closeWindow,
      }),
    ).rejects.toThrow("native close failed");

    expect(persistRecovery).not.toHaveBeenCalled();
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
