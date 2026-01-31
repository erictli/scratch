import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getSettings, updateSettings } from "../services/notes";
import type { ThemeColors, ThemeSettings } from "../types/note";

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

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  customColors: ThemeColors | undefined;
  setCustomColor: (key: keyof ThemeColors, value: string) => void;
  resetCustomColors: () => void;
  getDefaultColors: () => Required<ThemeColors>;
  getCurrentColors: () => Required<ThemeColors>;
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

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [customLightColors, setCustomLightColors] = useState<ThemeColors | undefined>(undefined);
  const [customDarkColors, setCustomDarkColors] = useState<ThemeColors | undefined>(undefined);
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
          if (settings.theme.customLightColors) {
            setCustomLightColors(settings.theme.customLightColors);
          }
          if (settings.theme.customDarkColors) {
            setCustomDarkColors(settings.theme.customDarkColors);
          }
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

  // Get default colors for current theme
  const getDefaultColors = useCallback((): Required<ThemeColors> => {
    return resolvedTheme === "dark" ? defaultDarkColors : defaultLightColors;
  }, [resolvedTheme]);

  // Get current colors (defaults merged with custom)
  const getCurrentColors = useCallback((): Required<ThemeColors> => {
    const defaults = getDefaultColors();
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
  }, [resolvedTheme, customLightColors, customDarkColors, getDefaultColors]);

  // Get custom colors for current theme
  const customColors = resolvedTheme === "dark" ? customDarkColors : customLightColors;

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Apply custom colors if any
    const custom = resolvedTheme === "dark" ? customDarkColors : customLightColors;
    if (custom && Object.keys(custom).length > 0) {
      const currentColors = getCurrentColors();
      applyCSSVariables(currentColors);
    } else {
      removeCSSVariables();
    }
  }, [resolvedTheme, customLightColors, customDarkColors, getCurrentColors]);

  // Save settings to backend
  const saveThemeSettings = useCallback(async (
    newMode: ThemeMode,
    newLightColors: ThemeColors | undefined,
    newDarkColors: ThemeColors | undefined
  ) => {
    try {
      const settings = await getSettings();
      const themeSettings: ThemeSettings = {
        mode: newMode,
        customLightColors: newLightColors,
        customDarkColors: newDarkColors,
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
    saveThemeSettings(newTheme, customLightColors, customDarkColors);
  }, [customLightColors, customDarkColors, saveThemeSettings]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  }, [theme, setTheme]);

  const setCustomColor = useCallback((key: keyof ThemeColors, value: string) => {
    if (resolvedTheme === "dark") {
      setCustomDarkColors((prev) => {
        const updated = { ...prev, [key]: value };
        saveThemeSettings(theme, customLightColors, updated);
        return updated;
      });
    } else {
      setCustomLightColors((prev) => {
        const updated = { ...prev, [key]: value };
        saveThemeSettings(theme, updated, customDarkColors);
        return updated;
      });
    }
  }, [resolvedTheme, theme, customLightColors, customDarkColors, saveThemeSettings]);

  const resetCustomColors = useCallback(() => {
    if (resolvedTheme === "dark") {
      setCustomDarkColors(undefined);
      saveThemeSettings(theme, customLightColors, undefined);
    } else {
      setCustomLightColors(undefined);
      saveThemeSettings(theme, undefined, customDarkColors);
    }
    removeCSSVariables();
  }, [resolvedTheme, theme, customLightColors, customDarkColors, saveThemeSettings]);

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
      customColors,
      setCustomColor,
      resetCustomColors,
      getDefaultColors,
      getCurrentColors,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
