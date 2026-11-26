import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getSettings, updateSettings } from "../services/notes";
import { SIDEBAR_MIN_PX, SIDEBAR_MAX_PX } from "../lib/sidebar";
import type {
  Settings,
  ThemeSettings,
  EditorFontSettings,
  FontFamily,
  TextDirection,
  EditorWidth,
  CustomColors,
  ThemeColorKey,
} from "../types/note";

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
  const [sidebarWidthPx, setSidebarWidthPxState] = useState<number | null>(null);
  const [customColorsLight, setCustomColorsLightState] = useState<CustomColors>({});
  const [customColorsDark, setCustomColorsDarkState] = useState<CustomColors>({});
  const [isInitialized, setIsInitialized] = useState(false);
  // Serialize settings writes so rapid concurrent updates never clobber each other
  const settingsQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistSettingsUpdate = useCallback(
    (updater: (current: Settings) => Settings, errorLabel: string) => {
      const next = settingsQueueRef.current.then(async () => {
        try {
          const current = await getSettings();
          await updateSettings(updater(current));
        } catch (error) {
          console.error(`Failed to ${errorLabel}:`, error);
        }
      });
      settingsQueueRef.current = next;
      return next;
    },
    [],
  );

  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  // Function to load settings from backend (resetting missing fields to defaults
  // so preferences from a previous notes folder do not bleed into the new folder)
  const loadSettingsFromBackend = useCallback(async () => {
    try {
      const settings = await getSettings();
      const mode = settings.theme?.mode as ThemeMode | undefined;
      setThemeState(
        mode === "light" || mode === "dark" || mode === "system"
          ? mode
          : "system",
      );

      if (settings.editorFont) {
        // Filter out null/undefined values to preserve defaults
        const fontSettings = Object.fromEntries(
          Object.entries(settings.editorFont).filter(([, v]) => v != null)
        ) as Partial<EditorFontSettings>;
        setEditorFontSettings({
          ...defaultEditorFontSettings,
          ...fontSettings,
        });
      } else {
        setEditorFontSettings(defaultEditorFontSettings);
      }

      setTextDirectionState(
        isTextDirection(settings.textDirection) ? settings.textDirection : "auto",
      );

      setEditorWidthState(
        settings.editorWidth === "narrow" ||
          settings.editorWidth === "normal" ||
          settings.editorWidth === "wide" ||
          settings.editorWidth === "full" ||
          settings.editorWidth === "custom"
          ? settings.editorWidth
          : "normal",
      );

      setInterfaceZoomState(
        typeof settings.interfaceZoom === "number" &&
          settings.interfaceZoom >= 0.7 &&
          settings.interfaceZoom <= 1.5
          ? settings.interfaceZoom
          : 1.0,
      );

      setCustomEditorWidthPxState(
        typeof settings.customEditorWidthPx === "number" &&
          settings.customEditorWidthPx >= 480
          ? settings.customEditorWidthPx
          : DEFAULT_CUSTOM_WIDTH_PX,
      );

      setSidebarWidthPxState(
        typeof settings.sidebarWidthPx === "number" &&
          settings.sidebarWidthPx >= SIDEBAR_MIN_PX &&
          settings.sidebarWidthPx <= SIDEBAR_MAX_PX
          ? settings.sidebarWidthPx
          : null,
      );

      setCustomColorsLightState(settings.customColorsLight ?? {});
      setCustomColorsDarkState(settings.customColorsDark ?? {});
    } catch {
      // If settings can't be loaded, use defaults
    }
  }, []);

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
  const saveThemeSettings = useCallback(
    async (newMode: ThemeMode) => {
      const themeSettings: ThemeSettings = {
        mode: newMode,
      };
      await persistSettingsUpdate(
        (settings) => ({
          ...settings,
          theme: themeSettings,
        }),
        "save theme settings",
      );
    },
    [persistSettingsUpdate],
  );

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

  // Apply interface zoom using native Tauri WebView zoom instead of CSS `zoom`.
  // CSS `documentElement.style.zoom` causes Floating UI / Radix UI tooltips and
  // context menus to be misplaced on Windows (Chromium/WebView2) due to coordinate
  // space mismatches between clientX/clientY and getBoundingClientRect().
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("zoom-no-transition");
    root.style.zoom = "";

    let cancelled = false;
    getCurrentWebview()
      .setZoom(interfaceZoom)
      .catch(() => {
        // Fallback for non-Tauri browser dev preview only
        if (!cancelled) {
          root.style.zoom = interfaceZoom === 1 ? "" : String(interfaceZoom);
        }
      });

    const raf = requestAnimationFrame(() => {
      root.classList.remove("zoom-no-transition");
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [interfaceZoom]);

  // Save font settings to backend
  const saveFontSettings = useCallback(
    async (newFontSettings: Required<EditorFontSettings>) => {
      await persistSettingsUpdate(
        (settings) => ({
          ...settings,
          editorFont: newFontSettings,
        }),
        "save font settings",
      );
    },
    [persistSettingsUpdate],
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
    setSidebarWidthPxState(null);
    setCustomColorsLightState({});
    setCustomColorsDarkState({});
    await persistSettingsUpdate(
      (settings) => ({
        ...settings,
        editorFont: defaultEditorFontSettings,
        textDirection: "auto",
        editorWidth: "normal",
        interfaceZoom: 1.0,
        customEditorWidthPx: undefined,
        sidebarWidthPx: undefined,
        customColorsLight: undefined,
        customColorsDark: undefined,
      }),
      "reset editor settings",
    );
  }, [persistSettingsUpdate]);

  // Save and set text direction
  const setTextDirection = useCallback(
    async (dir: TextDirection) => {
      setTextDirectionState(dir);
      await persistSettingsUpdate(
        (settings) => ({ ...settings, textDirection: dir }),
        "save text direction",
      );
    },
    [persistSettingsUpdate],
  );

  // Save and set editor width
  const setEditorWidth = useCallback(
    async (width: EditorWidth) => {
      setEditorWidthState(width);
      await persistSettingsUpdate(
        (settings) => ({ ...settings, editorWidth: width }),
        "save editor width",
      );
    },
    [persistSettingsUpdate],
  );

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
    void persistSettingsUpdate(
      (settings) => ({ ...settings, interfaceZoom }),
      "save interface zoom",
    );
  }, [interfaceZoom, isInitialized, persistSettingsUpdate]);

  // Set custom width in px (persists to settings)
  const setCustomEditorWidthPx = useCallback(
    async (px: number) => {
      setEditorWidthState("custom");
      setCustomEditorWidthPxState(px);
      await persistSettingsUpdate(
        (settings) => ({
          ...settings,
          editorWidth: "custom",
          customEditorWidthPx: px,
        }),
        "save custom editor width",
      );
    },
    [persistSettingsUpdate],
  );

  /**
   * Persists the clamped sidebar width to settings.
   * Pass `null` to remove the override and fall back to the CSS default.
   */
  const setSidebarWidthPx = useCallback(
    async (px: number | null) => {
      if (px === null) {
        setSidebarWidthPxState(null);
        await persistSettingsUpdate(
          (settings) => ({ ...settings, sidebarWidthPx: undefined }),
          "reset sidebar width",
        );
      } else {
        const clamped = Math.round(
          Math.min(Math.max(px, SIDEBAR_MIN_PX), SIDEBAR_MAX_PX),
        );
        setSidebarWidthPxState(clamped);
        await persistSettingsUpdate(
          (settings) => ({ ...settings, sidebarWidthPx: clamped }),
          "save sidebar width",
        );
      }
    },
    [persistSettingsUpdate],
  );

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
        void persistSettingsUpdate(
          (settings) => ({ ...settings, [settingsKey]: updated }),
          "save custom color",
        );
        return updated;
      });
    },
    [persistSettingsUpdate],
  );

  // Reset a single custom color back to theme default
  const resetCustomColor = useCallback(
    async (mode: "light" | "dark", key: ThemeColorKey) => {
      const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
      const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
      setter((prev) => {
        const updated = { ...prev };
        delete updated[key];
        void persistSettingsUpdate(
          (settings) => ({
            ...settings,
            [settingsKey]: Object.keys(updated).length > 0 ? updated : undefined,
          }),
          "reset custom color",
        );
        return updated;
      });
    },
    [persistSettingsUpdate],
  );

  // Reset all custom colors for a given mode
  const resetAllCustomColors = useCallback(
    async (mode: "light" | "dark") => {
      const setter = mode === "light" ? setCustomColorsLightState : setCustomColorsDarkState;
      const settingsKey = mode === "light" ? "customColorsLight" : "customColorsDark";
      setter({});
      await persistSettingsUpdate(
        (settings) => ({ ...settings, [settingsKey]: undefined }),
        "reset all custom colors",
      );
    },
    [persistSettingsUpdate],
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

  return (
    <ThemeContext.Provider
      value={{
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
        setEditorMaxWidthLive,
        sidebarWidthPx,
        setSidebarWidthPx,
        setSidebarWidthLive,
        customColorsLight,
        customColorsDark,
        setCustomColor,
        resetCustomColor,
        resetAllCustomColors,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
