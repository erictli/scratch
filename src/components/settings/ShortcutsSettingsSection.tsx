import { shortcutCategories } from "../../lib/shortcuts";

// Render individual key as keyboard button
function KeyboardKey({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text min-w-6.5 inline-flex items-center justify-center">
      {keyLabel}
    </kbd>
  );
}

// Render shortcut keys
function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {keys.map((key) => (
        <KeyboardKey key={key} keyLabel={key} />
      ))}
    </div>
  );
}

// Categories to show in settings (exclude Markdown Syntax)
const settingsCategories = ["Navigation", "Notes", "Editor", "Settings"];

export function ShortcutsSettingsSection() {
  return (
    <div className="space-y-8 pb-8">
      {settingsCategories.map((categoryName, idx) => {
        const category = shortcutCategories.find(
          (c) => c.title === categoryName,
        );
        if (!category) return null;

        return (
          <div key={categoryName}>
            {idx > 0 && (
              <div className="border-t border-border border-dashed" />
            )}
            <section>
              <h2 className="text-xl font-medium pt-8 mb-4">
                {categoryName}
              </h2>
              <div className="space-y-3">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-text font-medium">
                      {shortcut.description}
                    </span>
                    <ShortcutKeys keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
