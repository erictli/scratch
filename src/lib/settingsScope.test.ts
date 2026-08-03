import { describe, expect, it } from "vitest";
import { shouldApplySettingsChange } from "./settingsScope";

describe("shouldApplySettingsChange", () => {
  it("applies global settings to every workspace window", () => {
    expect(
      shouldApplySettingsChange(
        { scope: "global", workspace: null },
        "/notes/client-a",
      ),
    ).toBe(true);
    expect(
      shouldApplySettingsChange(
        { scope: "global", workspace: null },
        "/notes/client-b",
      ),
    ).toBe(true);
  });

  it("applies workspace settings only to windows bound to that workspace", () => {
    const event = { scope: "workspace" as const, workspace: "/notes/client-a" };

    expect(shouldApplySettingsChange(event, "/notes/client-a")).toBe(true);
    expect(shouldApplySettingsChange(event, "/notes/client-b")).toBe(false);
  });

  it("does not leak a workspace event into a standalone window", () => {
    expect(
      shouldApplySettingsChange(
        { scope: "workspace", workspace: "/notes/client-a" },
        null,
      ),
    ).toBe(false);
  });
});
