import { useEffect, useState, useRef, memo } from "react";

interface FlipTextProps {
  text: string;
  className?: string;
  /** Whether to animate changes. When false, text updates instantly. */
  animate?: boolean;
}

// Split-flap display animation for text changes
// Optimized to use single timing mechanism and minimize re-renders
export const FlipText = memo(function FlipText({
  text,
  className = "",
  animate = true
}: FlipTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTextRef = useRef(text);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const prevText = prevTextRef.current;
    const newText = text;

    // If same text, just ensure display is correct
    if (prevText === newText) {
      setDisplayText(newText);
      return;
    }

    // If animation disabled, update instantly
    if (!animate) {
      setDisplayText(newText);
      prevTextRef.current = newText;
      return;
    }

    // Cancel any ongoing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    // Pad both strings to same length
    const maxLen = Math.max(prevText.length, newText.length);
    const paddedPrev = prevText.padEnd(maxLen, " ");
    const paddedNew = newText.padEnd(maxLen, " ");

    // Initialize with previous text
    let chars = paddedPrev.split("");
    setDisplayText(chars.join(""));
    setIsAnimating(true);
    prevTextRef.current = newText;

    // Animation timing constants
    const charDelay = 45; // ms between each character
    const initialDelay = 60; // ms before starting

    // Use a single requestAnimationFrame loop for smooth animation
    startTimeRef.current = 0;

    const animateFrame = (timestamp: number) => {
      if (startTimeRef.current === 0) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;

      // Calculate how many characters should be revealed
      const charsToReveal = Math.floor((elapsed - initialDelay) / charDelay);

      if (elapsed < initialDelay) {
        // Still in initial delay
        animationRef.current = requestAnimationFrame(animateFrame);
        return;
      }

      if (charsToReveal >= maxLen) {
        // Animation complete
        setDisplayText(newText);
        setIsAnimating(false);
        return;
      }

      // Update characters up to the current reveal point
      let changed = false;
      for (let i = 0; i <= charsToReveal && i < maxLen; i++) {
        if (chars[i] !== paddedNew[i]) {
          chars[i] = paddedNew[i];
          changed = true;
        }
      }

      if (changed) {
        setDisplayText(chars.join("").trimEnd() || chars.join(""));
      }

      animationRef.current = requestAnimationFrame(animateFrame);
    };

    animationRef.current = requestAnimationFrame(animateFrame);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, animate]);

  // Use a single span with CSS transitions for smoother rendering
  return (
    <span
      className={`inline-block ${className} ${isAnimating ? "animate-flip-text" : ""}`}
      aria-label={text}
    >
      {displayText}
    </span>
  );
});
