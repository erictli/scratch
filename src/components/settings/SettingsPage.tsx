import { useTheme } from "../../context/ThemeContext";
import { ColorPicker } from "./ColorPicker";
import type { ThemeColors } from "../../types/note";
import { ArrowLeftIcon } from "../icons";

interface SettingsPageProps {
  onBack: () => void;
}

const colorLabels: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "bgSecondary", label: "Secondary Background" },
  { key: "bgMuted", label: "Muted Background" },
  { key: "bgEmphasis", label: "Emphasis Background" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Muted Text" },
  { key: "border", label: "Border" },
  { key: "accent", label: "Accent" },
];

export function SettingsPage({ onBack }: SettingsPageProps) {
  const {
    theme,
    resolvedTheme,
    setTheme,
    customColors,
    setCustomColor,
    resetCustomColors,
    getCurrentColors,
  } = useTheme();

  const currentColors = getCurrentColors();
  const hasCustomColors = customColors && Object.keys(customColors).length > 0;

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-bg-muted text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-text">Settings</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-lg mx-auto px-6 py-8">
          {/* Theme Mode Section */}
          <section className="mb-8">
            <h2 className="text-sm font-medium text-text-muted mb-4">Theme Mode</h2>
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`
                    flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${theme === mode
                      ? "bg-bg-emphasis text-text"
                      : "bg-bg-muted text-text-muted hover:bg-bg-emphasis hover:text-text"
                    }
                  `}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            {theme === "system" && (
              <p className="mt-2 text-xs text-text-muted">
                Currently using {resolvedTheme} mode based on system preference
              </p>
            )}
          </section>

          {/* Divider */}
          <div className="border-t border-border mb-8" />

          {/* Custom Colors Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-text-muted">
                Customize Colors ({resolvedTheme} mode)
              </h2>
              {hasCustomColors && (
                <button
                  onClick={resetCustomColors}
                  className="text-xs text-accent hover:underline"
                >
                  Reset to defaults
                </button>
              )}
            </div>

            <div className="bg-bg-secondary rounded-lg border border-border p-4">
              {colorLabels.map(({ key, label }) => (
                <ColorPicker
                  key={key}
                  label={label}
                  value={currentColors[key]}
                  onChange={(value) => setCustomColor(key, value)}
                />
              ))}
            </div>

            {hasCustomColors && (
              <p className="mt-3 text-xs text-text-muted">
                Custom colors are saved separately for light and dark modes.
              </p>
            )}
          </section>

          {/* Preview Section */}
          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-muted mb-4">Preview</h2>
            <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: currentColors.bg }}
                />
                <span className="text-sm text-text">Primary Background</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: currentColors.bgSecondary }}
                />
                <span className="text-sm text-text">Secondary Background</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded border border-border"
                  style={{ backgroundColor: currentColors.bgMuted }}
                />
                <span className="text-sm text-text-muted">Muted text sample</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: currentColors.accent }}
                />
                <span className="text-sm" style={{ color: currentColors.accent }}>
                  Accent color link
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
