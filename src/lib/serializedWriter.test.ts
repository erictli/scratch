import { describe, expect, it, vi } from "vitest";
import {
  createSerializedTaskQueue,
  createSerializedUpdater,
  createSerializedWriter,
} from "./serializedWriter";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createSerializedWriter", () => {
  it("finishes writes in request order even when the first write is delayed", async () => {
    const firstWriteGate = deferred();
    const started: string[] = [];
    const finished: string[] = [];
    const write = vi.fn(async (value: string) => {
      started.push(value);
      if (value === "first") await firstWriteGate.promise;
      finished.push(value);
    });
    const serializedWrite = createSerializedWriter(write);

    const first = serializedWrite("first");
    const second = serializedWrite("second");
    await Promise.resolve();

    expect(started).toEqual(["first"]);
    expect(finished).toEqual([]);

    firstWriteGate.resolve();
    await Promise.all([first, second]);

    expect(started).toEqual(["first", "second"]);
    expect(finished).toEqual(["first", "second"]);
  });

  it("continues after a failed write", async () => {
    const finished: string[] = [];
    const onError = vi.fn();
    const serializedWrite = createSerializedWriter(async (value: string) => {
      if (value === "first") throw new Error("write failed");
      finished.push(value);
    }, onError);

    await serializedWrite("first");
    await serializedWrite("second");

    expect(onError).toHaveBeenCalledOnce();
    expect(finished).toEqual(["second"]);
  });
});

describe("createSerializedUpdater", () => {
  it("applies a reset after an already queued setting change", async () => {
    const firstWriteGate = deferred();
    let writeCount = 0;
    let stored = { mode: "date", font: "custom" };
    const updateSettings = createSerializedUpdater(
      async () => stored,
      async (next) => {
        writeCount += 1;
        if (writeCount === 1) await firstWriteGate.promise;
        stored = next;
      },
    );

    const change = updateSettings((current) => ({
      ...current,
      mode: "filename",
    }));
    const reset = updateSettings(() => ({ mode: "date", font: "default" }));
    await Promise.resolve();

    firstWriteGate.resolve();
    await Promise.all([change, reset]);

    expect(stored).toEqual({ mode: "date", font: "default" });
  });
});

describe("createSerializedTaskQueue", () => {
  it("returns each task result while preventing overlapping saves", async () => {
    const firstWriteGate = deferred();
    const started: string[] = [];
    const enqueue = createSerializedTaskQueue();

    const first = enqueue(async () => {
      started.push("first");
      await firstWriteGate.promise;
      return "revision-2";
    });
    const second = enqueue(async () => {
      started.push("second");
      return "revision-3";
    });
    await Promise.resolve();

    expect(started).toEqual(["first"]);
    firstWriteGate.resolve();

    await expect(first).resolves.toBe("revision-2");
    await expect(second).resolves.toBe("revision-3");
    expect(started).toEqual(["first", "second"]);
  });

  it("propagates one conflict and still lets a later recovery task run", async () => {
    const enqueue = createSerializedTaskQueue();
    const conflict = new Error("revision conflict");

    const first = enqueue(async () => {
      throw conflict;
    });
    const second = enqueue(async () => "recovered");

    await expect(first).rejects.toBe(conflict);
    await expect(second).resolves.toBe("recovered");
  });
});
