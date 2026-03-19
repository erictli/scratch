import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from "react";
import { useNotes } from "../../context/NotesContext";
import { CommandItem } from "../ui";
import { AddNoteIcon } from "../icons";
import * as notesService from "../../services/notes";
import { formatTemplateName } from "../../lib/utils";

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
}

export function TemplatePicker({ open, onClose }: TemplatePickerProps) {
  const { createNoteFromTemplate } = useNotes();
  const [query, setQuery] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load templates and focus input when opened
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    notesService.listTemplates().then(setTemplates).catch(() => setTemplates([]));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      );
      selected?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  const filteredTemplates = query.trim()
    ? templates.filter((f) =>
        formatTemplateName(f).toLowerCase().includes(query.toLowerCase()),
      )
    : templates;

  const handleSelect = useCallback(
    (filename: string) => {
      createNoteFromTemplate(filename);
      onClose();
    },
    [createNoteFromTemplate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, filteredTemplates.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (filteredTemplates[selectedIndex]) {
            handleSelect(filteredTemplates[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [filteredTemplates, selectedIndex, handleSelect, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28 px-4 pointer-events-none">
      <div className="relative w-full max-w-lg bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down flex flex-col pointer-events-auto">
        {/* Search input */}
        <div className="border-b border-border flex-none">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Choose a template..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full px-4.5 py-3.5 text-[17px] bg-transparent outline-none text-text placeholder-text-muted/50"
          />
        </div>

        {/* Template list */}
        <div ref={listRef} className="overflow-y-auto max-h-80 p-2.5">
          {templates.length === 0 ? (
            <div className="px-2.5 py-4 text-sm text-text-muted">
              No templates found. Set a template folder in{" "}
              <span className="font-medium">Settings → General → Note Templates</span>.
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="px-2.5 py-4 text-sm text-text-muted">
              No templates match "{query}"
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredTemplates.map((filename, i) => (
                <div key={filename} data-index={i}>
                  <CommandItem
                    label={formatTemplateName(filename)}
                    icon={<AddNoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />}
                    isSelected={selectedIndex === i}
                    onClick={() => handleSelect(filename)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
