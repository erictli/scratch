import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  EditorWidthHandles,
  getRenderedEditorWidth,
} from "./EditorWidthHandle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorWidthHandles", () => {
  it("measures the rendered page instead of its unconstrained max-width", () => {
    const container = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.style.maxWidth = "576px";
    editor.getBoundingClientRect = () => ({
      x: 37,
      y: 0,
      left: 37,
      top: 0,
      right: 563,
      bottom: 800,
      width: 526,
      height: 800,
      toJSON: () => ({}),
    });
    Object.defineProperty(container, "clientWidth", { value: 600 });
    container.append(editor);

    expect(getRenderedEditorWidth(container)).toBe(526);
  });

  it("mounts no resize interaction when mouse resizing is disabled", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <EditorWidthHandles
          enabled={false}
          containerRef={createRef<HTMLDivElement>()}
        />,
      );
    });

    expect(container.childElementCount).toBe(0);

    act(() => root.unmount());
    container.remove();
  });
});
