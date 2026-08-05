import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowShortcuts } from "./useWindowShortcuts";

const themeMock = vi.hoisted(() => ({
  zoom: 1,
  setInterfaceZoom: vi.fn(),
}));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn() }),
);

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    interfaceZoom: themeMock.zoom,
    setInterfaceZoom: themeMock.setInterfaceZoom,
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function ShortcutProbe() {
  useWindowShortcuts({ onOpenPreferences: vi.fn() });
  return null;
}

describe("useWindowShortcuts", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    themeMock.zoom = 1;
    themeMock.setInterfaceZoom.mockReset();
    themeMock.setInterfaceZoom.mockImplementation(
      (update: number | ((current: number) => number)) => {
        const raw = typeof update === "function" ? update(themeMock.zoom) : update;
        themeMock.zoom = Math.round(
          Math.min(Math.max(raw, 0.7), 1.5) * 20,
        ) / 20;
      },
    );
    toastMock.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps consecutive zoom shortcuts instead of using a stale render value", () => {
    act(() => root.render(<ShortcutProbe />));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "=", metaKey: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "=", metaKey: true }),
      );
    });

    expect(themeMock.setInterfaceZoom).toHaveBeenCalledTimes(2);
    expect(themeMock.zoom).toBe(1.1);
    expect(toastMock).toHaveBeenLastCalledWith("Zoom 110%", {
      id: "zoom",
      duration: 1500,
    });
  });
});
