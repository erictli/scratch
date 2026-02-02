import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui";
import type { FontFamily } from "../../types/note";

// Font family options
const fontFamilyOptions: { value: FontFamily; label: string }[] = [
  { value: "system-sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Mono" },
];

// Bold weight options (medium excluded for monospace)
const boldWeightOptions = [
  { value: 500, label: "Medium", excludeForMonospace: true },
  { value: 600, label: "Semibold", excludeForMonospace: false },
  { value: 700, label: "Bold", excludeForMonospace: false },
  { value: 800, label: "Extra Bold", excludeForMonospace: false },
];

export function AppearanceSettingsSection() {
  const {
    theme,
    resolvedTheme,
    setTheme,
    editorFontSettings,
    setEditorFontSetting,
    resetEditorFontSettings,
  } = useTheme();

  // Check if settings differ from defaults
  const hasCustomFonts =
    editorFontSettings.baseFontFamily !== "system-sans" ||
    editorFontSettings.baseFontSize !== 16 ||
    editorFontSettings.boldWeight !== 700;

  // Filter weight options based on font family
  const isMonospace = editorFontSettings.baseFontFamily === "monospace";
  const availableWeightOptions = boldWeightOptions.filter(
    (opt) => !isMonospace || !opt.excludeForMonospace
  );

  // Handle font family change - bump up weight if needed
  const handleFontFamilyChange = (newFamily: FontFamily) => {
    setEditorFontSetting("baseFontFamily", newFamily);
    // If switching to monospace and current weight is medium, bump to semibold
    if (newFamily === "monospace" && editorFontSettings.boldWeight === 500) {
      setEditorFontSetting("boldWeight", 600);
    }
  };

  return (
    <div className="space-y-8">
      {/* Theme Mode Section */}
      <section>
        <h2 className="text-sm font-medium text-text-muted mb-4">Theme</h2>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((mode) => (
            <Button
              key={mode}
              onClick={() => setTheme(mode)}
              variant={theme === mode ? "default" : "secondary"}
              size="sm"
              className="flex-1"
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
        {theme === "system" && (
          <p className="mt-2 text-xs text-text-muted">
            Currently using {resolvedTheme} mode based on system preference
          </p>
        )}
      </section>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Editor Typography Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-muted">Typography</h2>
          {hasCustomFonts && (
            <Button
              onClick={resetEditorFontSettings}
              variant="link"
              className="text-xs h-auto p-0 text-accent"
            >
              Reset to defaults
            </Button>
          )}
        </div>

        <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-4">
          {/* Font Family */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Font</label>
            <select
              value={editorFontSettings.baseFontFamily}
              onChange={(e) =>
                handleFontFamilyChange(e.target.value as FontFamily)
              }
              className="w-40 px-2 py-1.5 text-sm bg-bg-muted border border-border rounded text-text"
            >
              {fontFamilyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Base Font Size */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Size</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="12"
                max="24"
                value={editorFontSettings.baseFontSize}
                onChange={(e) =>
                  setEditorFontSetting("baseFontSize", Number(e.target.value))
                }
                className="w-24"
              />
              <span className="text-sm text-text-muted w-12 text-right">
                {editorFontSettings.baseFontSize}px
              </span>
            </div>
          </div>

          {/* Bold Weight */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Bold Weight</label>
            <select
              value={editorFontSettings.boldWeight}
              onChange={(e) =>
                setEditorFontSetting("boldWeight", Number(e.target.value))
              }
              className="w-40 px-2 py-1.5 text-sm bg-bg-muted border border-border rounded text-text"
            >
              {availableWeightOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 bg-bg-secondary rounded-lg border border-border p-6">
          <h3 className="text-xs font-medium text-text-muted mb-4 uppercase tracking-wider">
            Preview
          </h3>
          <div className="prose prose-lg dark:prose-invert max-w-none">
            <h1>Heading</h1>
            <p>
              This is body text. It shows how your content will look with the
              selected font settings.
              <strong> Bold text </strong> uses the selected weight.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
