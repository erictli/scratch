import { ClaudeIcon, CodexIcon, OpenCodeIcon, OllamaIcon } from "../icons";
import { mod } from "../../lib/platform";
import type { AiProvider } from "../../services/ai";
import { parseMarkdown } from "./markdown";

interface AiResponseToastProps {
  output: string;
  provider: AiProvider;
}

export function AiResponseToast({ output, provider }: AiResponseToastProps) {
  const Icon =
    provider === "codex"
      ? CodexIcon
      : provider === "opencode"
        ? OpenCodeIcon
      : provider === "ollama"
        ? OllamaIcon
        : ClaudeIcon;

  return (
    <div className="flex gap-3 items-start">
      <Icon className="w-4.5 h-4.5 shrink-0 mt-px" />
      <div className="flex-1 space-y-2 min-w-0">
        <div className="font-medium text-sm">AI Edit Complete</div>
        <div className="text-text-muted max-h-60 overflow-y-auto scrollbar-minimal pr-2">
          {parseMarkdown(output)}
        </div>
        <div className="text-xs text-text-muted mt-2 pt-2.5 border-t border-border border-dashed">
          Use {mod}+Z to undo changes
        </div>
      </div>
    </div>
  );
}
