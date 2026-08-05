import { describe, expect, it } from "vitest";
import {
  consumePendingRecoveryNotices,
  recordPendingRecoveryNotice,
} from "./recoveryNotice";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("recovery notices", () => {
  it("persists recovery locations until the next app startup consumes them", () => {
    const storage = createStorage();

    recordPendingRecoveryNotice(
      "/recovery/Plan.md",
      new Error("revision conflict"),
      storage,
    );

    const notices = consumePendingRecoveryNotices(storage);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.recoveredTo).toBe("/recovery/Plan.md");
    expect(notices[0]?.saveError).toContain("revision conflict");
    expect(consumePendingRecoveryNotices(storage)).toEqual([]);
  });

  it("drops malformed stored notices without throwing", () => {
    const storage = createStorage();
    storage.setItem("scratch:pendingRecoveryNotices", "not-json");

    expect(consumePendingRecoveryNotices(storage)).toEqual([]);
  });
});
