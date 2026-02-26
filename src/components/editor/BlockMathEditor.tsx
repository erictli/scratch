import { useEffect, useRef, useState } from "react";
import { CheckIcon, XIcon } from "../icons";
import { IconButton } from "../ui";

export interface BlockMathEditorProps {
  initialLatex: string;
  onSubmit: (latex: string) => void;
  onCancel: () => void;
}

export const BlockMathEditor = ({
  initialLatex,
  onSubmit,
  onCancel,
}: BlockMathEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState(initialLatex);

  useEffect(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  }, []);

  const handleSubmit = () => {
    onSubmit(latex);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      e.stopPropagation();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 bg-bg border border-border rounded-lg shadow-md p-1.5 w-84">
      <textarea
        ref={textareaRef}
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter KaTeX expression..."
        className="w-full h-30 resize-y rounded-md border border-border bg-bg px-2.5 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <div className="flex items-center justify-end gap-1 mr-0.5 mb-0.5">
        <IconButton
          type="button"
          onClick={handleSubmit}
          title="Apply (Cmd/Ctrl+Enter)"
          size="xs"
          variant="ghost"
        >
          <CheckIcon className="w-4.5 h-4.5 stroke-[1.5]" />
        </IconButton>
        <IconButton
          type="button"
          onClick={onCancel}
          title="Cancel"
          size="xs"
          variant="ghost"
        >
          <XIcon className="w-4.5 h-4.5 stroke-[1.5]" />
        </IconButton>
      </div>
    </div>
  );
};
