import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../services/notes";
import { WorkspaceMenu } from "./WorkspaceMenu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

const workspaces: WorkspaceInfo[] = [
  {
    path: "/notes/main",
    name: "main",
    isDefault: true,
    isCurrent: true,
    isOpen: true,
  },
  {
    path: "/notes/client",
    name: "client",
    isDefault: false,
    isCurrent: false,
    isOpen: true,
  },
  {
    path: "/notes/archive",
    name: "archive",
    isDefault: false,
    isCurrent: false,
    isOpen: false,
  },
];

describe("WorkspaceMenu", () => {
  it("shows the current folder and switches space inside the same window", () => {
    const onSwitchWorkspace = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces}
          currentWorkspacePath="/notes/main"
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    expect(trigger?.textContent).toContain("main");
    expect(trigger?.textContent).not.toContain("Spaces");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="menu"]')).toBeNull();

    act(() => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    const current = container.querySelector<HTMLButtonElement>(
      'button[role="menuitemradio"][data-workspace-path="/notes/main"]',
    );
    expect(current?.getAttribute("aria-checked")).toBe("true");

    const client = container.querySelector<HTMLButtonElement>(
      'button[role="menuitemradio"][data-workspace-path="/notes/client"]',
    );
    act(() => client?.click());
    expect(onSwitchWorkspace).toHaveBeenCalledWith("/notes/client");

    act(() => root.unmount());
  });

  it("opens a per-folder actions dropdown before removing a remembered folder", () => {
    const onAddWorkspace = vi.fn();
    const onRemoveWorkspace = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces}
          currentWorkspacePath="/notes/main"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
        />,
      );
    });

    expect(
      container.querySelector('button[aria-label="Open Folder in New Window"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Add Folder"]'),
    ).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    act(() => trigger?.click());

    const addFolder = container.querySelector<HTMLButtonElement>(
      'button[role="menuitem"][aria-label="Add Folder"]',
    );
    const archiveActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for archive"]',
    );
    expect(addFolder).not.toBeNull();
    expect(archiveActions).not.toBeNull();
    expect(archiveActions?.getAttribute("aria-haspopup")).toBe("menu");
    expect(archiveActions?.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector(
        'button[role="menuitem"][aria-label="Remove archive from List"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'button[role="menuitem"][aria-label="Open Folder in New Window"]',
      ),
    ).toBeNull();

    act(() => archiveActions?.click());
    expect(onRemoveWorkspace).not.toHaveBeenCalled();
    expect(archiveActions?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[role="menu"][aria-label="Actions for archive"]'),
    ).not.toBeNull();

    const removeArchive = container.querySelector<HTMLButtonElement>(
      'button[role="menuitem"][aria-label="Remove archive from List"]',
    );
    expect(document.activeElement).toBe(removeArchive);
    act(() => removeArchive?.click());
    expect(onRemoveWorkspace).toHaveBeenCalledWith("/notes/archive");
    expect(
      container.querySelector('[role="menu"][aria-label="Actions for archive"]'),
    ).toBeNull();
    expect(container.querySelector('[role="menu"][aria-label="Workspaces"]')).not.toBeNull();

    act(() => addFolder?.click());
    expect(onAddWorkspace).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();

    act(() => root.unmount());
  });

  it("uses menu focus and arrow-key navigation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces}
          currentWorkspacePath="/notes/main"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    act(() => trigger?.click());

    const currentWorkspace = container.querySelector<HTMLButtonElement>(
      'button[role="menuitemradio"][data-workspace-path="/notes/main"]',
    );
    const currentActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for main"]',
    );
    const addFolder = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Folder"]',
    );
    expect(document.activeElement).toBe(currentWorkspace);

    act(() => {
      currentWorkspace?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(currentActions);

    act(() => {
      currentActions?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(addFolder);

    act(() => {
      addFolder?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(currentWorkspace);

    act(() => {
      currentWorkspace?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(addFolder);

    act(() => root.unmount());
  });

  it("closes the nested folder actions menu before the workspace switcher", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces}
          currentWorkspacePath="/notes/main"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const workspaceTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    act(() => workspaceTrigger?.click());
    const archiveActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for archive"]',
    );
    act(() => archiveActions?.click());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(
      container.querySelector('[role="menu"][aria-label="Actions for archive"]'),
    ).toBeNull();
    expect(container.querySelector('[role="menu"][aria-label="Workspaces"]')).not.toBeNull();
    expect(document.activeElement).toBe(archiveActions);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="menu"][aria-label="Workspaces"]')).toBeNull();
    expect(document.activeElement).toBe(workspaceTrigger);

    act(() => root.unmount());
  });

  it("closes the workspace menu without removing the compact trigger", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces}
          currentWorkspacePath="/notes/main"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    act(() => trigger?.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    act(() => trigger?.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger).not.toBeNull();

    act(() => root.unmount());
  });

  it("keeps the active folder label while the remembered list is empty", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={[]}
          currentWorkspacePath="/notes/Professional"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    expect(trigger?.textContent).toContain("Professional");
    act(() => trigger?.click());
    expect(container.textContent).toContain("No folders in list");

    act(() => root.unmount());
  });

  it("does not replace a forgotten active folder label with another remembered folder", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <WorkspaceMenu
          workspaces={workspaces.map((workspace) => ({
            ...workspace,
            isCurrent: false,
          }))}
          currentWorkspacePath="/notes/Professional"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch workspace"]',
    );
    expect(trigger?.textContent).toContain("Professional");
    expect(trigger?.textContent).not.toContain("main");

    act(() => root.unmount());
  });
});
