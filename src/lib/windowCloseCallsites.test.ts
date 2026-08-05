import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const closeHandlers = [
  resolve(process.cwd(), "src/App.tsx"),
  resolve(process.cwd(), "src/components/preview/PreviewApp.tsx"),
];

describe("safe window close call sites", () => {
  it.each(closeHandlers)(
    "uses the interceptable close command instead of force-destroying %s",
    (sourcePath) => {
      const source = readFileSync(sourcePath, "utf8");

      expect(source).toContain("closeWindowAfterSave");
      expect(source).not.toContain("appWindow.close()");
      expect(source).not.toContain("appWindow.destroy()");
      const baseName = sourcePath.split(/[/\\]/).pop() || "";
      if (baseName === "App.tsx") {
        expect(source).toContain("requestCurrentWindowClose");
        expect(source).not.toContain("getCurrentWindow().close()");
      }
    },
  );

  it("uses requestCurrentWindowClose for Cmd/Ctrl+W in App.tsx", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/App.tsx"),
      "utf8",
    );

    expect(source).toContain("requestCurrentWindowClose");
  });
});
