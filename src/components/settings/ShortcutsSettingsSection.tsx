import { mod, isMac } from "../../lib/platform";

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
    keys: [mod, "B"],
    description: "Bold",
    category: "Editor",
  },
  {
    keys: [mod, "I"],
    description: "Italic",
    category: "Editor",
  },
  {
    keys: [mod, "Shift", "C"],
    description: "Copy as (Markdown/Plain Text/HTML)",
    category: "Editor",
  },
  {
    keys: ["↑", "↓"],
    description: "Navigate note list",
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
];

// Group shortcuts by category
const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
  const category = shortcut.category || "General";
  if (!acc[category]) {
    acc[category] = [];
  }
  acc[category].push(shortcut);
  return acc;
}, {} as Record<string, Shortcut[]>);

// Render individual key as keyboard button
function KeyboardKey({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 text-xs font-medium text-text bg-bg-secondary border border-border rounded shadow-sm">
      {keyLabel}
    </kbd>
  );
}

// Render shortcut keys
function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, index) => (
        <KeyboardKey key={index} keyLabel={key} />
      ))}
    </div>
  );
}

export function ShortcutsSettingsSection() {
  const categoryOrder = ["Navigation", "Notes", "Editor", "Settings"];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-medium mb-0.5">Keyboard Shortcuts</h2>
        <p className="text-sm text-text-muted mb-4">
          Shortcuts shown for {isMac ? "macOS" : "Windows/Linux"}
        </p>

        <div className="space-y-6">
          {categoryOrder.map((category) => {
            const categoryShortcuts = groupedShortcuts[category];
            if (!categoryShortcuts) return null;

            return (
              <div key={category}>
                <h3 className="text-sm font-semibold text-text mb-2.5">
                  {category}
                </h3>
                <div className="space-y-2">
                  {categoryShortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-bg-secondary/50 transition-colors"
                    >
                      <span className="text-sm text-text">
                        {shortcut.description}
                      </span>
                      <ShortcutKeys keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
