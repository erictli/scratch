import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckIcon, CopyIcon } from "../icons";
import { cn } from "../../lib/utils";

interface CodeCopyButtonProps {
  text: string;
  className?: string;
  iconClassName?: string;
  copyLabel?: string;
  copiedLabel?: string;
}

export function CodeCopyButton({
  text,
  className,
  iconClassName = "w-3.5 h-3.5 stroke-[1.7]",
  copyLabel = "Copy",
  copiedLabel = "Copied",
}: CodeCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);
  const isDisabled = !text.trim();
  const copyA11yLabel = copyLabel.trim() || "Copy code";
  const copiedA11yLabel = copiedLabel.trim() || "Copied";

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopied(true);

      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }

      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error("Failed to copy code block:", error);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1 text-xs h-6 px-1.5 rounded transition-colors",
        "text-text-muted hover:text-text hover:bg-bg-emphasis cursor-pointer",
        "disabled:opacity-50 disabled:cursor-default",
        className,
      )}
      type="button"
      title={copied ? copiedA11yLabel : copyA11yLabel}
      aria-label={copied ? copiedA11yLabel : copyA11yLabel}
      disabled={isDisabled}
    >
      {copied ? (
        <>
          <CheckIcon className={iconClassName} />
          {copiedLabel && copiedLabel}
        </>
      ) : (
        <>
          <CopyIcon className={iconClassName} />
          {copyLabel && copyLabel}
        </>
      )}
    </button>
  );
}
