import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getSettings, updateSettings } from "../services/notes";
import type { ThemeColors, ThemeSettings, EditorFontSettings, FontFamily } from "../types/note";

type ThemeMode = "light" | "dark" | "system";

// Default color values for light mode
const defaultLightColors: Required<ThemeColors> = {
  bg: "#ffffff",
  bgSecondary: "#fafaf9",
  bgMuted: "#f5f5f4",
  bgEmphasis: "#e7e5e4",
  text: "#1c1917",
  textMuted: "#78716c",
  textInverse: "#fafaf9",
  border: "#e7e5e4",
  accent: "#3b82f6",
};

// Default color values for dark mode
const defaultDarkColors: Required<ThemeColors> = {
  bg: "#0c0a09",
  bgSecondary: "#1c1917",
  bgMuted: "#292524",
  bgEmphasis: "#44403c",
  text: "#fafaf9",
  textMuted: "#a8a29e",
  textInverse: "#1c1917",
  border: "#292524",
  accent: "#3b82f6",
};

// Font family CSS values
const fontFamilyMap: Record<FontFamily, string> = {
  "system-sans": "ui-sans-serif, system-ui, sans-serif",
  "serif": "Georgia, 'Times New Roman', serif",
  "monospace": "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
};

// Default editor font settings (simplified)
const defaultEditorFontSettings: Required<EditorFontSettings> = {
  baseFontFamily: "system-sans",
  baseFontSize: 16,
  boldWeight: 700,
};

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  // Keep color methods for power users who edit settings.json
  getCurrentColors: () => Required<ThemeColors>;
  // Simplified font settings
  editorFontSettings: Required<EditorFontSettings>;
  setEditorFontSetting: <K extends keyof EditorFontSettings>(key: K, value: EditorFontSettings[K]) => void;
  resetEditorFontSettings: () => void;
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

// Apply CSS variables to document root
function applyCSSVariables(colors: Required<ThemeColors>) {
  const root = document.documentElement;
  root.style.setProperty("--color-bg", colors.bg);
  root.style.setProperty("--color-bg-secondary", colors.bgSecondary);
  root.style.setProperty("--color-bg-muted", colors.bgMuted);
  root.style.setProperty("--color-bg-emphasis", colors.bgEmphasis);
  root.style.setProperty("--color-text", colors.text);
  root.style.setProperty("--color-text-muted", colors.textMuted);
  root.style.setProperty("--color-text-inverse", colors.textInverse);
  root.style.setProperty("--color-border", colors.border);
  root.style.setProperty("--color-accent", colors.accent);
}

// Remove custom CSS variables (revert to CSS defaults)
function removeCSSVariables() {
  const root = document.documentElement;
  root.style.removeProperty("--color-bg");
  root.style.removeProperty("--color-bg-secondary");
  root.style.removeProperty("--color-bg-muted");
  root.style.removeProperty("--color-bg-emphasis");
  root.style.removeProperty("--color-text");
  root.style.removeProperty("--color-text-muted");
  root.style.removeProperty("--color-text-inverse");
  root.style.removeProperty("--color-border");
  root.style.removeProperty("--color-accent");
}

// Apply editor font CSS variables (with computed values)
function applyFontCSSVariables(fonts: Required<EditorFontSettings>) {
  const root = document.documentElement;
  const fontFamily = fontFamilyMap[fonts.baseFontFamily];
  const baseSize = fonts.baseFontSize;
  const boldWeight = fonts.boldWeight;

  // Base font settings
  root.style.setProperty("--editor-font-family", fontFamily);
  root.style.setProperty("--editor-base-font-size", `${baseSize}px`);
  root.style.setProperty("--editor-bold-weight", String(boldWeight));

  // Computed header sizes (based on base)
  root.style.setProperty("--editor-h1-size", `${baseSize * 2.25}px`);
  root.style.setProperty("--editor-h2-size", `${baseSize * 1.75}px`);
  root.style.setProperty("--editor-h3-size", `${baseSize * 1.5}px`);
  root.style.setProperty("--editor-h4-size", `${baseSize * 1.25}px`);
  root.style.setProperty("--editor-h5-size", `${baseSize}px`);
  root.style.setProperty("--editor-h6-size", `${baseSize}px`);

  // Fixed values for line height and spacing
  root.style.setProperty("--editor-line-height", "1.6");
  root.style.setProperty("--editor-paragraph-spacing", "1em");
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [customLightColors, setCustomLightColors] = useState<ThemeColors | undefined>(undefined);
  const [customDarkColors, setCustomDarkColors] = useState<ThemeColors | undefined>(undefined);
  const [editorFontSettings, setEditorFontSettings] = useState<Required<EditorFontSettings>>(defaultEditorFontSettings);
  const [isInitialized, setIsInitialized] = useState(false);

  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  // Load settings from backend on mount
  useEffect(() => {
    getSettings()
      .then((settings) => {
        if (settings.theme) {
          const mode = settings.theme.mode as ThemeMode;
          if (mode === "light" || mode === "dark" || mode === "system") {
            setThemeState(mode);
          }
          // Load custom colors (for power users who edit settings.json)
          if (settings.theme.customLightColors) {
            setCustomLightColors(settings.theme.customLightColors);
          }
          if (settings.theme.customDarkColors) {
            setCustomDarkColors(settings.theme.customDarkColors);
          }
        }
        // Load font settings
        if (settings.editorFont) {
          setEditorFontSettings({
            ...defaultEditorFontSettings,
            ...settings.editorFont,
          });
        }
        setIsInitialized(true);
      })
      .catch(() => {
        // If settings can't be loaded, use defaults
        setIsInitialized(true);
      });
  }, []);

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

  // Get current colors (defaults merged with custom from settings.json)
  const getCurrentColors = useCallback((): Required<ThemeColors> => {
    const defaults = resolvedTheme === "dark" ? defaultDarkColors : defaultLightColors;
    const custom = resolvedTheme === "dark" ? customDarkColors : customLightColors;
    if (!custom) return defaults;
    return {
      bg: custom.bg ?? defaults.bg,
      bgSecondary: custom.bgSecondary ?? defaults.bgSecondary,
      bgMuted: custom.bgMuted ?? defaults.bgMuted,
      bgEmphasis: custom.bgEmphasis ?? defaults.bgEmphasis,
      text: custom.text ?? defaults.text,
      textMuted: custom.textMuted ?? defaults.textMuted,
      textInverse: custom.textInverse ?? defaults.textInverse,
      border: custom.border ?? defaults.border,
      accent: custom.accent ?? defaults.accent,
    };
  }, [resolvedTheme, customLightColors, customDarkColors]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Apply custom colors if any (from settings.json for power users)
    const custom = resolvedTheme === "dark" ? customDarkColors : customLightColors;
    if (custom && Object.keys(custom).length > 0) {
      const currentColors = getCurrentColors();
      applyCSSVariables(currentColors);
    } else {
      removeCSSVariables();
    }
  }, [resolvedTheme, customLightColors, customDarkColors, getCurrentColors]);

  // Save theme mode to backend
  const saveThemeSettings = useCallback(async (newMode: ThemeMode) => {
    try {
      const settings = await getSettings();
      const themeSettings: ThemeSettings = {
        mode: newMode,
        // Preserve custom colors for power users
        customLightColors: settings.theme?.customLightColors,
        customDarkColors: settings.theme?.customDarkColors,
      };
      await updateSettings({
        ...settings,
        theme: themeSettings,
      });
    } catch (error) {
      console.error("Failed to save theme settings:", error);
    }
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    saveThemeSettings(newTheme);
  }, [saveThemeSettings]);

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

  // Save font settings to backend
  const saveFontSettings = useCallback(async (newFontSettings: Required<EditorFontSettings>) => {
    try {
      const settings = await getSettings();
      await updateSettings({
        ...settings,
        editorFont: newFontSettings,
      });
    } catch (error) {
      console.error("Failed to save font settings:", error);
    }
  }, []);

  // Update a single font setting
  const setEditorFontSetting = useCallback(<K extends keyof EditorFontSettings>(
    key: K,
    value: EditorFontSettings[K]
  ) => {
    setEditorFontSettings((prev) => {
      const updated = { ...prev, [key]: value };
      saveFontSettings(updated);
      return updated;
    });
  }, [saveFontSettings]);

  // Reset font settings to defaults
  const resetEditorFontSettings = useCallback(() => {
    setEditorFontSettings(defaultEditorFontSettings);
    saveFontSettings(defaultEditorFontSettings);
  }, [saveFontSettings]);

  // Don't render until initialized to prevent flash
  if (!isInitialized) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{
      theme,
      resolvedTheme,
      setTheme,
      cycleTheme,
      getCurrentColors,
      editorFontSettings,
      setEditorFontSetting,
      resetEditorFontSettings,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
