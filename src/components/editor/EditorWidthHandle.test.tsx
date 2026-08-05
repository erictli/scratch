import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  EditorWidthHandles,
  getRenderedEditorWidth,
} from "./EditorWidthHandle";

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    editorWidth: "normal",
    customEditorWidthPx: 768,
    setEditorWidth: vi.fn(),
    setCustomEditorWidthPx: vi.fn(),
    setEditorMaxWidthLive: vi.fn(),
  }),
}));

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

  it("caps the measured width at the container width", () => {
    const container = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 700,
      bottom: 800,
      width: 700,
      height: 800,
      toJSON: () => ({}),
    });
    Object.defineProperty(container, "clientWidth", { value: 600 });
    container.append(editor);

    expect(getRenderedEditorWidth(container)).toBe(600);
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

  it("mounts both resize handles when mouse resizing is enabled", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const editorContainer = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.getBoundingClientRect = () => ({
      x: 216,
      y: 0,
      left: 216,
      top: 0,
      right: 984,
      bottom: 800,
      width: 768,
      height: 800,
      toJSON: () => ({}),
    });
    Object.defineProperty(editorContainer, "clientWidth", { value: 1200 });
    editorContainer.append(editor);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <EditorWidthHandles
          enabled
          containerRef={{ current: editorContainer }}
        />,
      );
    });

    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);
    expect(
      container.querySelector('[aria-label="Resize editor width (left)"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Resize editor width (right)"]'),
    ).not.toBeNull();

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
