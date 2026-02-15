import { ClaudeIcon, CodexIcon } from "../icons";
import { mod } from "../../lib/platform";
import type { AiProvider } from "../../services/ai";

interface AiResponseToastProps {
  output: string;
  provider: AiProvider;
}

// Simple markdown-to-React converter for basic formatting
function parseMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = (index: number) => {
    if (listItems.length > 0) {
      const ListTag = listType === "ol" ? "ol" : "ul";
      elements.push(
        <ListTag
          key={`list-${index}`}
          className={
            listType === "ol"
              ? "list-decimal list-inside space-y-0.5 my-1"
              : "list-disc list-inside space-y-0.5 my-1"
          }
        >
          {listItems.map((item, i) => (
            <li key={i} className="text-xs">
              {parseInlineMarkdown(item)}
            </li>
          ))}
        </ListTag>,
      );
      listItems = [];
      listType = null;
    }
  };

  lines.forEach((line, index) => {
    // Code blocks
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${index}`}
            className="bg-bg-secondary rounded px-2 py-1 my-1 overflow-x-auto"
          >
            <code className="text-xs font-mono">
              {codeBlockContent.join("\n")}
            </code>
          </pre>,
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        flushList(index);
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    // Unordered list items
    if (line.match(/^\s*[-*]\s+/)) {
      if (listType !== "ul") {
        flushList(index);
        listType = "ul";
      }
      listItems.push(line.replace(/^\s*[-*]\s+/, ""));
      return;
    }

    // Ordered list items
    if (line.match(/^\s*\d+\.\s+/)) {
      if (listType !== "ol") {
        flushList(index);
        listType = "ol";
      }
      listItems.push(line.replace(/^\s*\d+\.\s+/, ""));
      return;
    }

    // Headers - render as bold text
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList(index);
      const headerText = headerMatch[2];
      elements.push(
        <p key={`header-${index}`} className="text-xs my-1 font-semibold">
          {parseInlineMarkdown(headerText)}
        </p>,
      );
      return;
    }

    // Regular line
    flushList(index);
    if (line.trim()) {
      elements.push(
        <p key={`line-${index}`} className="text-xs my-1">
          {parseInlineMarkdown(line)}
        </p>,
      );
    } else if (elements.length > 0) {
      // Empty line adds spacing
      elements.push(<div key={`space-${index}`} className="h-1" />);
    }
  });

  // Flush any unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre
        key={`code-unclosed`}
        className="bg-bg-secondary rounded px-2 py-1 my-1 overflow-x-auto"
      >
        <code className="text-xs font-mono">
          {codeBlockContent.join("\n")}
        </code>
      </pre>,
    );
  }

  flushList(lines.length);

  return elements;
}

function parseInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Order matters: code first (to avoid processing markdown inside code)
  const patterns = [
    {
      // Inline code: `code`
      regex: /`([^`]+)`/g,
      render: (match: string) => (
        <code
          key={key++}
          className="bg-bg-secondary rounded px-1 py-0.5 font-mono text-xs"
        >
          {match}
        </code>
      ),
    },
    {
      // Bold: **text** or __text__
      regex: /(\*\*|__)(.+?)\1/g,
      render: (match: string) => (
        <strong key={key++} className="font-semibold">
          {match}
        </strong>
      ),
    },
    {
      // Italic: *text* or _text_ (but not ** or __)
      regex: /(?<!\*)\*(?!\*)(.+?)\*(?!\*)|(?<!_)_(?!_)(.+?)_(?!_)/g,
      render: (match: string) => (
        <em key={key++} className="italic">
          {match}
        </em>
      ),
    },
  ];

  patterns.forEach(({ regex, render }) => {
    const newParts: React.ReactNode[] = [];
    const currentParts = parts.length > 0 ? parts : [remaining];

    currentParts.forEach((part) => {
      if (typeof part !== "string") {
        newParts.push(part);
        return;
      }

      let lastIndex = 0;
      const matches = Array.from(part.matchAll(regex));

      matches.forEach((match) => {
        if (match.index! > lastIndex) {
          newParts.push(part.slice(lastIndex, match.index));
        }
        // Extract the captured group (content without markers)
        const content = match[2] || match[1];
        newParts.push(render(content));
        lastIndex = match.index! + match[0].length;
      });

      if (lastIndex < part.length) {
        newParts.push(part.slice(lastIndex));
      }
    });

    parts.splice(0, parts.length, ...newParts);
  });

  return parts.length > 0 ? parts : remaining;
}

export function AiResponseToast({ output, provider }: AiResponseToastProps) {
  const Icon = provider === "codex" ? CodexIcon : ClaudeIcon;

  return (
    <div className="flex gap-3 items-start">
      <Icon className="w-4.5 h-4.5 shrink-0 mt-px" />
      <div className="flex-1 space-y-2 min-w-0">
        <div className="font-medium text-sm">AI Edit Complete</div>
        <div className="text-text-muted max-h-60 overflow-y-auto pr-2">
          {parseMarkdown(output)}
        </div>
        <div className="text-xs text-text-muted mt-2 pt-2.5 border-t border-border border-dashed">
          Use {mod}+Z to undo changes
        </div>
      </div>
    </div>
  );
}
