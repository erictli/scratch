import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  EditorToolbarVisibilityControl,
  EditorWidthResizeControl,
  TitleBarNoteInfoControls,
} from "./EditorSettingsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("EditorWidthResizeControl", () => {
  it("exposes the current state and lets the user disable mouse resizing", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <EditorWidthResizeControl enabled={true} onChange={onChange} />,
      );
    });

    const group = container.querySelector(
      '[role="group"][aria-label="Resize editor with mouse"]',
    );
    const [offButton, onButton] = Array.from(
      container.querySelectorAll("button"),
    );

    expect(group).not.toBeNull();
    expect(offButton.textContent).toBe("Off");
    expect(offButton.getAttribute("aria-pressed")).toBe("false");
    expect(onButton.textContent).toBe("On");
    expect(onButton.getAttribute("aria-pressed")).toBe("true");

    act(() => offButton.click());
    expect(onChange).toHaveBeenCalledWith(false);

    act(() => root.unmount());
    container.remove();
  });
});

describe("EditorToolbarVisibilityControl", () => {
  it("exposes the hidden default and lets the user show the toolbar", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <EditorToolbarVisibilityControl visible={false} onChange={onChange} />,
      );
    });

    const group = container.querySelector(
      '[role="group"][aria-label="Show formatting toolbar"]',
    );
    const [offButton, onButton] = Array.from(
      container.querySelectorAll("button"),
    );

    expect(group).not.toBeNull();
    expect(offButton.textContent).toBe("Off");
    expect(offButton.getAttribute("aria-pressed")).toBe("true");
    expect(onButton.textContent).toBe("On");
    expect(onButton.getAttribute("aria-pressed")).toBe("false");

    act(() => onButton.click());
    expect(onChange).toHaveBeenCalledWith(true);

    act(() => root.unmount());
    container.remove();
  });
});

describe("TitleBarNoteInfoControls", () => {
  it("offers one exclusive title-bar information menu", () => {
    const onModifiedDateChange = vi.fn();
    const onFilenameChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <TitleBarNoteInfoControls
          modifiedDateVisible={true}
          filenameVisible={false}
          onModifiedDateChange={onModifiedDateChange}
          onFilenameChange={onFilenameChange}
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Title bar information"]',
    );
    expect(select).not.toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(Array.from(select?.options ?? []).map((option) => option.text)).toEqual(
      ["Modification Date", "Filename", "None"],
    );
    expect(select?.value).toBe("modifiedDate");
    expect(container.textContent).not.toContain("On");
    expect(container.textContent).not.toContain("Off");

    act(() => {
      if (!select) return;
      select.value = "filename";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onFilenameChange).toHaveBeenCalledWith(true);
    expect(onModifiedDateChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("maps None to the single active persisted setting", () => {
    const onModifiedDateChange = vi.fn();
    const onFilenameChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <TitleBarNoteInfoControls
          modifiedDateVisible={false}
          filenameVisible={true}
          onModifiedDateChange={onModifiedDateChange}
          onFilenameChange={onFilenameChange}
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Title bar information"]',
    );
    expect(select?.value).toBe("filename");

    act(() => {
      if (!select) return;
      select.value = "none";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onFilenameChange).toHaveBeenCalledWith(false);
    expect(onModifiedDateChange).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
