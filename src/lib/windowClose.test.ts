import { describe, expect, it, vi } from "vitest";
import {
  beginSafeWindowClose,
  resolveCloseListenerRegistration,
  runSafeWindowClose,
} from "./windowClose";

describe("beginSafeWindowClose", () => {
  it("prevents every close request while starting the workflow only once", () => {
    const inProgress = { current: false };
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };

    expect(beginSafeWindowClose(first, inProgress)).toBe(true);
    expect(beginSafeWindowClose(repeated, inProgress)).toBe(false);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(repeated.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("resolveCloseListenerRegistration", () => {
  it("reports a registration failure and returns a safe cleanup", async () => {
    const error = new Error("listener unavailable");
    const onError = vi.fn();

    const cleanup = await resolveCloseListenerRegistration(
      Promise.reject(error),
      onError,
    );

    expect(onError).toHaveBeenCalledWith(error);
    expect(() => cleanup()).not.toThrow();
  });
});

describe("runSafeWindowClose", () => {
  it("requests a native close only after the pending draft is durably flushed", async () => {
    const order: string[] = [];

    await runSafeWindowClose({
      flushDraft: async () => {
        order.push("flush");
      },
      persistRecovery: async () => {
        order.push("recovery");
        return { status: "not-needed" };
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
        return { status: "recovered", path: "/recovery/Plan.md" };
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

  it("closes after a flush failure when there is no dirty draft to recover", async () => {
    const closeWindow = vi.fn(async () => undefined);

    const result = await runSafeWindowClose({
      flushDraft: async () => {
        throw new Error("storage offline");
      },
      persistRecovery: async () => ({ status: "not-needed" }),
      closeWindow,
    });

    expect(result.saveError).toEqual(expect.any(Error));
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("retains both save and recovery errors when recovery persistence fails", async () => {
    const saveError = new Error("revision conflict");
    const recoveryError = new Error("recovery disk full");
    const closeWindow = vi.fn(async () => undefined);

    await expect(
      runSafeWindowClose({
        flushDraft: async () => {
          throw saveError;
        },
        persistRecovery: async () => {
          throw recoveryError;
        },
        closeWindow,
      }),
    ).rejects.toMatchObject({
      cause: { saveError, recoveryError },
    });

    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("records the recovery result before destroying the window", async () => {
    const order: string[] = [];

    await runSafeWindowClose({
      flushDraft: async () => {
        throw new Error("revision conflict");
      },
      persistRecovery: async () => ({
        status: "recovered",
        path: "/recovery/Plan.md",
      }),
      beforeClose: async () => {
        order.push("notice");
      },
      closeWindow: async () => {
        order.push("close");
      },
    });

    expect(order).toEqual(["notice", "close"]);
  });

  it("does not treat a native close failure as a save failure", async () => {
    const persistRecovery = vi.fn(async () => ({
      status: "recovered" as const,
      path: "/recovery/Plan.md",
    }));
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
