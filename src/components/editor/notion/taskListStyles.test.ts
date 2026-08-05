import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("nested task list completion styles", () => {
  it("strikes only the checked item's own paragraph", () => {
    const css = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

    expect(css).toContain(
      'ul[data-type="taskList"] li[data-checked="true"] > div > p {',
    );
    expect(css).not.toContain(
      'ul[data-type="taskList"] li[data-checked="true"] > div {',
    );
  });
});
