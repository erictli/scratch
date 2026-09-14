import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

const DEFAULT_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface TextScrambleProps {
  children: string;
  className?: string;
  /** Seconds the scramble runs for. */
  duration?: number;
  /** Seconds between frames. */
  speed?: number;
  characterSet?: string;
  /** Re-runs the scramble whenever this value changes. Defaults to the text. */
  trigger?: unknown;
}

/**
 * Settles text into place from random characters. Ported from
 * motion-primitives; re-runs whenever `trigger` (the text, by default) changes.
 */
export function TextScramble({
  children,
  className,
  duration = 0.8,
  speed = 0.04,
  characterSet = DEFAULT_CHARS,
  trigger,
}: TextScrambleProps) {
  const [scrambled, setScrambled] = useState<string | null>(null);
  const frame = useRef<number>(0);
  // Read through a ref so editing the text mid-scramble doesn't restart it.
  const textRef = useRef(children);
  textRef.current = children;
  const runKey = trigger ?? children;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const text = textRef.current;
    const steps = duration / speed;
    frame.current = 0;

    const interval = window.setInterval(() => {
      const progress = frame.current / steps;
      let next = "";

      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === " ") {
          next += " ";
        } else if (progress * text.length > index) {
          next += character;
        } else {
          next +=
            characterSet[Math.floor(Math.random() * characterSet.length)];
        }
      }

      setScrambled(next);
      frame.current++;

      if (frame.current > steps) {
        window.clearInterval(interval);
        setScrambled(null);
      }
    }, speed * 1000);

    return () => window.clearInterval(interval);
  }, [runKey, duration, speed, characterSet, reducedMotion]);

  return <span className={className}>{scrambled ?? children}</span>;
}
