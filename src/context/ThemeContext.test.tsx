import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateGlobalSettings: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("../services/notes", () => ({
  getSettings: mocks.getSettings,
  updateGlobalSettings: mocks.updateGlobalSettings,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  ThemeProvider,
  useThemeActions,
  useThemeData,
} from "./ThemeContext";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ThemeProvider context split", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue({
      theme: { mode: "system" },
    });
    mocks.updateGlobalSettings.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.listen.mockReset().mockResolvedValue(() => undefined);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  it("does not rerender an actions-only consumer when theme data changes", async () => {
    const renders = { data: 0, actions: 0 };

    function DataConsumer() {
      renders.data += 1;
      return <span data-theme>{useThemeData().theme}</span>;
    }

    function ActionsConsumer() {
      renders.actions += 1;
      const { setTheme } = useThemeActions();
      return <button onClick={() => setTheme("dark")}>Dark</button>;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ThemeProvider>
          <DataConsumer />
          <ActionsConsumer />
        </ThemeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const actionRendersAfterInitialization = renders.actions;
    const dataRendersAfterInitialization = renders.data;

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-theme]")?.textContent).toBe("dark");
    expect(renders.data).toBeGreaterThan(dataRendersAfterInitialization);
    expect(renders.actions).toBe(actionRendersAfterInitialization);
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });
});
