import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";
import { CheckIcon, XIcon, LinkOffIcon } from "../icons";

export interface LinkEditorProps {
  initialUrl: string;
  onSubmit: (url: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

export interface LinkEditorRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const LinkEditor = forwardRef<LinkEditorRef, LinkEditorProps>(
  ({ initialUrl, onSubmit, onRemove, onCancel }, ref) => {
    const hasExistingLink = !!initialUrl;
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input on mount
    useEffect(() => {
      // Small delay to ensure the popup is positioned before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (event.key === "Escape") {
            onCancel();
            return true;
          }
          if (event.key === "Enter") {
            onSubmit(inputRef.current?.value || "");
            return true;
          }
          return false;
        },
      }),
      [onSubmit, onCancel]
    );

    const handleSubmit = () => {
      onSubmit(inputRef.current?.value || "");
    };

    return (
      <div className="link-editor-popup">
        <input
          ref={inputRef}
          type="url"
          defaultValue={initialUrl}
          placeholder="Enter URL..."
          className="link-editor-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="link-editor-button"
          title="Apply"
        >
          <CheckIcon className="w-3.5 h-3.5" />
        </button>
        {hasExistingLink && (
          <button
            type="button"
            onClick={onRemove}
            className="link-editor-button"
            title="Remove link"
          >
            <LinkOffIcon className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="link-editor-button"
          title="Cancel"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
);

LinkEditor.displayName = "LinkEditor";
