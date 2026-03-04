import { useCallback, useState } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { SUPPORTED_LANGUAGES } from "./lowlight";
import { MermaidRenderer } from "./MermaidRenderer";
import { ChevronDownIcon, PencilIcon, EyeIcon } from "../icons";

export function CodeBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const language: string = node.attrs.language || "";
  const isMermaid = language === "mermaid";
  const [showSource, setShowSource] = useState(!node.textContent.trim());
  const codeContent = node.textContent;

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value });
    },
    [updateAttributes],
  );

  const mermaidButton = isMermaid ? (
    showSource ? (
      <button
        contentEditable={false}
        onClick={() => setShowSource(false)}
        className="code-block-mermaid-btn inline-flex items-center gap-1 text-xs px-1.5 py-0.5 text-text-muted rounded cursor-pointer transition-colors hover:text-text hover:bg-bg-emphasis"
        type="button"
      >
        <EyeIcon className="w-3.5 h-3.5 stroke-[1.7]" />
        Preview
      </button>
    ) : (
      <button
        contentEditable={false}
        onClick={() => setShowSource(true)}
        className="code-block-mermaid-btn inline-flex items-center gap-1 text-xs px-1.5 py-0.5 text-text-muted rounded cursor-pointer transition-colors hover:text-text hover:bg-bg-emphasis"
        type="button"
      >
        <PencilIcon className="w-3.5 h-3.5 stroke-[1.7]" />
        Edit
      </button>
    )
  ) : null;

  const toolbar = (
    <div className="code-block-language-selector" contentEditable={false}>
      {mermaidButton}
      <div className="relative">
        <select
          value={language}
          onChange={handleLanguageChange}
          className="appearance-none bg-transparent text-text-muted text-xs cursor-pointer outline-none pr-4 pl-1.5 py-0.5 rounded hover:bg-bg-emphasis transition-colors"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="w-3.5 h-3.5 stroke-[1.7] absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted" />
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
