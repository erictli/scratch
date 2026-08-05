import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui";

vi.mock("../../lib/platform", () => ({
  isWindows: true,
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

describe("SettingsPage Windows context", () => {
  it("renders no drag regions on Windows", () => {
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

    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(
      0,
    );

    act(() => root.unmount());
  });
});
