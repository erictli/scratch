import { describe, expect, it, vi } from "vitest";
import { flushPendingEditorSaves } from "./pendingEditorSaves";

describe("flushPendingEditorSaves", () => {
  it("flushes both dirty drafts with formatted content last", async () => {
    const order: string[] = [];
    const flushSource = vi.fn(async () => {
      order.push("source");
    });
    const flushFormatted = vi.fn(async () => {
      order.push("formatted");
    });

    await flushPendingEditorSaves({
      flushSource,
      flushFormatted,
    });

    expect(order).toEqual(["source", "formatted"]);
  });
});
