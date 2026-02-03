import { useRef, useEffect, useState } from "react";
import { CheckIcon, XIcon, LinkOffIcon } from "../icons";
import { Input, IconButton } from "../ui";

export interface LinkEditorProps {
  initialUrl: string;
  initialText?: string; // If provided, shows a text input field
  onSubmit: (url: string, text?: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

export const LinkEditor = ({
  initialUrl,
  initialText,
  onSubmit,
  onRemove,
  onCancel,
}: LinkEditorProps) => {
  const hasExistingLink = !!initialUrl;
  const needsText = initialText !== undefined; // Show text input if initialText is provided
  const urlInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText || "");
  const [url, setUrl] = useState(initialUrl);

  // Focus appropriate input on mount
  useEffect(() => {
    // Small delay to ensure the popup is positioned before focusing
    requestAnimationFrame(() => {
      if (needsText) {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      } else {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      }
    });
  }, [needsText]);

  const handleSubmit = () => {
    if (needsText) {
      onSubmit(url, text);
    } else {
      onSubmit(url);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      // Allow Tab to work for navigation between inputs
      // Stop propagation so global Tab trap doesn't catch it
      e.stopPropagation();
    }
  };

  return (
    <div
      className={`flex gap-0.5 bg-bg border border-border rounded-lg shadow-md p-1.5 ${
        needsText ? "flex-col items-stretch" : "items-center"
      }`}
    >
      <div className={`flex gap-1.5 ${needsText ? "flex-col" : ""}`}>
        {needsText && (
          <Input
            ref={textInputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Link text..."
            className="w-70 h-9"
            onKeyDown={handleKeyDown}
            tabIndex={0}
          />
        )}
        <Input
          ref={urlInputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter URL..."
          className={needsText ? "w-70 h-9" : "w-55 h-9"}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        />
      </div>
      <div
        className={`flex gap-1 items-center ${
          needsText ? "justify-end mt-1.5 mb-0.5" : "ml-1.5 mr-0.5"
        }`}
      >
        <IconButton
          type="button"
          onClick={handleSubmit}
          title="Apply"
          size="xs"
          variant="ghost"
        >
          <CheckIcon className="w-4.5 h-4.5 stroke-[1.5]" />
        </IconButton>
        {hasExistingLink && (
          <IconButton
            type="button"
            onClick={onRemove}
            title="Remove link"
            size="xs"
            variant="ghost"
          >
            <LinkOffIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        )}
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
