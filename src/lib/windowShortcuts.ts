export type WindowShortcutAction =
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "preferences";

export interface WindowShortcutEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function resolveWindowShortcut(
  event: WindowShortcutEvent,
): WindowShortcutAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;

  if (event.key === "=" || event.key === "+") return "zoom-in";
  if (event.key === "-" || event.key === "_") return "zoom-out";
  if (event.key === "0") return "zoom-reset";
  if (event.code === "Equal" || event.code === "NumpadAdd") return "zoom-in";
  if (event.code === "Minus" || event.code === "NumpadSubtract") {
    return "zoom-out";
  }
  if (event.code === "Digit0" || event.code === "Numpad0") {
    return "zoom-reset";
  }
  if (event.key === ",") return "preferences";
  return null;
}
