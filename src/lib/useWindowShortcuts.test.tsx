import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() });
  return { setInterfaceZoom: vi.fn(), toast };
});

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ setInterfaceZoom: mocks.setInterfaceZoom }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { useWindowShortcuts } from "./useWindowShortcuts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onOpen }: { onOpen: () => void | Promise<void> }) {
  useWindowShortcuts({ onOpenPreferences: onOpen });
  return null;
}

describe("useWindowShortcuts", () => {
  let root: Root;
  let zoom: number;

  beforeEach(() => {
    zoom = 1;
    mocks.toast.mockReset();
    mocks.toast.error.mockReset();
    mocks.setInterfaceZoom.mockReset().mockImplementation(
      (value: number | ((previous: number) => number)) => {
        zoom = typeof value === "function" ? value(zoom) : value;
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  const press = async (
    key: string,
    modifier: "meta" | "ctrl" = "meta",
  ) => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        metaKey: modifier === "meta",
        ctrlKey: modifier === "ctrl",
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
    });
  };

  it("uses the updated Preferences callback after rerender", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => root.render(<Harness onOpen={first} />));
    await act(async () => root.render(<Harness onOpen={second} />));

    await press(",");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("supports Cmd and Ctrl zoom shortcuts and reset", async () => {
    await act(async () => root.render(<Harness onOpen={vi.fn()} />));
    await press("+", "ctrl");
    expect(zoom).toBe(1.05);
    await press("-", "meta");
    expect(zoom).toBe(1);
    await press("0", "ctrl");
    expect(zoom).toBe(1);
  });

  it("reports a rejected Preferences launch", async () => {
    const error = new Error("window unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () =>
      root.render(<Harness onOpen={() => Promise.reject(error)} />),
    );

    await press(",");

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to open Preferences:",
      error,
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Preferences could not be opened.",
    );
    consoleError.mockRestore();
  });

  it("clamps repeated zoom commands to the supported limits", async () => {
    await act(async () => root.render(<Harness onOpen={vi.fn()} />));
    for (let index = 0; index < 20; index += 1) await press("+");
    expect(zoom).toBe(1.5);
    for (let index = 0; index < 30; index += 1) await press("-");
    expect(zoom).toBe(0.7);
  });
});
