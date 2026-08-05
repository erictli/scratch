import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui";

vi.mock("../../lib/platform", () => ({
  isWindows: false,
  isMac: false,
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  shortcut: (...parts: string[]) => parts.join("+"),
}));

vi.mock("./GeneralSettingsSection", () => ({
  GeneralSettingsSection: () => <div>General settings</div>,
}));
vi.mock("./EditorSettingsSection", () => ({
  AppearanceSettingsSection: () => <div>Appearance settings</div>,
}));
vi.mock("./ShortcutsSettingsSection", () => ({
  ShortcutsSettingsSection: () => <div>Shortcut settings</div>,
}));
vi.mock("./AboutSettingsSection", () => ({
  AboutSettingsSection: () => <div>About settings</div>,
}));
vi.mock("./ToolsSettingsSection", () => ({
  ToolsSettingsSection: () => <div>Tool settings</div>,
}));

import { SettingsPage } from "./SettingsPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("SettingsPage navigation context", () => {
  it("shows Back when Settings replace the main editor", () => {
    const onBack = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <TooltipProvider>
          <SettingsPage onBack={onBack} />
        </TooltipProvider>,
      ),
    );

    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Back"]',
    );
    expect(backButton).not.toBeNull();
    act(() => backButton?.click());
    expect(onBack).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("hides Back when Settings are the root of a dedicated window", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <TooltipProvider>
          <SettingsPage onBack={undefined} />
        </TooltipProvider>,
      ),
    );

    expect(container.textContent).toContain("Settings");
    expect(container.querySelector('button[aria-label^="Back"]')).toBeNull();
    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(
      2,
    );

    act(() => root.unmount());
  });
});
