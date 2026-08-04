import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui";
import { SettingsPage } from "./SettingsPage";

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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

function mountSettingsPage(onBack?: () => void) {
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
  return { container, root };
}

describe("SettingsPage navigation context", () => {
  it("shows Back when Settings replace the main editor", () => {
    const onBack = vi.fn();
    const { container } = mountSettingsPage(onBack);

    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Back"]',
    );
    expect(backButton).not.toBeNull();
    act(() => backButton?.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("hides Back when Settings are the root of a dedicated window", () => {
    const { container } = mountSettingsPage(undefined);

    expect(container.textContent).toContain("Settings");
    expect(container.querySelector('button[aria-label^="Back"]')).toBeNull();
    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(
      2,
    );
  });
});

describe("SettingsPage drag regions on Windows", () => {
  it("omits drag regions when isWindows is true", async () => {
    const originalUA = globalThis.navigator?.userAgent;
    Object.defineProperty(globalThis.navigator || {}, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      configurable: true,
    });

    vi.resetModules();
    const { SettingsPage: WindowsSettingsPage } = await import("./SettingsPage");

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <TooltipProvider>
          <WindowsSettingsPage onBack={undefined} />
        </TooltipProvider>,
      ),
    );

    expect(container.querySelectorAll("[data-tauri-drag-region]")).toHaveLength(
      0,
    );
    act(() => root.unmount());

    if (originalUA !== undefined) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: originalUA,
        configurable: true,
      });
    }
  });
});
