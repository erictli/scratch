import { describe, expect, it } from "vitest";
import {
  createTableRowResizePreview,
  getTableRowResizeHeight,
} from "./tableRowResize";

describe("table row resize", () => {
  const getPreviewRule = (): CSSStyleRule => {
    const previewStyle = document.querySelector<HTMLStyleElement>(
      "[data-scratch-table-row-resize-preview]",
    );
    const rule = previewStyle?.sheet?.cssRules[0];
    if (!(rule instanceof CSSStyleRule)) {
      throw new Error("Missing row preview style rule");
    }
    return rule;
  };

  it("tracks the pointer delta from the starting height", () => {
    expect(getTableRowResizeHeight(44, 100, 140)).toBe(84);
    expect(getTableRowResizeHeight(44, 100, 100.6)).toBe(45);
  });

  it("clamps the preview to the supported row-height range", () => {
    expect(getTableRowResizeHeight(44, 100, -1000)).toBe(28);
    expect(getTableRowResizeHeight(44, 100, 1000)).toBe(480);
  });

  it("previews repeated heights in the DOM and restores the exact row style", () => {
    const table = document.createElement("table");
    const row = document.createElement("tr");
    table.append(row);
    document.body.append(table);
    row.setAttribute("style", "background: red; min-height: 31px");
    const originalStyle = row.getAttribute("style");
    const preview = createTableRowResizePreview(row);

    expect(preview.apply(72)).toBe(72);
    expect(getPreviewRule().style.height).toBe("72px");
    expect(document.querySelector(getPreviewRule().selectorText)).toBe(row);
    expect(row.getAttribute("style")).toBe(originalStyle);
    expect(preview.apply(94.4)).toBe(94);
    expect(getPreviewRule().style.height).toBe("94px");
    expect(row.style.background).toBe("red");

    preview.restore();
    expect(row.getAttribute("style")).toBe(originalStyle);
    expect(
      document.querySelector("[data-scratch-table-row-resize-preview]"),
    ).toBeNull();
    table.remove();
  });

  it("clamps DOM previews and restores a missing style attribute exactly", () => {
    const table = document.createElement("table");
    const row = document.createElement("tr");
    table.append(row);
    document.body.append(table);
    const preview = createTableRowResizePreview(row);

    expect(preview.apply(-1000)).toBe(28);
    expect(getPreviewRule().style.height).toBe("28px");
    expect(preview.apply(1000)).toBe(480);
    expect(getPreviewRule().style.height).toBe("480px");

    preview.restore();
    expect(row.hasAttribute("style")).toBe(false);
    table.remove();
  });
});
