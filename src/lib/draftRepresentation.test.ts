import { describe, expect, it, vi } from "vitest";
import {
  choosePendingDraftRepresentation,
  flushPendingDraftRepresentation,
} from "./draftRepresentation";

describe("choosePendingDraftRepresentation", () => {
  it("uses source when both representations are dirty in source mode", () => {
    expect(choosePendingDraftRepresentation(true, true, true)).toBe("source");
  });

  it("uses formatted content when both are dirty after leaving source mode", () => {
    expect(choosePendingDraftRepresentation(false, true, true)).toBe(
      "formatted",
    );
  });

  it("falls back to the only dirty representation", () => {
    expect(choosePendingDraftRepresentation(false, true, false)).toBe(
      "source",
    );
    expect(choosePendingDraftRepresentation(true, false, true)).toBe(
      "formatted",
    );
  });

  it("flushes source and discards stale formatted work in source mode", async () => {
    const actions = {
      discardSource: vi.fn(),
      discardFormatted: vi.fn(),
      flushSource: vi.fn(async () => undefined),
      flushFormatted: vi.fn(async () => undefined),
    };

    await expect(
      flushPendingDraftRepresentation(true, true, true, actions),
    ).resolves.toBe("source");
    expect(actions.discardFormatted).toHaveBeenCalledOnce();
    expect(actions.flushSource).toHaveBeenCalledOnce();
    expect(actions.flushFormatted).not.toHaveBeenCalled();
  });

  it("flushes formatted and discards stale source work after source mode", async () => {
    const actions = {
      discardSource: vi.fn(),
      discardFormatted: vi.fn(),
      flushSource: vi.fn(async () => undefined),
      flushFormatted: vi.fn(async () => undefined),
    };

    await expect(
      flushPendingDraftRepresentation(false, true, true, actions),
    ).resolves.toBe("formatted");
    expect(actions.discardSource).toHaveBeenCalledOnce();
    expect(actions.flushFormatted).toHaveBeenCalledOnce();
    expect(actions.flushSource).not.toHaveBeenCalled();
  });
});
