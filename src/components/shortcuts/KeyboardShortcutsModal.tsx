import { useEffect, useCallback, useRef } from "react";
import { XIcon } from "../icons";
import { shortcutCategories } from "../../lib/shortcuts";

const modalCategories = shortcutCategories.filter(
  (c) => c.title !== "Settings",
);

function KeyboardKey({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text min-w-6.5 inline-flex items-center justify-center">
      {keyLabel}
    </kbd>
  );
}

function ShortcutRow({
  keys,
  description,
}: {
  keys: string[];
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex items-center gap-1.5 shrink-0">
        {keys.map((key) => (
          <KeyboardKey key={key} keyLabel={key} />
        ))}
      </div>
      <span className="text-sm text-text font-medium truncate">
        {description}
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
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      // Trap focus within the modal
      if (e.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
        <div className="flex items-center justify-between pl-5 pr-3 py-3 border-b border-border flex-none">
          <h2
            id="keyboard-shortcuts-title"
            className="text-lg font-medium text-text"
          >
            Shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-muted transition-colors"
          >
            <XIcon className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content — 3-column grid */}
        <div className="overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {modalCategories.map((category) => (
              <div key={category.title}>
                <h3 className="font-medium text-text mb-3">{category.title}</h3>
                <div className="space-y-0.5">
                  {category.shortcuts.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.description}
                      keys={shortcut.keys}
                      description={shortcut.description}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
