import { useCallback, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { cn } from "../../lib/utils";
import { SIDEBAR_MIN_PX, SIDEBAR_MAX_PX } from "../../lib/sidebar";

/**
 * Drag handle rendered on the right edge of the sidebar.
 * Supports pointer drag to resize, keyboard arrow keys (Shift = large step), and double-click to reset width.
 */
export function SidebarResizeHandle() {
  const { sidebarWidthPx, setSidebarWidthPx, setSidebarWidthLive } = useTheme();

  const [isDragging, setIsDragging] = useState(false);
  const [currentWidth, setCurrentWidth] = useState(0);

  const dragState = useRef<{
    startX: number;
    initialWidth: number;
  } | null>(null);

  /** Captures the pointer and records the drag start position and initial width. */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      (e.currentTarget as HTMLElement).focus();

      const initialWidth =
        sidebarWidthPx ?? (e.currentTarget as HTMLElement).parentElement!.offsetWidth;
      dragState.current = {
        startX: e.clientX,
        initialWidth,
      };
      setIsDragging(true);
      setCurrentWidth(initialWidth);
      document.documentElement.classList.add("sidebar-no-transition");
    },
    [sidebarWidthPx],
  );

  /** Updates the CSS variable live during drag without persisting. */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const { startX, initialWidth } = dragState.current;

      const delta = e.clientX - startX;
      const newWidth = initialWidth + delta;
      const clamped = Math.round(
        Math.min(Math.max(newWidth, SIDEBAR_MIN_PX), SIDEBAR_MAX_PX),
      );

      setSidebarWidthLive(clamped);
      setCurrentWidth(clamped);
    },
    [setSidebarWidthLive],
  );

  /** Releases pointer capture and persists the final width to settings. */
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      document.documentElement.classList.remove("sidebar-no-transition");

      setSidebarWidthPx(currentWidth);
      dragState.current = null;
      setIsDragging(false);
    },
    [currentWidth, setSidebarWidthPx],
  );

  /** Aborts the drag on pointer cancel without saving any width change. */
  const handlePointerCancel = useCallback(() => {
    if (!dragState.current) return;
    document.documentElement.classList.remove("sidebar-no-transition");
    dragState.current = null;
    setIsDragging(false);
  }, []);

  /** Resets the sidebar to its default width (removes the override). */
  const handleDoubleClick = useCallback(() => {
    document.documentElement.classList.remove("sidebar-no-transition");
    setSidebarWidthPx(null);
  }, [setSidebarWidthPx]);

  /** Adjusts width with arrow keys (16 px step, 64 px with Shift); Home/End jump to bounds. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 64 : 16;
      const base =
        sidebarWidthPx ?? (e.currentTarget as HTMLElement).parentElement!.offsetWidth;
      let next: number | null = null;

      switch (e.key) {
        case "ArrowLeft":
          next = base - step;
          break;
        case "ArrowRight":
          next = base + step;
          break;
        case "Home":
          next = SIDEBAR_MIN_PX;
          break;
        case "End":
          next = SIDEBAR_MAX_PX;
          break;
        default:
          return;
      }

      e.preventDefault();
      setSidebarWidthPx(next);
    },
    [sidebarWidthPx, setSidebarWidthPx],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar width"
      aria-valuenow={sidebarWidthPx ?? undefined}
      aria-valuemin={SIDEBAR_MIN_PX}
      aria-valuemax={SIDEBAR_MAX_PX}
      tabIndex={0}
      className={cn(
        "absolute top-0 right-0 h-full w-1.5 cursor-col-resize pointer-events-auto group outline-none",
        isDragging && "z-20",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 top-0 h-full w-0.75 rounded-full bg-border transition-opacity duration-150",
          isDragging
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus:opacity-100",
        )}
      />
      {isDragging && (
        <div className="absolute top-3 right-2 z-50">
          <div className="bg-text text-text-inverse text-xs font-medium px-2.5 py-1 rounded-md shadow-lg whitespace-nowrap">
            {Math.round(currentWidth)}px
          </div>
        </div>
      )}
    </div>
  );
}
