import { motion, type Variants } from "motion/react";
import { cn } from "../../lib/utils";

export type TextEffectPreset = "fade" | "blur" | "fade-in-blur" | "slide";

export interface TextEffectProps {
  children: string;
  className?: string;
  /** Whether segments are revealed word by word or character by character. */
  per?: "word" | "char";
  preset?: TextEffectPreset;
  /** Seconds before the reveal starts. */
  delay?: number;
}

const staggerPerSegment: Record<"word" | "char", number> = {
  word: 0.05,
  char: 0.03,
};

const itemVariants: Record<TextEffectPreset, Variants> = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  blur: {
    hidden: { opacity: 0, filter: "blur(12px)" },
    visible: { opacity: 1, filter: "blur(0px)" },
  },
  "fade-in-blur": {
    hidden: { opacity: 0, y: 20, filter: "blur(12px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
  slide: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  },
};

/**
 * Reveals text one segment at a time. Ported from motion-primitives, trimmed to
 * the one-shot reveal the app needs.
 */
export function TextEffect({
  children,
  className,
  per = "word",
  preset = "fade-in-blur",
  delay = 0,
}: TextEffectProps) {
  const segments = per === "word" ? children.split(/(\s+)/) : [...children];

  const container: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: staggerPerSegment[per], delayChildren: delay },
    },
  };

  return (
    <motion.p
      className={cn(className)}
      variants={container}
      initial="hidden"
      animate="visible"
    >
      {segments.map((segment, index) => (
        <motion.span
          key={`${segment}-${index}`}
          variants={itemVariants[preset]}
          className="inline-block whitespace-pre"
        >
          {segment}
        </motion.span>
      ))}
    </motion.p>
  );
}
