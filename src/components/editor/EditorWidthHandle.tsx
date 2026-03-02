import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTheme } from "../../context/ThemeContext";
import type { EditorWidth } from "../../types/note";

// Preset widths in px (rem * 16) for snap detection
const PRESET_PX: { width: EditorWidth; px: number }[] = [
  { width: "narrow", px: 576 },
  { width: "normal", px: 768 },
  { width: "wide", px: 1024 },
];

const MIN_WIDTH = 480;
const SNAP_THRESHOLD = 20;

interface EditorWidthHandlesProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

export function EditorWidthHandles({ containerRef }: EditorWidthHandlesProps) {
  const {
    editorWidth,
    customEditorWidthPx,
    setEditorWidth,
    setCustomEditorWidthPx,
    setEditorMaxWidthLive,
  } = useTheme();

  const [isDragging, setIsDragging] = useState(false);
  const [dragWidth, setDragWidth] = useState(0);
  const [snappedPreset, setSnappedPreset] = useState<EditorWidth | null>(null);
  const [handleOffset, setHandleOffset] = useState(0);

  const dragState = useRef<{
    startX: number;
    initialWidth: number;
    side: "left" | "right";
    containerWidth: number;
  } | null>(null);

  // Compute handle offset based on container and editor width
  const updateHandleOffset = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const proseMirror =
      containerRef.current.querySelector<HTMLElement>(".ProseMirror");
    if (proseMirror) {
      const maxWidth = getComputedStyle(proseMirror).maxWidth;
      if (maxWidth && maxWidth !== "none") {
        const editorPx =
          maxWidth === "100%" ? containerWidth : parseFloat(maxWidth);
        const clampedEditor = Math.min(editorPx, containerWidth);
        setHandleOffset((containerWidth - clampedEditor) / 2);
        return;
      }
    }
    setHandleOffset(0);
  }, [containerRef]);

  // Re-calculate offset when editor width or container resizes
  useEffect(() => {
    updateHandleOffset();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => updateHandleOffset());
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, updateHandleOffset, editorWidth, customEditorWidthPx]);

  const getCurrentEditorWidth = useCallback((): number => {
    if (!containerRef.current) return 768;
    const proseMirror = containerRef.current.querySelector(".ProseMirror");
    if (proseMirror) {
      const maxWidth = getComputedStyle(proseMirror).maxWidth;
      if (maxWidth && maxWidth !== "none" && maxWidth !== "100%") {
        return parseFloat(maxWidth);
      }
    }
    if (editorWidth === "custom") return customEditorWidthPx;
    if (editorWidth === "full")
      return containerRef.current.clientWidth;
    const preset = PRESET_PX.find((p) => p.width === editorWidth);
    return preset?.px ?? 768;
  }, [containerRef, editorWidth, customEditorWidthPx]);

  const handlePointerDown = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const containerWidth = containerRef.current?.clientWidth ?? 1200;
      const initialWidth = Math.min(
        getCurrentEditorWidth(),
        containerWidth
      );

      dragState.current = {
        startX: e.clientX,
        initialWidth,
        side,
        containerWidth,
      };
      setIsDragging(true);
      setDragWidth(initialWidth);
      setSnappedPreset(null);
    },
    [containerRef, getCurrentEditorWidth]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const { startX, initialWidth, side, containerWidth } = dragState.current;

      const delta = e.clientX - startX;
      const newWidth =
        side === "right"
          ? initialWidth + delta * 2
          : initialWidth - delta * 2;

      const clamped = Math.max(MIN_WIDTH, Math.min(newWidth, containerWidth));

      // Snap check
      let snapped: EditorWidth | null = null;
      let finalWidth = clamped;
      for (const preset of PRESET_PX) {
        if (
          Math.abs(clamped - preset.px) < SNAP_THRESHOLD &&
          preset.px <= containerWidth
        ) {
          snapped = preset.width;
          finalWidth = preset.px;
          break;
        }
      }

      setSnappedPreset(snapped);
      setDragWidth(finalWidth);
      setEditorMaxWidthLive(`${finalWidth}px`);

      // Update handle offset live during drag
      setHandleOffset((containerWidth - finalWidth) / 2);
    },
    [setEditorMaxWidthLive]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

      if (snappedPreset) {
        setEditorWidth(snappedPreset);
      } else {
        setCustomEditorWidthPx(Math.round(dragWidth));
      }

      dragState.current = null;
      setIsDragging(false);
    },
    [snappedPreset, dragWidth, setEditorWidth, setCustomEditorWidthPx]
  );

  const handleDoubleClick = useCallback(() => {
    setEditorWidth("normal");
  }, [setEditorWidth]);

  // Don't render handles if full width (nothing to resize)
  if (editorWidth === "full" && !isDragging) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* Width indicator during drag */}
      {isDragging && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-text text-text-inverse text-xs font-medium px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap">
            {snappedPreset
              ? `${snappedPreset.charAt(0).toUpperCase() + snappedPreset.slice(1)} (${Math.round(dragWidth)}px)`
              : `${Math.round(dragWidth)}px`}
          </div>
        </div>
      )}

      {/* Left handle */}
      <div
        className={`absolute top-0 h-full w-3 cursor-col-resize pointer-events-auto group ${isDragging ? "z-20" : ""}`}
        style={{ left: `${handleOffset - 6}px` }}
        onPointerDown={(e) => handlePointerDown("left", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className={`absolute left-1/2 -translate-x-1/2 top-0 h-full w-[3px] rounded-full bg-border transition-opacity duration-150 ${
            isDragging
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>

      {/* Right handle */}
      <div
        className={`absolute top-0 h-full w-3 cursor-col-resize pointer-events-auto group ${isDragging ? "z-20" : ""}`}
        style={{ right: `${handleOffset - 6}px` }}
        onPointerDown={(e) => handlePointerDown("right", e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className={`absolute left-1/2 -translate-x-1/2 top-0 h-full w-[3px] rounded-full bg-border transition-opacity duration-150 ${
            isDragging
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </div>
    </div>
  );
}
