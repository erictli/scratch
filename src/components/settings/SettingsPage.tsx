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

// Common font stacks
const fontOptions = [
  { value: "ui-sans-serif, system-ui, sans-serif", label: "System Sans" },
  { value: "ui-serif, Georgia, serif", label: "System Serif" },
  { value: "ui-monospace, monospace", label: "Monospace" },
  { value: "'Georgia', serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", label: "Palatino" },
  { value: "'Arial', sans-serif", label: "Arial" },
  { value: "'Helvetica Neue', Helvetica, sans-serif", label: "Helvetica" },
  { value: "'Verdana', sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "'Menlo', monospace", label: "Menlo" },
];

const fontWeightOptions = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
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
    editorFontSettings,
    setEditorFontSetting,
    resetEditorFontSettings,
    getDefaultFontSettings,
  } = useTheme();

  const currentColors = getCurrentColors();
  const hasCustomColors = customColors && Object.keys(customColors).length > 0;
  const defaultFonts = getDefaultFontSettings();
  const hasCustomFonts = JSON.stringify(editorFontSettings) !== JSON.stringify(defaultFonts);

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

          {/* Divider */}
          <div className="border-t border-border mb-8 mt-8" />

          {/* Editor Font Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-text-muted">Editor Typography</h2>
              {hasCustomFonts && (
                <button
                  onClick={resetEditorFontSettings}
                  className="text-xs text-accent hover:underline"
                >
                  Reset to defaults
                </button>
              )}
            </div>

            <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-6">
              {/* Title Settings */}
              <div>
                <h3 className="text-sm font-medium text-text mb-3">Title</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Family</label>
                    <select
                      value={editorFontSettings.titleFontFamily}
                      onChange={(e) => setEditorFontSetting("titleFontFamily", e.target.value)}
                      className="w-40 px-2 py-1 text-sm bg-bg-muted border border-border rounded text-text"
                    >
                      {fontOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Size</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="18"
                        max="48"
                        value={editorFontSettings.titleFontSize}
                        onChange={(e) => setEditorFontSetting("titleFontSize", Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-sm text-text w-12 text-right">{editorFontSettings.titleFontSize}px</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Weight</label>
                    <select
                      value={editorFontSettings.titleFontWeight}
                      onChange={(e) => setEditorFontSetting("titleFontWeight", Number(e.target.value))}
                      className="w-40 px-2 py-1 text-sm bg-bg-muted border border-border rounded text-text"
                    >
                      {fontWeightOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Body Settings */}
              <div>
                <h3 className="text-sm font-medium text-text mb-3">Body</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Family</label>
                    <select
                      value={editorFontSettings.bodyFontFamily}
                      onChange={(e) => setEditorFontSetting("bodyFontFamily", e.target.value)}
                      className="w-40 px-2 py-1 text-sm bg-bg-muted border border-border rounded text-text"
                    >
                      {fontOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Size</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="12"
                        max="24"
                        value={editorFontSettings.bodyFontSize}
                        onChange={(e) => setEditorFontSetting("bodyFontSize", Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-sm text-text w-12 text-right">{editorFontSettings.bodyFontSize}px</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Font Weight</label>
                    <select
                      value={editorFontSettings.bodyFontWeight}
                      onChange={(e) => setEditorFontSetting("bodyFontWeight", Number(e.target.value))}
                      className="w-40 px-2 py-1 text-sm bg-bg-muted border border-border rounded text-text"
                    >
                      {fontWeightOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Line Height</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="1"
                        max="2.5"
                        step="0.1"
                        value={editorFontSettings.bodyLineHeight}
                        onChange={(e) => setEditorFontSetting("bodyLineHeight", Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-sm text-text w-12 text-right">{editorFontSettings.bodyLineHeight.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-muted">Paragraph Spacing</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.25"
                        value={editorFontSettings.bodyParagraphSpacing}
                        onChange={(e) => setEditorFontSetting("bodyParagraphSpacing", Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-sm text-text w-12 text-right">{editorFontSettings.bodyParagraphSpacing.toFixed(2)}em</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Font Preview */}
            <div className="mt-4 bg-bg-secondary rounded-lg border border-border p-6">
              <h3 className="text-xs font-medium text-text-muted mb-3 uppercase tracking-wider">Preview</h3>
              <div
                style={{
                  fontFamily: editorFontSettings.titleFontFamily,
                  fontSize: `${editorFontSettings.titleFontSize}px`,
                  fontWeight: editorFontSettings.titleFontWeight,
                  lineHeight: 1.2,
                }}
                className="text-text mb-4"
              >
                Sample Title
              </div>
              <div
                style={{
                  fontFamily: editorFontSettings.bodyFontFamily,
                  fontSize: `${editorFontSettings.bodyFontSize}px`,
                  fontWeight: editorFontSettings.bodyFontWeight,
                  lineHeight: editorFontSettings.bodyLineHeight,
                }}
                className="text-text"
              >
                <p style={{ marginBottom: `${editorFontSettings.bodyParagraphSpacing}em` }}>
                  This is a sample paragraph to preview how your body text will appear in the editor.
                  It includes enough text to demonstrate line height and spacing.
                </p>
                <p>
                  This is a second paragraph to show the paragraph spacing between blocks of text.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
