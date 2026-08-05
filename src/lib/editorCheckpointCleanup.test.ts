import { describe, expect, it, vi } from "vitest";
import { persistCheckpointBeforeEditorDisposal } from "./editorCheckpointCleanup";

describe("persistCheckpointBeforeEditorDisposal", () => {
  it("persists a dirty debounce snapshot before disposing the scheduler", async () => {
    const order: string[] = [];
    const persist = vi.fn(async () => {
      order.push("persist");
    });
    const dispose = vi.fn(async () => {
      order.push("dispose");
    });

    persistCheckpointBeforeEditorDisposal(persist, dispose, vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["persist", "dispose"]);
  });

  it("still disposes after a checkpoint persistence failure", async () => {
    const error = new Error("checkpoint unavailable");
    const onError = vi.fn();
    const dispose = vi.fn(async () => undefined);

    persistCheckpointBeforeEditorDisposal(
      async () => Promise.reject(error),
      dispose,
      onError,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith("persist", error);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
