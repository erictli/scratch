import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SidebarFolderSection,
  loadFolderSectionCollapsed,
  saveFolderSectionCollapsed,
} from "./SidebarFolderSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("folder section persistence", () => {
  it("loads only an explicitly collapsed section and saves the next state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadFolderSectionCollapsed(storage)).toBe(false);
    values.set("scratch:foldersSectionCollapsed", "true");
    expect(loadFolderSectionCollapsed(storage)).toBe(true);

    saveFolderSectionCollapsed(false, storage);
    expect(values.get("scratch:foldersSectionCollapsed")).toBe("false");
  });
});

describe("SidebarFolderSection", () => {
  it("uses one disclosure control to hide and reveal the complete folder group", () => {
    const onCollapsedChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SidebarFolderSection
          collapsed={false}
          onCollapsedChange={onCollapsedChange}
        >
          <div data-testid="folder-group">Folder tree</div>
        </SidebarFolderSection>,
      );
    });

    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse Folders"]',
    );
    expect(collapseButton?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Folders");
    expect(container.querySelector('[data-testid="folder-group"]')).not.toBeNull();

    act(() => collapseButton?.click());
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    act(() => {
      root.render(
        <SidebarFolderSection
          collapsed
          onCollapsedChange={onCollapsedChange}
        >
          <div data-testid="folder-group">Folder tree</div>
        </SidebarFolderSection>,
      );
    });

    const expandButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand Folders"]',
    );
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="folder-group"]')).toBeNull();

    act(() => expandButton?.click());
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

    act(() => root.unmount());
  });
});
