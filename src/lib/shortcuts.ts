import type { ShortcutAction, ShortcutSettings } from "../types/note";
import { alt, mod, shift } from "./platform";

export interface ParsedShortcut {
  key: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  openCommandPalette: "Mod+P",
  createNote: "Mod+N",
  reloadCurrentNote: "Mod+R",
  toggleAlwaysOnTop: "Mod+Shift+T",
  openMinimalEditor: "Mod+Shift+M",
  openSettings: "Mod+,",
  toggleSidebar: "Mod+\\",
  navigateNoteUp: "ArrowUp",
  navigateNoteDown: "ArrowDown",
  addOrEditLink: "Mod+K",
  bold: "Mod+B",
  italic: "Mod+I",
  copyAs: "Mod+Shift+C",
  findInNote: "Mod+F",
  settingsGeneralTab: "Mod+1",
  settingsAppearanceTab: "Mod+2",
  settingsShortcutsTab: "Mod+3",
};

const modifierAliases: Record<string, keyof Pick<ParsedShortcut, "mod" | "alt" | "shift">> = {
  mod: "mod",
  cmd: "mod",
  command: "mod",
  ctrl: "mod",
  control: "mod",
  meta: "mod",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

const namedKeyAliases: Record<string, string> = {
  comma: ",",
  period: ".",
  dot: ".",
  slash: "/",
  backslash: "\\",
  space: "Space",
  spacebar: "Space",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
};

const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift"]);

function normalizeKeyToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (namedKeyAliases[lower]) {
    return namedKeyAliases[lower];
  }

  if (trimmed.length === 1) {
    const char = trimmed;
    if (/[a-z]/i.test(char)) {
      return char.toUpperCase();
    }
    return char;
  }

  if (lower.startsWith("arrow")) {
    return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  }

  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
}

function normalizeEventKey(key: string): string | null {
  if (!key) return null;

  // macOS Option+Space can emit a non-breaking space instead of plain space.
  if (key === " " || (key.length === 1 && key.trim() === "")) return "Space";
  if (key === "Esc") return "Escape";

  if (key.length === 1) {
    if (/[a-z]/i.test(key)) {
      return key.toUpperCase();
    }
    return key;
  }

  return normalizeKeyToken(key);
}

function serializeShortcut(shortcut: ParsedShortcut): string {
  const parts: string[] = [];
  if (shortcut.mod) parts.push("Mod");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  parts.push(shortcut.key);
  return parts.join("+");
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const tokens = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const parsed: ParsedShortcut = {
    key: "",
    mod: false,
    alt: false,
    shift: false,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const modifier = modifierAliases[lower];
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }

    if (parsed.key) {
      return null;
    }

    const normalizedKey = normalizeKeyToken(token);
    if (!normalizedKey) return null;
    parsed.key = normalizedKey;
  }

  return parsed.key ? parsed : null;
}

export function normalizeShortcut(shortcut: string): string | null {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return null;
  return serializeShortcut(parsed);
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (modifierKeys.has(event.key)) {
    return null;
  }

  const key = normalizeEventKey(event.key);
  if (!key) return null;

  return serializeShortcut({
    key,
    mod: event.metaKey || event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
}

export function matchesParsedShortcut(
  event: KeyboardEvent,
  parsed: ParsedShortcut,
): boolean {
  const eventKey = normalizeEventKey(event.key);
  if (!eventKey) return false;

  const modPressed = event.metaKey || event.ctrlKey;
  if (parsed.mod !== modPressed) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;

  return parsed.key === eventKey;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  return matchesParsedShortcut(event, parsed);
}

export function resolveShortcutSettings(
  shortcutSettings?: ShortcutSettings,
): Record<ShortcutAction, string> {
  const resolved = { ...DEFAULT_SHORTCUTS };

  if (!shortcutSettings) {
    return resolved;
  }

  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const value = shortcutSettings[action];
    if (!value) continue;
    const normalized = normalizeShortcut(value);
    if (normalized) {
      resolved[action] = normalized;
    }
  }

  return resolved;
}

export function buildShortcutOverrides(
  shortcuts: Record<ShortcutAction, string>,
): ShortcutSettings {
  const overrides: ShortcutSettings = {};

  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const normalized = normalizeShortcut(shortcuts[action]);
    if (!normalized) continue;
    if (normalized !== DEFAULT_SHORTCUTS[action]) {
      overrides[action] = normalized;
    }
  }

  return overrides;
}

export function isDefaultShortcutSet(
  shortcuts: Record<ShortcutAction, string>,
): boolean {
  return (Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).every((action) => {
    const normalized = normalizeShortcut(shortcuts[action]);
    return normalized === DEFAULT_SHORTCUTS[action];
  });
}

export function getShortcutKeysForDisplay(shortcut: string): string[] {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return [shortcut];

  const displayKey =
    parsed.key === "ArrowUp"
      ? "↑"
      : parsed.key === "ArrowDown"
        ? "↓"
        : parsed.key;
  const keys: string[] = [];
  if (parsed.mod) keys.push(mod);
  if (parsed.alt) keys.push(alt);
  if (parsed.shift) keys.push(shift);
  keys.push(displayKey);
  return keys;
}

export function getShortcutDisplayText(shortcut: string): string {
  return getShortcutKeysForDisplay(shortcut).join(" ");
}
