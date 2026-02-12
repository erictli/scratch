import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTheme } from "../../context/ThemeContext";
import type { ShortcutAction } from "../../types/note";
import {
  getShortcutKeysForDisplay,
  isDefaultShortcutSet,
  shortcutFromKeyboardEvent,
} from "../../lib/shortcuts";

type ShortcutCategory = "Navigation" | "Notes" | "Editor" | "Settings";

interface EditableShortcutRow {
  type: "editable";
  action: ShortcutAction;
  description: string;
  category: ShortcutCategory;
}

interface StaticShortcutRow {
  type: "static";
  keys: string[];
  description: string;
  category: ShortcutCategory;
}

type ShortcutRow = EditableShortcutRow | StaticShortcutRow;

const shortcutRows: ShortcutRow[] = [
  {
    type: "editable",
    action: "openCommandPalette",
    description: "Open command palette",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "openSettings",
    description: "Open settings",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "toggleSidebar",
    description: "Toggle sidebar",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "toggleAlwaysOnTop",
    description: "Toggle always on top",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "navigateNoteUp",
    description: "Navigate note list up",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "navigateNoteDown",
    description: "Navigate note list down",
    category: "Navigation",
  },
  {
    type: "editable",
    action: "createNote",
    description: "Create new note",
    category: "Notes",
  },
  {
    type: "editable",
    action: "reloadCurrentNote",
    description: "Reload current note",
    category: "Notes",
  },
  {
    type: "editable",
    action: "addOrEditLink",
    description: "Add or edit link",
    category: "Editor",
  },
  {
    type: "editable",
    action: "bold",
    description: "Bold",
    category: "Editor",
  },
  {
    type: "editable",
    action: "italic",
    description: "Italic",
    category: "Editor",
  },
  {
    type: "editable",
    action: "copyAs",
    description: "Copy as (Markdown/Plain Text/HTML)",
    category: "Editor",
  },
  {
    type: "editable",
    action: "findInNote",
    description: "Find in current note",
    category: "Editor",
  },
  {
    type: "editable",
    action: "settingsGeneralTab",
    description: "Go to General settings",
    category: "Settings",
  },
  {
    type: "editable",
    action: "settingsAppearanceTab",
    description: "Go to Appearance settings",
    category: "Settings",
  },
  {
    type: "editable",
    action: "settingsShortcutsTab",
    description: "Go to Shortcuts settings",
    category: "Settings",
  },
];

// Group shortcuts by category
const groupedShortcuts = shortcutRows.reduce(
  (acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  },
  {} as Record<ShortcutCategory, ShortcutRow[]>,
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
      {keys.map((key) => (
        <KeyboardKey key={key} keyLabel={key} />
      ))}
    </div>
  );
}

export function ShortcutsSettingsSection() {
  const { shortcuts, setShortcut, resetShortcuts } = useTheme();
  const [capturingAction, setCapturingAction] = useState<ShortcutAction | null>(
    null,
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const categoryOrder: ShortcutCategory[] = [
    "Navigation",
    "Notes",
    "Editor",
    "Settings",
  ];
  const hasCustomShortcuts = !isDefaultShortcutSet(shortcuts);

  // Capture keys globally while recording so Escape works even if focus changes.
  useEffect(() => {
    if (!capturingAction) return;

    const handleCaptureKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setCapturingAction(null);
        setCaptureError(null);
        return;
      }

      const nextShortcut = shortcutFromKeyboardEvent(event);
      if (!nextShortcut) return;

      const saved = setShortcut(capturingAction, nextShortcut);
      if (saved) {
        setCapturingAction(null);
        setCaptureError(null);
      } else {
        setCaptureError(
          "This shortcut must include Cmd/Ctrl. Note navigation can be plain keys.",
        );
      }
    };

    window.addEventListener("keydown", handleCaptureKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleCaptureKeyDown, true);
    };
  }, [capturingAction, setShortcut]);

  return (
    <div className="space-y-8 pb-8">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium">Keyboard Shortcuts</h2>
          {hasCustomShortcuts && (
            <Button onClick={resetShortcuts} variant="ghost" size="sm">
              Reset to defaults
            </Button>
          )}
        </div>
        <p className="text-sm text-text-muted">
          Click a shortcut and press your preferred key combination. Press
          Escape to cancel. Most shortcuts require Cmd/Ctrl, except note
          navigation.
        </p>
        {captureError && <p className="text-sm text-orange-500">{captureError}</p>}
      </section>

      {categoryOrder.map((category, idx) => {
        const categoryShortcuts = groupedShortcuts[category];
        if (!categoryShortcuts) return null;

        return (
          <div key={category}>
            {idx > 0 && <div className="border-t border-border border-dashed" />}
            <section>
              <h3 className="text-xl font-medium pt-6 mb-4">{category}</h3>
              <div className="space-y-3">
                {categoryShortcuts.map((shortcut) => {
                  if (shortcut.type === "editable") {
                    const isCapturing = capturingAction === shortcut.action;
                    const keys = getShortcutKeysForDisplay(
                      shortcuts[shortcut.action],
                    );

                    return (
                      <div
                        key={shortcut.action}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="text-sm text-text font-medium">
                          {shortcut.description}
                        </span>
                        <button
                          type="button"
                          className="min-w-36 h-8 px-2.5 rounded-md border border-border hover:bg-bg-muted transition-colors text-left flex items-center justify-center"
                          onClick={() => {
                            setCapturingAction(shortcut.action);
                            setCaptureError(null);
                          }}
                        >
                          {isCapturing ? (
                            <span className="text-xs text-text-muted">
                              Recording...
                            </span>
                          ) : (
                            <ShortcutKeys keys={keys} />
                          )}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="text-sm text-text font-medium">
                        {shortcut.description}
                      </span>
                      <ShortcutKeys keys={shortcut.keys} />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
