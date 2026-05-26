import { useRef, useLayoutEffect } from "react";

/**
 * A lightweight hook to perform smooth FLIP (First, Last, Invert, Play) reordering animations
 * on direct children of a container ref when a dependency changes.
 */
export function useFlipAnimation(_dependency: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const children = Array.from(containerRef.current.children) as HTMLElement[];

    // 1. Measure all children in their NEW DOM positions (bypassing any active FLIP transforms)
    const currentRects = new Map<string, DOMRect>();
    for (const child of children) {
      const id = child.getAttribute("data-id") || child.id;
      if (id) {
        const originalTransform = child.style.transform;
        const originalTransition = child.style.transition;
        const isAnimating = !!(child as any)._flipCleanup;

        if (isAnimating) {
          // Temporarily disable both transition and transform to query the static layout position
          child.style.transition = "none";
          child.style.transform = "none";
          currentRects.set(id, child.getBoundingClientRect());
          child.style.transition = originalTransition;
          child.style.transform = originalTransform;
        } else if (originalTransform && originalTransform !== "none") {
          child.style.transform = "none";
          currentRects.set(id, child.getBoundingClientRect());
          child.style.transform = originalTransform;
        } else {
          currentRects.set(id, child.getBoundingClientRect());
        }
      }
    }

    // 2. Run the FLIP animation for elements that changed position since the last commit
    for (const child of children) {
      const id = child.getAttribute("data-id") || child.id;
      if (!id) continue;

      let firstRect = rectsRef.current.get(id);
      const lastRect = currentRects.get(id);

      if (firstRect && lastRect) {
        // If there is an active transition from a previous commit, clean it up first.
        // We measure the current mid-flight visual position BEFORE cleaning up
        // to ensure a perfectly seamless transition from the interrupted state.
        const isAnimating = !!(child as any)._flipCleanup;
        if (isAnimating) {
          firstRect = child.getBoundingClientRect();
          (child as any)._flipCleanup();
        }

        const deltaY = firstRect.top - lastRect.top;
        const deltaX = firstRect.left - lastRect.left;

        if (deltaY !== 0 || deltaX !== 0) {
          // Disable transitions temporarily
          const originalTransition = child.style.transition;
          child.style.transition = "none";
          child.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;

          // Trigger reflow/repaint to apply the invert state
          child.offsetHeight;

          // Smoothly animate back to the new DOM position (Play)
          child.style.transition = "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)";
          child.style.transform = "translate3d(0, 0, 0)";

          const cleanup = () => {
            child.style.transition = originalTransition;
            child.style.transform = "";
            child.removeEventListener("transitionend", onTransitionEnd);
            (child as any)._flipCleanup = null;
          };

          const onTransitionEnd = (e: TransitionEvent) => {
            if (e.propertyName === "transform") {
              cleanup();
            }
          };

          child.addEventListener("transitionend", onTransitionEnd);
          (child as any)._flipCleanup = cleanup;
        }
      }
    }

    // 3. Save the untransformed (new layout) positions for the next commit
    rectsRef.current = currentRects;
  }); // Runs on every commit to keep track of the latest stable positions

  return containerRef;
}

