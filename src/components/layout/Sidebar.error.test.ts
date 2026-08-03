import { describe, expect, it } from "vitest";
import { getWorkspaceSwitchErrorMessage } from "./Sidebar";

describe("getWorkspaceSwitchErrorMessage", () => {
  it("includes the underlying workspace switch failure", () => {
    expect(
      getWorkspaceSwitchErrorMessage(new Error("Folder permission denied")),
    ).toBe("Could not switch folder: Folder permission denied");
  });

  it("uses a safe fallback when the failure has no usable message", () => {
    expect(getWorkspaceSwitchErrorMessage({ code: "UNKNOWN" })).toBe(
      "Could not switch folder",
    );
  });
});
