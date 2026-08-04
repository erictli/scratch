import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("global shortcut call sites", () => {
  it("shares one shortcut hook between full and standalone editors", () => {
    expect(readSource("src/App.tsx")).toContain("useWindowShortcuts");
    expect(readSource("src/components/preview/PreviewApp.tsx")).toContain(
      "useWindowShortcuts",
    );
  });

  it("recognizes a dedicated preferences window mode", () => {
    const source = readSource("src/App.tsx");
    expect(source).toContain('mode === "preferences"');
    expect(source).toContain("<PreferencesApp");
  });

  it("keeps Back only for in-window Settings navigation", () => {
    const source = readSource("src/App.tsx");
    const preferencesStart = source.indexOf("function PreferencesApp()");
    expect(preferencesStart).toBeGreaterThanOrEqual(0);
    const preferencesEnd = source.indexOf("function App()", preferencesStart);
    expect(preferencesEnd).toBeGreaterThan(preferencesStart);
    const preferencesSource = source.slice(preferencesStart, preferencesEnd);

    expect(source).toContain("<SettingsPage onBack={closeSettings} />");
    expect(preferencesSource).toContain("<SettingsPage />");
    expect(preferencesSource).not.toContain("onBack=");
  });
});
