import { describe, expect, it } from "vitest";
import { isGitSettingsEventForFolder } from "./settingsEvents";

describe("isGitSettingsEventForFolder", () => {
  it("accepts only events for the provider workspace", () => {
    const event = { notesFolder: "/notes/a", gitEnabled: true };

    expect(isGitSettingsEventForFolder(event, "/notes/a")).toBe(true);
    expect(isGitSettingsEventForFolder(event, "/notes/b")).toBe(false);
    expect(isGitSettingsEventForFolder(event, null)).toBe(false);
  });
});
