import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getSettings, updateSettings } from "../services/notes";
import type {
  ThemeSettings,
  EditorFontSettings,
  FontFamily,
  TextDirection,
  EditorWidth,
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

// Editor width CSS values
const editorWidthMap: Record<EditorWidth, string> = {
  narrow: "36rem",
  normal: "48rem",
  wide: "64rem",
  full: "100%",
};

// Default editor font settings (simplified)
const defaultEditorFontSettings: Required<EditorFontSettings> = {
  baseFontFamily: "system-sans",
  baseFontSize: 15,
  boldWeight: 600,
  lineHeight: 1.6,
};

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
  setInterfaceZoom: (zoom: number) => void;
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

// Apply editor layout CSS variables
function applyLayoutCSSVariables(direction: TextDirection, width: EditorWidth) {
  const root = document.documentElement;
  root.style.setProperty("--editor-direction", direction);
  root.style.setProperty("--editor-max-width", editorWidthMap[width]);
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [editorFontSettings, setEditorFontSettings] = useState<
    Required<EditorFontSettings>
  >(defaultEditorFontSettings);
  const [textDirection, setTextDirectionState] = useState<TextDirection>("ltr");
  const [editorWidth, setEditorWidthState] = useState<EditorWidth>("normal");
  const [interfaceZoom, setInterfaceZoomState] = useState(1.0);
  const [isInitialized, setIsInitialized] = useState(false);

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
      if (settings.textDirection === "ltr" || settings.textDirection === "rtl") {
        setTextDirectionState(settings.textDirection);
      }
      if (
        settings.editorWidth === "narrow" ||
        settings.editorWidth === "normal" ||
        settings.editorWidth === "wide" ||
        settings.editorWidth === "full"
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
  const saveThemeSettings = useCallback(async (newMode: ThemeMode) => {
    try {
      const settings = await getSettings();
      const themeSettings: ThemeSettings = {
        mode: newMode,
      };
      await updateSettings({
        ...settings,
        theme: themeSettings,
      });
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

  // Apply layout CSS variables whenever direction or width change
  useEffect(() => {
    applyLayoutCSSVariables(textDirection, editorWidth);
  }, [textDirection, editorWidth]);

  // Apply interface zoom whenever it changes
  useEffect(() => {
    document.documentElement.style.zoom = String(interfaceZoom);
  }, [interfaceZoom]);

  // Save font settings to backend
  const saveFontSettings = useCallback(
    async (newFontSettings: Required<EditorFontSettings>) => {
      try {
        const settings = await getSettings();
        await updateSettings({
          ...settings,
          editorFont: newFontSettings,
        });
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
    setTextDirectionState("ltr");
    setEditorWidthState("normal");
    setInterfaceZoomState(1.0);
    try {
      const settings = await getSettings();
      await updateSettings({
        ...settings,
        editorFont: defaultEditorFontSettings,
        textDirection: "ltr",
        editorWidth: "normal",
        interfaceZoom: 1.0,
      });
    } catch (error) {
      console.error("Failed to reset editor settings:", error);
    }
  }, []);

  // Save and set text direction
  const setTextDirection = useCallback(async (dir: TextDirection) => {
    setTextDirectionState(dir);
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, textDirection: dir });
    } catch (error) {
      console.error("Failed to save text direction:", error);
    }
  }, []);

  // Save and set editor width
  const setEditorWidth = useCallback(async (width: EditorWidth) => {
    setEditorWidthState(width);
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, editorWidth: width });
    } catch (error) {
      console.error("Failed to save editor width:", error);
    }
  }, []);

  // Save and set interface zoom
  const setInterfaceZoom = useCallback(async (zoom: number) => {
    const clamped = Math.min(Math.max(zoom, 0.7), 1.5);
    setInterfaceZoomState(clamped);
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, interfaceZoom: clamped });
    } catch (error) {
      console.error("Failed to save interface zoom:", error);
    }
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
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
