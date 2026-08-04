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
      expect(source).not.toMatch(/(?<!\))\.\s*(close|destroy)\s*\(\s*\)/);
    },
  );
});
