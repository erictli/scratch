import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

describe("nested task list completion styles", () => {
  it("strikes only the checked item's own paragraph", () => {
    expect(appCss).toMatch(
      /ul\[data-type="taskList"\] li\[data-checked="true"\] > div > p\s*\{[^}]*text-decoration:\s*line-through;[^}]*opacity:\s*0\.6;/s,
    );
    expect(appCss).not.toMatch(
      /ul\[data-type="taskList"\] li\[data-checked="true"\] > div\s*\{/,
    );
  });
});
