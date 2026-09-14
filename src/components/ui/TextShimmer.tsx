import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils";

export interface TextShimmerProps {
  children: string;
  className?: string;
  /** Seconds for one pass of the highlight. */
  duration?: number;
  /** Highlight width, in px per character. */
  spread?: number;
}

/**
 * A highlight that travels across the text, for work that is still in progress.
 * Ported from motion-primitives, using the app's own theme tokens so it reads
 * correctly in both light and dark.
 */
function TextShimmerComponent({
  children,
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const reducedMotion = useReducedMotion();
  const dynamicSpread = React.useMemo(
    () => children.length * spread,
    [children, spread],
  );

  return (
    <motion.span
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: reducedMotion ? "100% center" : "0% center" }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { repeat: Infinity, duration, ease: "linear" }
      }
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--color-text), transparent calc(50% + var(--spread))), linear-gradient(var(--color-text-muted), var(--color-text-muted))",
        } as React.CSSProperties
      }
    >
      {children}
    </motion.span>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
