import { describe, expect, it, vi } from "vitest";
import { flushWindowSessionBestEffort } from "./useWindowSessionPersistence";

describe("flushWindowSessionBestEffort", () => {
  it("flushes pending session fields when geometry capture fails", async () => {
    const order: string[] = [];
    const warn = vi.fn();

    await expect(
      flushWindowSessionBestEffort(
        async () => {
          order.push("capture");
          throw new Error("geometry unavailable");
        },
        async () => {
          order.push("flush");
        },
        warn,
      ),
    ).resolves.toBeUndefined();

    expect(order).toEqual(["capture", "flush"]);
    expect(warn).toHaveBeenCalledWith(
      "Window geometry capture failed",
      expect.any(Error),
    );
  });

  it("contains final writer failures so safe close can continue", async () => {
    const warn = vi.fn();

    await expect(
      flushWindowSessionBestEffort(
        async () => undefined,
        async () => {
          throw new Error("session write failed");
        },
        warn,
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "Final window session update failed",
      expect.any(Error),
    );
  });

  it("captures geometry before a successful final flush", async () => {
    const order: string[] = [];
    const warn = vi.fn();

    await flushWindowSessionBestEffort(
      async () => {
        order.push("capture");
      },
      async () => {
        order.push("flush");
      },
      warn,
    );

    expect(order).toEqual(["capture", "flush"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
