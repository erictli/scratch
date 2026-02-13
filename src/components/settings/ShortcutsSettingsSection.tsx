import { mod } from "../../lib/platform";

interface Shortcut {
  keys: string[];
  description: string;
  category?: string;
}

const shortcuts: Shortcut[] = [
  {
    keys: [mod, "P"],
    description: "Open command palette",
    category: "Navigation",
  },
  {
    keys: [mod, "N"],
    description: "Create new note",
    category: "Notes",
  },
  {
    keys: [mod, "R"],
    description: "Reload current note",
    category: "Notes",
  },
  {
    keys: [mod, ","],
    description: "Open settings",
    category: "Navigation",
  },
  {
    keys: [mod, "\\"],
    description: "Toggle sidebar",
    category: "Navigation",
  },
  {
    keys: [mod, "K"],
    description: "Add or edit link",
    category: "Editor",
  },
  {
    keys: [mod, "Shift", "C"],
    description: "Copy as (Markdown/Plain Text/HTML)",
    category: "Editor",
  },
  {
    keys: [mod, "F"],
    description: "Find in current note",
    category: "Editor",
  },
  {
    keys: [mod, "Shift", "M"],
    description: "Toggle Markdown source",
    category: "Editor",
  },
  {
    keys: [mod, "Shift", "Enter"],
    description: "Toggle Focus mode",
    category: "Editor",
  },
  {
    keys: ["/"],
    description: "Slash commands (at start of line)",
    category: "Editor",
  },
  {
    keys: [mod, "Shift", "F"],
    description: "Search notes",
    category: "Navigation",
  },
  {
    keys: [mod, "1"],
    description: "Go to General settings",
    category: "Settings",
  },
  {
    keys: [mod, "2"],
    description: "Go to Appearance settings",
    category: "Settings",
  },
  {
    keys: [mod, "3"],
    description: "Go to Shortcuts settings",
    category: "Settings",
  },
];

// Group shortcuts by category
const groupedShortcuts = shortcuts.reduce(
  (acc, shortcut) => {
    const category = shortcut.category || "General";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(shortcut);
    return acc;
  },
  {} as Record<string, Shortcut[]>,
);

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
      {keys.map((key, index) => (
        <KeyboardKey key={index} keyLabel={key} />
      ))}
    </div>
  );
}

export function ShortcutsSettingsSection() {
  const categoryOrder = ["Navigation", "Notes", "Editor", "Settings"];

  return (
    <div className="space-y-8 pb-8">
      {categoryOrder.map((category, idx) => {
        const categoryShortcuts = groupedShortcuts[category];
        if (!categoryShortcuts) return null;

        return (
          <div key={category}>
            {idx > 0 && (
              <div className="border-t border-border border-dashed" />
            )}
            <section>
              <h2 className="text-xl font-medium pt-6 mb-4">{category}</h2>
              <div className="space-y-3">
                {categoryShortcuts.map((shortcut, index) => (
                  <div
                    key={index}
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
