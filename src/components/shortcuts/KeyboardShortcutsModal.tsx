import { useEffect, useCallback, useRef } from "react";
import { mod, shift } from "../../lib/platform";
import { XIcon } from "../icons";

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

const categories: ShortcutCategory[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: [mod, "P"], description: "Command palette" },
      { keys: [mod, shift, "F"], description: "Search notes" },
      { keys: [mod, "\\"], description: "Toggle sidebar" },
      { keys: [mod, ","], description: "Settings" },
      { keys: [mod, "W"], description: "Close window" },
      { keys: [mod, "="], description: "Zoom in" },
      { keys: [mod, "-"], description: "Zoom out" },
      { keys: [mod, "0"], description: "Reset zoom" },
      { keys: [mod, "/"], description: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Notes",
    shortcuts: [
      { keys: [mod, "N"], description: "New note" },
      { keys: [mod, "D"], description: "Duplicate note" },
      { keys: [mod, "R"], description: "Reload note" },
      { keys: ["Delete"], description: "Delete note" },
      { keys: ["\u2191", "\u2193"], description: "Navigate notes" },
      { keys: ["Enter"], description: "Focus editor" },
      { keys: ["Esc"], description: "Back to note list" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: [mod, "B"], description: "Bold" },
      { keys: [mod, "I"], description: "Italic" },
      { keys: [mod, "K"], description: "Add / edit link" },
      { keys: [mod, "F"], description: "Find in note" },
      { keys: [mod, shift, "C"], description: "Copy & Export" },
      { keys: [mod, shift, "M"], description: "Markdown source" },
      { keys: [mod, shift, "Enter"], description: "Focus mode" },
      { keys: ["/"], description: "Slash commands" },
    ],
  },
  {
    title: "Markdown Syntax",
    shortcuts: [
      { keys: ["#"], description: "Heading 1" },
      { keys: ["##"], description: "Heading 2" },
      { keys: ["###"], description: "Heading 3" },
      { keys: ["-"], description: "Bullet list" },
      { keys: ["1."], description: "Numbered list" },
      { keys: [">"], description: "Blockquote" },
      { keys: ["`code`"], description: "Inline code" },
      { keys: ["```"], description: "Code block" },
      { keys: ["---"], description: "Horizontal rule" },
      { keys: ["- [ ]"], description: "Task list" },
      { keys: ["**bold**"], description: "Bold text" },
      { keys: ["*italic*"], description: "Italic text" },
      { keys: ["[text](url)"], description: "Link" },
      { keys: ["![alt](url)"], description: "Image" },
    ],
  },
];

function KeyboardKey({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="text-[11px] leading-none px-1.5 py-1 rounded-md bg-bg-muted text-text min-w-[22px] inline-flex items-center justify-center font-medium">
      {keyLabel}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex items-center gap-1 shrink-0">
        {shortcut.keys.map((key, i) => (
          <KeyboardKey key={i} keyLabel={key} />
        ))}
      </div>
      <span className="text-sm text-text-muted truncate">
        {shortcut.description}
      </span>
    </div>
  );
}

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
      tabIndex={-1}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 bg-bg rounded-xl shadow-2xl border border-border animate-slide-down overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border flex-none">
          <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-text">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
          >
            <XIcon className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content — multi-column grid */}
        <div className="overflow-y-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {categories.map((category) => (
              <div key={category.title}>
                <h3 className="text-sm font-semibold text-text mb-3">
                  {category.title}
                </h3>
                <div className="space-y-0.5">
                  {category.shortcuts.map((shortcut, i) => (
                    <ShortcutRow key={i} shortcut={shortcut} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Markdown guide link */}
          <div className="mt-8 pt-4 border-t border-border border-dashed text-center">
            <a
              href="https://www.markdownguide.org/cheat-sheet/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-muted hover:text-text underline underline-offset-2 transition-colors"
            >
              Full Markdown Guide
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
