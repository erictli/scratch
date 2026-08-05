import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../types/note";
import { ThemeProvider, useTheme } from "./ThemeContext";

const serviceMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../services/notes", () => serviceMocks);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const persistedSettings: Settings = {
  theme: { mode: "system" },
  editorWidthResizeEnabled: false,
  editorToolbarVisible: true,
  titleBarModifiedDateVisible: false,
  titleBarFilenameVisible: true,
};

describe("ThemeProvider appearance reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getSettings.mockResolvedValue({ ...persistedSettings });
    serviceMocks.updateSettings.mockResolvedValue(undefined);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("keeps hook order stable and restores persisted settings after a failed reset", async () => {
    let latestTheme: ReturnType<typeof useTheme> | undefined;
    const currentTheme = () => {
      if (!latestTheme) throw new Error("Theme context was not rendered");
      return latestTheme;
    };
    function Probe() {
      latestTheme = useTheme();
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });

    expect(currentTheme().editorWidthResizeEnabled).toBe(false);
    expect(currentTheme().editorToolbarVisible).toBe(true);
    expect(currentTheme().titleBarFilenameVisible).toBe(true);

    serviceMocks.getSettings.mockClear();
    serviceMocks.updateSettings.mockReset();
    serviceMocks.updateSettings.mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    toastError.mockClear();

    await act(async () => {
      await (
        currentTheme().resetEditorFontSettings as unknown as () => Promise<void>
      )();
    });

    expect(toastError).toHaveBeenCalledWith(
      "Appearance settings could not be reset",
    );
    expect(serviceMocks.getSettings).toHaveBeenCalledTimes(2);
    expect(currentTheme().editorWidthResizeEnabled).toBe(false);
    expect(currentTheme().editorToolbarVisible).toBe(true);
    expect(currentTheme().titleBarFilenameVisible).toBe(true);

    serviceMocks.getSettings.mockClear();
    serviceMocks.updateSettings.mockReset();
    serviceMocks.updateSettings.mockRejectedValueOnce(
      new Error("disk still unavailable"),
    );
    toastError.mockClear();

    await act(async () => {
      await (
        currentTheme().setEditorToolbarVisible as unknown as (
          visible: boolean,
        ) => Promise<void>
      )(false);
    });

    expect(toastError).toHaveBeenCalledWith(
      "Appearance setting could not be saved",
    );

    act(() => root.unmount());
    container.remove();
  });
});
