import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { SUPPORTED_LANGUAGES } from "./lowlight";
import { MermaidRenderer } from "./MermaidRenderer";
import {
  ChevronDownIcon,
  PencilIcon,
  EyeIcon,
  CopyIcon,
  CheckIcon,
} from "../icons";

const btnClass =
  "code-block-mermaid-btn inline-flex items-center gap-1 text-xs h-6 px-1.5 text-text-muted rounded cursor-pointer transition-colors hover:text-text hover:bg-bg-emphasis";

export function CodeBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const language: string = node.attrs.language || "";
  const isMermaid = language === "mermaid";
  const [showSource, setShowSource] = useState(!node.textContent.trim());
  const codeContent = node.textContent;

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeContent).then(
      () => {
        setCopied(true);
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard write rejected — silently ignore */
      },
    );
  }, [codeContent]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value });
    },
    [updateAttributes],
  );

  const toolbar = (
    <div className="code-block-language-selector" contentEditable={false}>
      {isMermaid && (
        <button
          contentEditable={false}
          onClick={() => setShowSource(!showSource)}
          className={btnClass}
          type="button"
        >
          {showSource ? (
            <>
              <EyeIcon className="w-3.5 h-3.5 stroke-[1.7]" />
              Preview
            </>
          ) : (
            <>
              <PencilIcon className="w-3.5 h-3.5 stroke-[1.7]" />
              Edit
            </>
          )}
        </button>
      )}
      <button
        contentEditable={false}
        onClick={handleCopy}
        className={btnClass}
        type="button"
        title="Copy code"
      >
        {copied ? (
          <CheckIcon className="w-3.5 h-3.5 stroke-[1.7]" />
        ) : (
          <CopyIcon className="w-3.5 h-3.5 stroke-[1.7]" />
        )}
      </button>
      <div className="relative flex items-center h-6">
        <select
          value={language}
          onChange={handleLanguageChange}
          className="appearance-none bg-transparent text-text-muted text-xs h-6 cursor-pointer outline-none pr-4 pl-1.5 rounded hover:bg-bg-emphasis transition-colors"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="w-3.25 h-3.25 stroke-[1.7] absolute right-1.25 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted" />
      </div>
    </div>
  );

  if (isMermaid && !showSource) {
    return (
      <NodeViewWrapper className="code-block-wrapper mermaid-wrapper" as="div">
        {toolbar}
        <div
          contentEditable={false}
          className="mermaid-preview rounded-lg bg-bg-muted p-4 my-1"
        >
          <MermaidRenderer code={codeContent} />
        </div>
        {/* Hidden but present for TipTap content tracking */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            overflow: "hidden",
            height: 0,
            opacity: 0,
          }}
        >
          <pre>
            {/* @ts-expect-error - "code" is a valid intrinsic element for NodeViewContent */}
            <NodeViewContent as="code" />
          </pre>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="code-block-wrapper" as="div">
      {toolbar}
      <pre>
        {/* @ts-expect-error - "code" is a valid intrinsic element for NodeViewContent */}
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
