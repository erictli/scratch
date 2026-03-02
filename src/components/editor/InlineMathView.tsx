import { useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import katex from "katex";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { cn } from "../../lib/utils";
import { NodeSelection } from "@tiptap/pm/state";
import { KATEX_OPTIONS, MATH_EDIT_EVENT } from "./mathConstants";

const INLINE_KATEX_OPTIONS = { ...KATEX_OPTIONS, displayMode: false };

export function InlineMathView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const initialLatex = (node.attrs.latex ?? "").trim();
  const [isEditing, setIsEditing] = useState(() => !initialLatex);
  const [latex, setLatex] = useState(node.attrs.latex ?? "");
  const renderRef = useRef<HTMLSpanElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const attrsLatex = node.attrs.latex ?? "";
    if (!isEditing && attrsLatex !== latex) {
      setLatex(attrsLatex);
    }
  }, [node.attrs.latex, isEditing]);

  useEffect(() => {
    const outer = wrapperRef.current?.parentElement;
    if (!outer) return;
    const handler = () => {
      flushSync(() => setIsEditing(true));
    };
    outer.addEventListener(MATH_EDIT_EVENT, handler);
    return () => outer.removeEventListener(MATH_EDIT_EVENT, handler);
  }, []);

  // Only render KaTeX when not editing; never show rendered result during edit
  useEffect(() => {
    if (isEditing) {
      if (renderRef.current) renderRef.current.innerHTML = "";
      return;
    }
    if (renderRef.current) {
      renderRef.current.innerHTML = "";
      const content = (node.attrs.latex ?? "").trim();
      if (content) {
        try {
          katex.render(content, renderRef.current, INLINE_KATEX_OPTIONS);
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

  const commitAndMoveCursor = useCallback(
    (side: "before" | "after") => {
      const trimmed = latex.trim();
      updateAttributes({ latex: trimmed });
      setLatex(trimmed);
      setIsEditing(false);

      const pos = getPos();
      if (typeof pos !== "number") return;
      const target = side === "before" ? pos : pos + node.nodeSize;
      editor.commands.focus();
      editor.commands.setTextSelection(target);
    },
    [latex, updateAttributes, editor, getPos, node.nodeSize],
  );

  const cancelEdit = useCallback(() => {
    setLatex(node.attrs.latex ?? "");
    setIsEditing(false);
  }, [node.attrs.latex]);

  // Auto-enter edit mode only for NodeSelection (direct click / arrow-navigate),
  // not for TextSelection that spans across this node (e.g. Cmd+A).
  useEffect(() => {
    if (selected && !isEditing) {
      const { selection } = editor.state;
      if (selection instanceof NodeSelection) {
        flushSync(() => setIsEditing(true));
      }
    }
  }, [selected]);

  // Focus without scrolling when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        as="span"
        className={cn("inline-math inline-math--editing")}
        data-drag-handle
      >
        <input
          ref={inputRef}
          type="text"
          className="inline-math__input"
          style={{ width: `${Math.max(4, latex.length + 1)}ch` }}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              commitEdit();
              return;
            }
            const input = inputRef.current;
            if (!input) return;
            if (
              e.key === "ArrowLeft" &&
              input.selectionStart === 0 &&
              input.selectionEnd === 0
            ) {
              e.preventDefault();
              commitAndMoveCursor("before");
              return;
            }
            if (
              e.key === "ArrowRight" &&
              input.selectionStart === latex.length &&
              input.selectionEnd === latex.length
            ) {
              e.preventDefault();
              commitAndMoveCursor("after");
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
      as="span"
      className={cn("inline-math", selected && "inline-math--selected")}
      onDoubleClick={() => flushSync(() => setIsEditing(true))}
      data-drag-handle
    >
      {hasContent ? (
        <span ref={renderRef} className="inline-math__render" />
      ) : (
        <span className="inline-math__placeholder">$</span>
      )}
    </NodeViewWrapper>
  );
}
