import { useEffect, useRef, useState, useCallback } from "react";
import katex from "katex";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { cn } from "../../lib/utils";
import { KATEX_OPTIONS, MATH_EDIT_EVENT } from "./mathConstants";

export function BlockMathView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [latex, setLatex] = useState(node.attrs.latex ?? "");
  const renderRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mountedEmptyRef = useRef(!(node.attrs.latex ?? "").trim());

  // Auto-enter editing for newly inserted empty nodes
  useEffect(() => {
    if (mountedEmptyRef.current) {
      mountedEmptyRef.current = false;
      setIsEditing(true);
    }
  }, []);

  // Sync local latex when node.attrs.latex changes from outside
  useEffect(() => {
    const attrsLatex = node.attrs.latex ?? "";
    if (!isEditing && attrsLatex !== latex) {
      setLatex(attrsLatex);
    }
  }, [node.attrs.latex, isEditing]);

  // Listen for Enter-key edit request via DOM event (O(1), no transaction broadcast)
  useEffect(() => {
    const outer = wrapperRef.current?.parentElement;
    if (!outer) return;
    const handler = () => setIsEditing(true);
    outer.addEventListener(MATH_EDIT_EVENT, handler);
    return () => outer.removeEventListener(MATH_EDIT_EVENT, handler);
  }, []);

  // Render KaTeX when not editing
  useEffect(() => {
    if (!isEditing && renderRef.current) {
      renderRef.current.innerHTML = "";
      const content = (node.attrs.latex ?? "").trim();
      if (content) {
        try {
          katex.render(content, renderRef.current, KATEX_OPTIONS);
        } catch {
          renderRef.current.textContent = content;
        }
      }
    }
  }, [node.attrs.latex, isEditing]);

  const commitEdit = useCallback(() => {
    const trimmed = latex.trim();
    updateAttributes({ latex: trimmed });
    setLatex(trimmed);
    setIsEditing(false);
  }, [latex, updateAttributes]);

  const cancelEdit = useCallback(() => {
    setLatex(node.attrs.latex ?? "");
    setIsEditing(false);
  }, [node.attrs.latex]);

  const exitAndFocus = useCallback(
    (pos: number) => {
      const { state } = editor;
      const safePos = Math.max(0, Math.min(pos, state.doc.content.size));
      editor.chain().focus().setTextSelection(safePos).run();
    },
    [editor],
  );

  // Focus without scrolling when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus({ preventScroll: true });
    }
  }, [isEditing]);

  // Auto-grow textarea height to fit content (no scrollbar)
  useEffect(() => {
    const ta = textareaRef.current;
    if (!isEditing || !ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [isEditing, latex]);

  if (isEditing) {
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        className={cn("math-block math-block--editing")}
        data-drag-handle
      >
        <textarea
          ref={textareaRef}
          className="math-block__textarea"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
            if (e.key === "ArrowUp" && textareaRef.current) {
              const { selectionStart, selectionEnd } = textareaRef.current;
              if (selectionStart === 0 && selectionEnd === 0) {
                e.preventDefault();
                commitEdit();
                const pos = typeof getPos === "function" ? getPos() : undefined;
                if (typeof pos === "number") exitAndFocus(pos);
              }
            }
            if (e.key === "ArrowDown" && textareaRef.current) {
              const { selectionStart, selectionEnd } = textareaRef.current;
              if (
                selectionStart === latex.length &&
                selectionEnd === latex.length
              ) {
                e.preventDefault();
                commitEdit();
                const pos = typeof getPos === "function" ? getPos() : undefined;
                if (typeof pos === "number") exitAndFocus(pos + node.nodeSize);
              }
            }
          }}
        />
      </NodeViewWrapper>
    );
  }

  const hasContent = (node.attrs.latex ?? "").trim();

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={cn("math-block", selected && "math-block--selected")}
      onDoubleClick={() => setIsEditing(true)}
      data-drag-handle
    >
      {hasContent ? (
        <div ref={renderRef} className="math-block__render" />
      ) : (
        <div className="math-block__placeholder">Click to add equation</div>
      )}
    </NodeViewWrapper>
  );
}
