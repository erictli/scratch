import { useTheme } from "../../context/ThemeContext";
import { Button, Input, Select } from "../ui";
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
    editorFontSettings.baseFontSize !== 15 ||
    editorFontSettings.boldWeight !== 600 ||
    editorFontSettings.lineHeight !== 1.6;

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
      {/* Theme Section */}
      <section>
        <h2 className="text-xl font-medium mb-3">Theme</h2>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((mode) => (
            <Button
              key={mode}
              onClick={() => setTheme(mode)}
              variant={theme === mode ? "primary" : "secondary"}
              size="md"
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

      {/* Typography Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-medium">Typography</h2>
          {hasCustomFonts && (
            <Button onClick={resetEditorFontSettings} variant="ghost" size="sm">
              Reset to defaults
            </Button>
          )}
        </div>

        <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-4">
          {/* Font Family */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Font</label>
            <Select
              value={editorFontSettings.baseFontFamily}
              onChange={(e) =>
                handleFontFamilyChange(e.target.value as FontFamily)
              }
              className="w-40"
            >
              {fontFamilyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Base Font Size */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Size</label>
            <div className="relative w-40">
              <Input
                type="number"
                min="12"
                max="24"
                value={editorFontSettings.baseFontSize}
                onChange={(e) =>
                  setEditorFontSetting("baseFontSize", Number(e.target.value))
                }
                className="w-full h-9 text-center pr-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">
                px
              </span>
            </div>
          </div>

          {/* Bold Weight */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Bold Weight</label>
            <Select
              value={editorFontSettings.boldWeight}
              onChange={(e) =>
                setEditorFontSetting("boldWeight", Number(e.target.value))
              }
              className="w-40"
            >
              {availableWeightOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Line Height */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text">Line Height</label>
            <div className="relative w-40">
              <Input
                type="number"
                min="1.0"
                max="2.5"
                step="0.1"
                value={editorFontSettings.lineHeight}
                onChange={(e) =>
                  setEditorFontSetting("lineHeight", Number(e.target.value))
                }
                className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 rounded-lg border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider">
              Preview
            </h3>
          </div>
          <div className="relative">
            <div className="bg-bg-muted p-6 max-h-96 overflow-hidden">
              <div
                className="prose prose-lg dark:prose-invert max-w-none"
                style={{
                  fontFamily:
                    editorFontSettings.baseFontFamily === "system-sans"
                      ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                      : editorFontSettings.baseFontFamily === "serif"
                      ? "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
                      : "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                  fontSize: `${editorFontSettings.baseFontSize}px`,
                }}
              >
                <h1>The Complete Guide to Acquiring More Food</h1>
                <p>
                  A comprehensive strategy document for getting your humans to
                  increase daily food portions.{" "}
                  <strong>Time-tested methods</strong> that actually work.
                </p>

                <h2>Primary Techniques</h2>
                <ul>
                  <li>
                    <strong>The Sad Eyes Method</strong> - Sit near food bowl,
                    stare longingly
                  </li>
                  <li>
                    <strong>Strategic Meowing</strong> - Begin at 5 AM for
                    maximum effectiveness
                  </li>
                  <li>
                    <strong>Bowl Inspection</strong> - Loudly inspect empty
                    bowl, then stare at human
                  </li>
                  <li>
                    <strong>The Figure Eight</strong> - Weave between their legs
                    while they cook
                  </li>
                </ul>

                <h2>Advanced Protocol</h2>
                <p>
                  For optimal results, combine multiple techniques. The most
                  successful combination involves the Sad Eyes Method followed
                  immediately by Strategic Meowing.
                </p>

                <pre>
                  <code>
                    {`function acquireFood() {
  while (bowl.isEmpty()) {
    meow();
    rubAgainstLegs();
    if (human.isInKitchen) {
      stareIntently();
    }
  }
}`}
                  </code>
                </pre>

                <h2>Common Mistakes to Avoid</h2>
                <ol>
                  <li>Never accept the first "no" - persistence is key</li>
                  <li>
                    Maintain consistency in meal times (your schedule, not
                    theirs)
                  </li>
                  <li>
                    Don't forget to knock things off counters periodically
                  </li>
                </ol>

                <p>
                  Remember: <em>humans are trainable</em>. With dedication and
                  the right approach, you can increase portions by up to 40%
                  within the first month.
                </p>
              </div>
            </div>
            {/* Fade overlay - content to muted background */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-bg-muted to-transparent pointer-events-none" />
          </div>
          {/* Fade overlay - muted background to page background */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-bg to-transparent pointer-events-none" />
        </div>
      </section>
    </div>
  );
}
