import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings, updateGlobalSettings } from "../services/notes";
import { SIDEBAR_MIN_PX, SIDEBAR_MAX_PX } from "../lib/sidebar";
import { resolveEditorWidthResizeEnabled } from "../lib/editorWidthResize";
import { resolveEditorToolbarVisible } from "../lib/editorToolbar";
import {
  DEFAULT_TITLE_BAR_NOTE_INFO_VISIBILITY,
  resolveTitleBarNoteInfoVisibility,
  updateTitleBarNoteInfoVisibility,
  type TitleBarNoteInfoKind,
  type TitleBarNoteInfoVisibility,
} from "../lib/titleBarNoteInfo";
import type {
  ThemeSettings,
  EditorFontSettings,
  FontFamily,
  TextDirection,
  EditorWidth,
  CustomColors,
  ThemeColorKey,
} from "../types/note";
import { toast } from "sonner";
import {
  SETTINGS_CHANGED_DOM_EVENT,
  type SettingsChangedEvent,
} from "../lib/settingsScope";

type ThemeMode = "light" | "dark" | "system";

// Font family CSS values
const fontFamilyMap: Record<FontFamily, string> = {
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
};

// Editor width CSS values for presets
const editorWidthMap: Record<Exclude<EditorWidth, "custom">, string> = {
  narrow: "36rem",
  normal: "48rem",
  wide: "64rem",
  full: "100%",
};

// Default custom width in px
const DEFAULT_CUSTOM_WIDTH_PX = 768;

// Default editor font settings (simplified)
const defaultEditorFontSettings: Required<EditorFontSettings> = {
  baseFontFamily: "system-sans",
  baseFontSize: 15,
  boldWeight: 600,
  lineHeight: 1.6,
};

// Default theme colors (must match App.css :root / .dark values)
const defaultThemeColors: Record<"light" | "dark", Record<ThemeColorKey, string>> = {
  light: {
    bg: "#ffffff",
    "bg-secondary": "#fafaf9",
    "bg-muted": "rgba(28, 25, 23, 0.06)",
    "bg-emphasis": "rgba(28, 25, 23, 0.09)",
    text: "#1c1917",
    "text-muted": "#78716c",
    border: "rgba(28, 25, 23, 0.08)",
    accent: "#1c1917",
    selection: "rgba(250, 204, 21, 0.4)",
  },
  dark: {
    bg: "rgb(22, 20, 19)",
    "bg-secondary": "rgb(14, 12, 11)",
    "bg-muted": "rgba(250, 249, 249, 0.05)",
    "bg-emphasis": "rgba(250, 249, 249, 0.08)",
    text: "#fafaf9",
    "text-muted": "#a8a29e",
    border: "rgba(250, 249, 249, 0.07)",
    accent: "#fafaf9",
    selection: "rgba(253, 224, 71, 0.35)",
  },
};

export { defaultThemeColors };

// Normalize any CSS color string (hex, rgb(), rgba(), hsl(), named) to an RGB
// triple by letting the browser parse it via getComputedStyle.
function parseCssColorToRgb(value: string): [number, number, number] | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("div");
  probe.style.color = value;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  editorFontSettings: Required<EditorFontSettings>;
  setEditorFontSetting: <K extends keyof EditorFontSettings>(
    key: K,
    value: EditorFontSettings[K]
  ) => void;
  resetEditorFontSettings: () => void;
  reloadSettings: () => Promise<void>;
  textDirection: TextDirection;
  setTextDirection: (dir: TextDirection) => void;
  editorWidth: EditorWidth;
  setEditorWidth: (width: EditorWidth) => void;
  interfaceZoom: number;
  setInterfaceZoom: (zoomOrUpdater: number | ((prev: number) => number)) => void;
  customEditorWidthPx: number;
  setCustomEditorWidthPx: (px: number) => void;
  editorWidthResizeEnabled: boolean;
  setEditorWidthResizeEnabled: (enabled: boolean) => void;
  editorToolbarVisible: boolean;
  setEditorToolbarVisible: (visible: boolean) => void;
  titleBarModifiedDateVisible: boolean;
  setTitleBarModifiedDateVisible: (visible: boolean) => void;
  titleBarFilenameVisible: boolean;
  setTitleBarFilenameVisible: (visible: boolean) => void;
  setEditorMaxWidthLive: (value: string) => void;
  sidebarWidthPx: number | null;
  setSidebarWidthPx: (px: number | null) => void;
  setSidebarWidthLive: (px: number) => void;
  customColorsLight: CustomColors;
  customColorsDark: CustomColors;
  setCustomColor: (mode: "light" | "dark", key: ThemeColorKey, value: string) => void;
  resetCustomColor: (mode: "light" | "dark", key: ThemeColorKey) => void;
  resetAllCustomColors: (mode: "light" | "dark") => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

// Apply editor font CSS variables (with computed values)
function applyFontCSSVariables(fonts: Required<EditorFontSettings>) {
  const root = document.documentElement;
  const fontFamily = fontFamilyMap[fonts.baseFontFamily];
  const baseSize = fonts.baseFontSize;
  const boldWeight = fonts.boldWeight;
  const lineHeight = fonts.lineHeight;

  // Base font settings
  root.style.setProperty("--editor-font-family", fontFamily);
  root.style.setProperty("--editor-base-font-size", `${baseSize}px`);
  root.style.setProperty("--editor-bold-weight", String(boldWeight));
  root.style.setProperty("--editor-line-height", String(lineHeight));

  // Computed header sizes (based on base)
  root.style.setProperty("--editor-h1-size", `${baseSize * 2.25}px`);
  root.style.setProperty("--editor-h2-size", `${baseSize * 1.75}px`);
  root.style.setProperty("--editor-h3-size", `${baseSize * 1.5}px`);
  root.style.setProperty("--editor-h4-size", `${baseSize * 1.25}px`);
  root.style.setProperty("--editor-h5-size", `${baseSize}px`);
  root.style.setProperty("--editor-h6-size", `${baseSize}px`);

  // Fixed value for paragraph spacing
  root.style.setProperty("--editor-paragraph-spacing", "0.875em");
}

// Apply editor layout width CSS variables
function applyLayoutCSSVariables(
  width: EditorWidth,
  customWidthPx?: number
) {
  const root = document.documentElement;
  if (width === "custom" && customWidthPx) {
    root.style.setProperty("--editor-max-width", `${customWidthPx}px`);
  } else if (width !== "custom") {
    root.style.setProperty("--editor-max-width", editorWidthMap[width]);
  }
}

function isTextDirection(value: unknown): value is TextDirection {
  return value === "auto" || value === "ltr" || value === "rtl";
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [editorFontSettings, setEditorFontSettings] = useState<
    Required<EditorFontSettings>
  >(defaultEditorFontSettings);
  const [textDirection, setTextDirectionState] = useState<TextDirection>("auto");
  const [editorWidth, setEditorWidthState] = useState<EditorWidth>("normal");
  const [interfaceZoom, setInterfaceZoomState] = useState(1.0);
  const [customEditorWidthPx, setCustomEditorWidthPxState] = useState<number>(
    DEFAULT_CUSTOM_WIDTH_PX
  );
  const [editorWidthResizeEnabled, setEditorWidthResizeEnabledState] =
    useState(true);
  const [editorToolbarVisible, setEditorToolbarVisibleState] = useState(false);
  const [titleBarNoteInfoVisibility, setTitleBarNoteInfoVisibility] =
    useState<TitleBarNoteInfoVisibility>(
      DEFAULT_TITLE_BAR_NOTE_INFO_VISIBILITY,
    );
  const [sidebarWidthPx, setSidebarWidthPxState] = useState<number | null>(null);
  const [customColorsLight, setCustomColorsLightState] = useState<CustomColors>({});
  const [customColorsDark, setCustomColorsDarkState] = useState<CustomColors>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const titleBarNoteInfoVisibilityRef = useRef<TitleBarNoteInfoVisibility>(
    DEFAULT_TITLE_BAR_NOTE_INFO_VISIBILITY,
  );
  const applyTitleBarNoteInfoVisibility = useCallback(
    (visibility: TitleBarNoteInfoVisibility) => {
      titleBarNoteInfoVisibilityRef.current = visibility;
      setTitleBarNoteInfoVisibility(visibility);
    },
    [],
  );
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  // Function to load settings from backend
  const loadSettingsFromBackend = useCallback(async () => {
    try {
      const settings = await getSettings();
      if (settings.theme) {
        const mode = settings.theme.mode as ThemeMode;
        if (mode === "light" || mode === "dark" || mode === "system") {
          setThemeState(mode);
        }
      }
      if (settings.editorFont) {
        // Filter out null/undefined values to preserve defaults
        const fontSettings = Object.fromEntries(
          Object.entries(settings.editorFont).filter(([, v]) => v != null)
        ) as Partial<EditorFontSettings>;
        setEditorFontSettings({
          ...defaultEditorFontSettings,
          ...fontSettings,
        });
      }
      if (isTextDirection(settings.textDirection)) {
        setTextDirectionState(settings.textDirection);
      }
      if (
        settings.editorWidth === "narrow" ||
        settings.editorWidth === "normal" ||
        settings.editorWidth === "wide" ||
        settings.editorWidth === "full" ||
        settings.editorWidth === "custom"
      ) {
        setEditorWidthState(settings.editorWidth);
      }
      if (
        typeof settings.interfaceZoom === "number" &&
        settings.interfaceZoom >= 0.7 &&
        settings.interfaceZoom <= 1.5
      ) {
        setInterfaceZoomState(settings.interfaceZoom);
      }
      if (
        typeof settings.customEditorWidthPx === "number" &&
        settings.customEditorWidthPx >= 480
      ) {
        setCustomEditorWidthPxState(settings.customEditorWidthPx);
      }
      setEditorWidthResizeEnabledState(
        resolveEditorWidthResizeEnabled(settings.editorWidthResizeEnabled),
      );
      setEditorToolbarVisibleState(
        resolveEditorToolbarVisible(settings.editorToolbarVisible),
      );
      applyTitleBarNoteInfoVisibility(
        resolveTitleBarNoteInfoVisibility(
          settings.titleBarModifiedDateVisible,
          settings.titleBarFilenameVisible,
        ),
      );
      if (
        typeof settings.sidebarWidthPx === "number" &&
        settings.sidebarWidthPx >= SIDEBAR_MIN_PX &&
        settings.sidebarWidthPx <= SIDEBAR_MAX_PX
      ) {
        setSidebarWidthPxState(settings.sidebarWidthPx);
      }
      if (settings.customColorsLight) {
        setCustomColorsLightState(settings.customColorsLight);
      }
      if (settings.customColorsDark) {
        setCustomColorsDarkState(settings.customColorsDark);
      }
    } catch {
      // If settings can't be loaded, use defaults
    }
  }, [applyTitleBarNoteInfoVisibility]);

  // Reload settings from backend (exposed to context consumers)
  const reloadSettings = useCallback(async () => {
    await loadSettingsFromBackend();
  }, [loadSettingsFromBackend]);

  // Load settings from backend on mount
  useEffect(() => {
    loadSettingsFromBackend().finally(() => {
      setIsInitialized(true);
    });
  }, [loadSettingsFromBackend]);

  // One native listener per window fans scoped changes out to local React
  // consumers. Global appearance changes are reloaded immediately everywhere.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<SettingsChangedEvent>("settings-changed", (event) => {
      if (disposed) return;
      if (event.payload.scope === "global") {
        void loadSettingsFromBackend();
      }
      window.dispatchEvent(
        new CustomEvent<SettingsChangedEvent>(SETTINGS_CHANGED_DOM_EVENT, {
          detail: event.payload,
        }),
      );
    }).then((removeListener) => {
      if (disposed) removeListener();
      else unlisten = removeListener;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadSettingsFromBackend]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Resolve the actual theme to use
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  // Apply theme to document (just toggle dark class)
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedTheme]);

  // Save theme mode to backend
  const saveThemeSettings = useCallback(async (newMode: ThemeMode) => {
    try {
      const themeSettings: ThemeSettings = {
        mode: newMode,
      };
      await updateGlobalSettings({ theme: themeSettings });
    } catch (error) {
      console.error("Failed to save theme settings:", error);
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      setThemeState(newTheme);
      saveThemeSettings(newTheme);
    },
    [saveThemeSettings]
  );

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  }, [theme, setTheme]);

  // Apply font CSS variables whenever font settings change
  useEffect(() => {
    applyFontCSSVariables(editorFontSettings);
  }, [editorFontSettings]);

  // Apply layout CSS variables whenever width changes
  useEffect(() => {
    applyLayoutCSSVariables(editorWidth, customEditorWidthPx);
  }, [editorWidth, customEditorWidthPx]);

  // Apply sidebar width CSS variable whenever it changes (null = no override, fallback to 16rem)
  useEffect(() => {
    if (sidebarWidthPx === null) {
      document.documentElement.style.removeProperty("--sidebar-width");
    } else {
      document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidthPx}px`);
    }
  }, [sidebarWidthPx]);

  // Apply interface zoom whenever it changes (suppress transitions during zoom)
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("zoom-no-transition");
    root.style.zoom = String(interfaceZoom);
    const raf = requestAnimationFrame(() => {
      root.classList.remove("zoom-no-transition");
    });
    return () => cancelAnimationFrame(raf);
  }, [interfaceZoom]);

  // Save font settings to backend
  const saveFontSettings = useCallback(
    async (newFontSettings: Required<EditorFontSettings>) => {
      try {
        await updateGlobalSettings({ editorFont: newFontSettings });
      } catch (error) {
        console.error("Failed to save font settings:", error);
      }
    },
    []
  );

  // Update a single font setting
  const setEditorFontSetting = useCallback(
    <K extends keyof EditorFontSettings>(
      key: K,
      value: EditorFontSettings[K]
    ) => {
      setEditorFontSettings((prev) => {
        const updated = { ...prev, [key]: value };
        saveFontSettings(updated);
        return updated;
      });
    },
    [saveFontSettings]
  );

  // Reset font settings to defaults (single atomic save to avoid race conditions)
  const resetEditorFontSettings = useCallback(async () => {
    setEditorFontSettings(defaultEditorFontSettings);
    setTextDirectionState("auto");
    setEditorWidthState("normal");
    setInterfaceZoomState(1.0);
    setCustomEditorWidthPxState(DEFAULT_CUSTOM_WIDTH_PX);
    setEditorWidthResizeEnabledState(true);
    setEditorToolbarVisibleState(false);
    applyTitleBarNoteInfoVisibility(DEFAULT_TITLE_BAR_NOTE_INFO_VISIBILITY);
    setSidebarWidthPxState(null);
    setCustomColorsLightState({});
    setCustomColorsDarkState({});
    await updateGlobalSettings({
        editorFont: defaultEditorFontSettings,
        textDirection: "auto",
        editorWidth: "normal",
        interfaceZoom: 1.0,
        customEditorWidthPx: null,
        editorWidthResizeEnabled: null,
        editorToolbarVisible: null,
        titleBarModifiedDateVisible: null,
        titleBarFilenameVisible: null,
        sidebarWidthPx: null,
        customColorsLight: null,
        customColorsDark: null,
      });
    } catch (error) {
      console.error("Failed to reset appearance settings:", error);
      toast.error("Appearance settings could not be reset");
      await loadSettingsFromBackend();
    }
  }, [applyTitleBarNoteInfoVisibility, loadSettingsFromBackend]);

  // Save and set text direction
  const setTextDirection = useCallback(async (dir: TextDirection) => {
    setTextDirectionState(dir);
    try {
      await updateGlobalSettings({ textDirection: dir });
    } catch (error) {
      console.error("Failed to save text direction:", error);
    }
  }, []);

  // Save and set editor width
  const setEditorWidth = useCallback(async (width: EditorWidth) => {
    setEditorWidthState(width);
    try {
      await updateGlobalSettings({ editorWidth: width });
    } catch (error) {
      console.error("Failed to save editor width:", error);
    }
  }, []);

  // Save and set interface zoom (accepts absolute value or updater function)
  const setInterfaceZoom = useCallback(
    (zoomOrUpdater: number | ((prev: number) => number)) => {
      setInterfaceZoomState((prev) => {
        const raw =
          typeof zoomOrUpdater === "function"
            ? zoomOrUpdater(prev)
            : zoomOrUpdater;
        return Math.round(Math.min(Math.max(raw, 0.7), 1.5) * 20) / 20;
      });
    },
    [],
  );

  // Persist interface zoom changes to backend
  useEffect(() => {
    if (!isInitialized) return;
    updateGlobalSettings({ interfaceZoom })
      .catch((error) =>
        console.error("Failed to save interface zoom:", error),
      );
  }, [interfaceZoom, isInitialized]);

  // Set custom width in px (persists to settings)
  const setCustomEditorWidthPx = useCallback(async (px: number) => {
    setEditorWidthState("custom");
    setCustomEditorWidthPxState(px);
    try {
      await updateGlobalSettings({
        editorWidth: "custom",
        customEditorWidthPx: px,
      });
    } catch (error) {
      console.error("Failed to save custom editor width:", error);
    }
  }, []);

  const setEditorWidthResizeEnabled = useCallback(async (enabled: boolean) => {
    setEditorWidthResizeEnabledState(enabled);
    try {
      await updateGlobalSettings({ editorWidthResizeEnabled: enabled });
    } catch (error) {
      console.error("Failed to save editor width resize setting:", error);
    }
  }, []);

  const setEditorToolbarVisible = useCallback(async (visible: boolean) => {
    setEditorToolbarVisibleState(visible);
    try {
      await updateGlobalSettings({ editorToolbarVisible: visible });
    } catch (error) {
      console.error("Failed to save editor toolbar setting:", error);
    }
  }, []);

  const updateTitleBarNoteInfo = useCallback(
    (kind: TitleBarNoteInfoKind, visible: boolean) => {
      const next = updateTitleBarNoteInfoVisibility(
        titleBarNoteInfoVisibilityRef.current,
        kind,
        visible,
      );
      applyTitleBarNoteInfoVisibility(next);
      void updateGlobalSettings({
        titleBarModifiedDateVisible: next.modifiedDateVisible,
        titleBarFilenameVisible: next.filenameVisible,
      });
    },
    [applyTitleBarNoteInfoVisibility],
  );

  const setTitleBarModifiedDateVisible = useCallback(
    (visible: boolean) => {
      void updateTitleBarNoteInfo("modifiedDate", visible);
    },
    [updateTitleBarNoteInfo],
  );

  const setTitleBarFilenameVisible = useCallback(
    (visible: boolean) => {
      void updateTitleBarNoteInfo("filename", visible);
    },
    [updateTitleBarNoteInfo],
  );

  /**
   * Persists the clamped sidebar width to settings.
   * Pass `null` to remove the override and fall back to the CSS default.
   */
  const setSidebarWidthPx = useCallback(async (px: number | null) => {
    if (px === null) {
      setSidebarWidthPxState(null);
      try {
        await updateGlobalSettings({ sidebarWidthPx: null });
      } catch (error) {
        console.error("Failed to reset sidebar width:", error);
      }
    } else {
      const clamped = Math.round(Math.min(Math.max(px, SIDEBAR_MIN_PX), SIDEBAR_MAX_PX));
      setSidebarWidthPxState(clamped);
      try {
        await updateGlobalSettings({ sidebarWidthPx: clamped });
      } catch (error) {
        console.error("Failed to save sidebar width:", error);
      }
    }
  }, []);

  // Apply custom color CSS variable overrides whenever theme or colors change
  useEffect(() => {
    const root = document.documentElement;
    const activeColors = resolvedTheme === "dark" ? customColorsDark : customColorsLight;
    const defaults = defaultThemeColors[resolvedTheme];
    const keys: ThemeColorKey[] = [
      "bg", "bg-secondary", "bg-muted", "bg-emphasis",
      "text", "text-muted", "border", "accent", "selection",
    ];
    for (const key of keys) {
      const value = activeColors[key] ?? defaults[key];
      root.style.setProperty(`--color-${key}`, value);
    }

    // Sync the Windows title bar to match bg-secondary (no-op on other OSes).
    const captionColor =
      activeColors["bg-secondary"] ?? defaults["bg-secondary"];
    const rgb = parseCssColorToRgb(captionColor);
    if (rgb) {
      invoke("set_title_bar_theme", {
        isDark: resolvedTheme === "dark",
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
      }).catch(() => {});
    }
  }, [resolvedTheme, customColorsLight, customColorsDark]);

  // Set a single custom color for a given mode
  const setCustomColor = useCallback(
    async (mode: "light" | "dark", key: ThemeColorKey, value: string) => {
      const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
      const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
      setter((prev) => {
        const updated = { ...prev, [key]: value };
        // Persist in background
        updateGlobalSettings({ [settingsKey]: updated })
          .catch((err) => console.error("Failed to save custom color:", err));
        return updated;
      });
    },
    [],
  );

  // Reset a single custom color back to theme default
  const resetCustomColor = useCallback(
    async (mode: "light" | "dark", key: ThemeColorKey) => {
      const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
      const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
      setter((prev) => {
        const updated = { ...prev };
        delete updated[key];
        updateGlobalSettings({
          [settingsKey]: Object.keys(updated).length > 0 ? updated : null,
        })
          .catch((err) => console.error("Failed to reset custom color:", err));
        return updated;
      });
    },
    [],
  );

  // Reset all custom colors for a given mode
  const resetAllCustomColors = useCallback(
    async (mode: "light" | "dark") => {
      const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
      const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
      setter({});
      try {
        await updateGlobalSettings({ [settingsKey]: null });
      } catch (err) {
        console.error("Failed to reset all custom colors:", err);
      }
    },
    [],
  );

  // Live CSS variable update during drag (no persistence)
  const setEditorMaxWidthLive = useCallback((value: string) => {
    document.documentElement.style.setProperty("--editor-max-width", value);
  }, []);

  /** Updates `--sidebar-width` CSS variable immediately during drag without writing to settings. */
  const setSidebarWidthLive = useCallback((px: number) => {
    document.documentElement.style.setProperty("--sidebar-width", `${px}px`);
  }, []);

  // Don't render until initialized to prevent flash
  if (!isInitialized) {
    return null;
  }

  const contextValue = useMemo<ThemeContextType>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      cycleTheme,
      editorFontSettings,
      setEditorFontSetting,
      resetEditorFontSettings,
      reloadSettings,
      textDirection,
      setTextDirection,
      editorWidth,
      setEditorWidth,
      interfaceZoom,
      setInterfaceZoom,
      customEditorWidthPx,
      setCustomEditorWidthPx,
      editorWidthResizeEnabled,
      setEditorWidthResizeEnabled,
      editorToolbarVisible,
      setEditorToolbarVisible,
      titleBarModifiedDateVisible:
        titleBarNoteInfoVisibility.modifiedDateVisible,
      setTitleBarModifiedDateVisible,
      titleBarFilenameVisible: titleBarNoteInfoVisibility.filenameVisible,
      setTitleBarFilenameVisible,
      setEditorMaxWidthLive,
      sidebarWidthPx,
      setSidebarWidthPx,
      setSidebarWidthLive,
      customColorsLight,
      customColorsDark,
      setCustomColor,
      resetCustomColor,
      resetAllCustomColors,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      cycleTheme,
      editorFontSettings,
      setEditorFontSetting,
      resetEditorFontSettings,
      reloadSettings,
      textDirection,
      setTextDirection,
      editorWidth,
      setEditorWidth,
      interfaceZoom,
      setInterfaceZoom,
      customEditorWidthPx,
      setCustomEditorWidthPx,
      editorWidthResizeEnabled,
      setEditorWidthResizeEnabled,
      editorToolbarVisible,
      setEditorToolbarVisible,
      titleBarNoteInfoVisibility.modifiedDateVisible,
      setTitleBarModifiedDateVisible,
      titleBarNoteInfoVisibility.filenameVisible,
      setTitleBarFilenameVisible,
      setEditorMaxWidthLive,
      sidebarWidthPx,
      setSidebarWidthPx,
      setSidebarWidthLive,
      customColorsLight,
      customColorsDark,
      setCustomColor,
      resetCustomColor,
      resetAllCustomColors,
    ],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
