import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { cn } from "../../lib/utils";
import { ChevronDownIcon } from "../icons";
import { jumpToHeading, useActiveHeading, type HeadingEntry } from "./useActiveHeading";

/** The focused heading preceded by its enclosing headings, outermost first. */
function sectionPath(headings: HeadingEntry[], activeIndex: number): HeadingEntry[] {
  const active = headings[activeIndex];
  if (!active) return [];
  const path = [active];
  let level = active.level;
  for (let i = activeIndex - 1; i >= 0 && level > 1; i--) {
    if (headings[i].level < level) {
      path.unshift(headings[i]);
      level = headings[i].level;
    }
  }
  return path;
}

/** Expanding eases out with a long, soft landing; collapsing is shorter so it never feels sluggish. */
const EXPAND_MS = 280;
const COLLAPSE_MS = 160;
const EXPAND_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 1, 1)";

/**
 * Line along the bottom of the bar that fills as the note scrolls. It writes the transform directly,
 * so scrolling re-renders nothing and restyles only this element. Empty when the note fits the window.
 */
function ReadingProgress({ editor, scrollContainerRef }: Omit<SectionPathProps, "hidden">) {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollable = container.scrollHeight - container.clientHeight;
      const progress = scrollable > 0 ? Math.min(container.scrollTop / scrollable, 1) : 0;
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`;
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    // Typing, images loading and width changes all move the scrollable distance without scrolling
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(container);
    observer.observe(editor.view.dom);
    return () => {
      container.removeEventListener("scroll", scheduleUpdate);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, scrollContainerRef]);

  return (
    <div
      ref={barRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-text-muted"
    />
  );
}

interface SectionPathProps {
  editor: TiptapEditor;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** The filename bar covers the path: it closes the dropdown and stops taking input. */
  hidden: boolean;
}

/**
 * Breadcrumb of the section in view, such as "My big title / the story". When it doesn't fit, the
 * enclosing headings shorten first so the innermost one stays whole; only then does it shorten too.
 * It takes its own row above the note, with the reading progress along its bottom edge. Clicking it
 * opens the tree of all headings to jump to.
 */
export const SectionPath = memo(function SectionPath({
  editor,
  scrollContainerRef,
  hidden,
}: SectionPathProps) {
  const { headings, activeIndex } = useActiveHeading(editor, scrollContainerRef);
  const path = useMemo(() => sectionPath(headings, activeIndex), [headings, activeIndex]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const expanded = open && !hidden && headings.length > 0;
  // The panel stays mounted while collapsing, and mounts collapsed so that expanding animates
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  const panelTransition = {
    transitionDuration: `${shown ? EXPAND_MS : COLLAPSE_MS}ms`,
    transitionTimingFunction: shown ? EXPAND_EASING : COLLAPSE_EASING,
  };

  useEffect(() => {
    if (expanded) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [expanded]);

  if (path.length === 0) return null;

  return (
    <div
      ref={rootRef}
      inert={hidden}
      className="relative z-10 h-6 border-b border-border"
    >
      <div className="flex h-full items-center px-4 text-xs text-text-muted">
        <button
          type="button"
          aria-label="Show headings"
          aria-expanded={expanded}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 cursor-pointer items-center rounded text-left hover:text-text"
        >
          {path.map((heading, i) => {
            const isLast = i === path.length - 1;
            return (
              <span key={heading.pos} className={isLast ? "flex min-w-0" : "flex min-w-[2ch] shrink-[1000]"}>
                <span className={isLast ? "truncate font-medium text-text" : "truncate"}>
                  {heading.text || "Untitled"}
                </span>
                {!isLast && <span className="shrink-0 px-1.5 text-text-muted/60">/</span>}
              </span>
            );
          })}
          <span
            className={cn(
              "ml-auto flex shrink-0 transition-transform motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            style={{
              transitionDuration: `${expanded ? EXPAND_MS : COLLAPSE_MS}ms`,
              transitionTimingFunction: expanded ? EXPAND_EASING : COLLAPSE_EASING,
            }}
          >
            <ChevronDownIcon className="h-3.5 w-3.5 stroke-[1.7]" />
          </span>
        </button>
      </div>
      <ReadingProgress editor={editor} scrollContainerRef={scrollContainerRef} />
      {mounted && (
        <div
          inert={!expanded}
          className={cn(
            "absolute inset-x-0 top-6 grid border-b border-border bg-bg shadow-lg transition-[grid-template-rows,opacity] motion-reduce:transition-none",
            shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
          style={panelTransition}
        >
          <div className="max-h-[60vh] min-h-0 overflow-y-auto overscroll-contain scrollbar-none">
            <div className="py-1">
              {headings.map((heading, index) => (
                <button
                  key={heading.pos}
                  type="button"
                  onClick={() => {
                    jumpToHeading(editor, heading.pos);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full cursor-pointer truncate py-1 pr-6 text-left text-xs transition-[opacity,transform] motion-reduce:transition-none hover:bg-bg-muted",
                    !shown && "-translate-y-1 opacity-0",
                    index === activeIndex ? "font-medium text-text" : "text-text-muted",
                  )}
                  style={{ paddingLeft: `${16 + (heading.level - 1) * 14}px`, ...panelTransition }}
                >
                  {heading.text || "Untitled"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
