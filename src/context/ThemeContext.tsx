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
  ShortcutAction,
} from "../types/note";
import {
  DEFAULT_SHORTCUTS,
  buildShortcutOverrides,
  normalizeShortcut,
  parseShortcut,
  resolveShortcutSettings,
} from "../lib/shortcuts";

type ThemeMode = "light" | "dark" | "system";

// Font family CSS values
const fontFamilyMap: Record<FontFamily, string> = {
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
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
  shortcuts: Record<ShortcutAction, string>;
  setShortcut: (action: ShortcutAction, shortcut: string) => boolean;
  resetShortcuts: () => void;
  editorFontSettings: Required<EditorFontSettings>;
  setEditorFontSetting: <K extends keyof EditorFontSettings>(
    key: K,
    value: EditorFontSettings[K]
  ) => void;
  resetEditorFontSettings: () => void;
  reloadSettings: () => Promise<void>;
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

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, string>>(
    DEFAULT_SHORTCUTS
  );
  const [editorFontSettings, setEditorFontSettings] = useState<
    Required<EditorFontSettings>
  >(defaultEditorFontSettings);
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
      setShortcuts(resolveShortcutSettings(settings.shortcuts));
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

  // Save shortcut settings to backend
  const saveShortcutSettings = useCallback(
    async (newShortcuts: Record<ShortcutAction, string>) => {
      try {
        const settings = await getSettings();
        await updateSettings({
          ...settings,
          shortcuts: buildShortcutOverrides(newShortcuts),
        });
      } catch (error) {
        console.error("Failed to save shortcut settings:", error);
      }
    },
    []
  );

  const setShortcut = useCallback(
    (action: ShortcutAction, shortcut: string) => {
      const normalized = normalizeShortcut(shortcut);
      if (!normalized) return false;
      const parsed = parseShortcut(normalized);
      if (!parsed) return false;

      const hasAnyModifier = parsed.mod || parsed.alt || parsed.shift;
      const allowWithoutCmdCtrl =
        action === "navigateNoteUp" ||
        action === "navigateNoteDown" ||
        action === "openMinimalEditor";

      if (!allowWithoutCmdCtrl && !parsed.mod) return false;
      if (action === "openMinimalEditor" && !hasAnyModifier) return false;

      setShortcuts((prev) => {
        const updated = { ...prev, [action]: normalized };
        saveShortcutSettings(updated);
        return updated;
      });

      return true;
    },
    [saveShortcutSettings]
  );

  const resetShortcuts = useCallback(() => {
    const defaults = { ...DEFAULT_SHORTCUTS };
    setShortcuts(defaults);
    saveShortcutSettings(defaults);
  }, [saveShortcutSettings]);

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
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        cycleTheme,
        shortcuts,
        setShortcut,
        resetShortcuts,
        editorFontSettings,
        setEditorFontSetting,
        resetEditorFontSettings,
        reloadSettings,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
