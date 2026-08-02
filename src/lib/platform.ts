/**
 * Platform detection utilities for cross-platform shortcut labels.
 * On macOS: ⌘, ⌥, ⇧
 * On Windows/Linux: Ctrl, Alt, Shift
 */

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export const isWindows =
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

export function fileManagerNameForUserAgent(userAgent: string): string {
  if (/Mac|iPhone|iPad|iPod/.test(userAgent)) return "Finder";
  if (/Windows/.test(userAgent)) return "Explorer";
  return "File Manager";
}

export function revealInFileManagerLabelForUserAgent(
  userAgent: string,
): string {
  return `Reveal in ${fileManagerNameForUserAgent(userAgent)}`;
}

const currentUserAgent =
  typeof navigator !== "undefined" ? navigator.userAgent : "";

export const revealInFileManagerLabel =
  revealInFileManagerLabelForUserAgent(currentUserAgent);

/** Modifier key symbol/label */
export const mod = isMac ? "⌘" : "Ctrl";
export const alt = isMac ? "⌥" : "Alt";
export const shift = isMac ? "⇧" : "Shift";

/**
 * Build a shortcut label string.
 * e.g. shortcut("B") => "⌘B" on Mac, "Ctrl+B" on Windows
 */
export function shortcut(...parts: string[]): string {
  if (isMac) {
    return parts.join("");
  }
  return parts.join("+");
}
