import { mod, shift } from "./platform";

export interface Shortcut {
  keys: string[];
  description: string;
}

export interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

export const shortcutCategories: ShortcutCategory[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: [mod, "P"], description: "Command palette" },
      { keys: [mod, shift, "F"], description: "Search notes" },
      { keys: [mod, "\\"], description: "Toggle sidebar" },
      { keys: [mod, ","], description: "Settings" },
      { keys: [mod, "/"], description: "Keyboard shortcuts" },
      { keys: [mod, "W"], description: "Close window" },
      { keys: [mod, "="], description: "Zoom in" },
      { keys: [mod, "-"], description: "Zoom out" },
      { keys: [mod, "0"], description: "Reset zoom" },
    ],
  },
  {
    title: "Notes",
    shortcuts: [
      { keys: [mod, "N"], description: "New note" },
      { keys: [mod, "D"], description: "Duplicate note" },
      { keys: [mod, "R"], description: "Reload note" },
      { keys: ["Delete"], description: "Delete note" },
      { keys: [mod, "Backspace"], description: "Delete note" },
      { keys: ["↑", "↓"], description: "Navigate notes" },
      { keys: ["Enter"], description: "Focus editor" },
      { keys: ["Esc"], description: "Back to note list" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: [mod, "B"], description: "Bold" },
      { keys: [mod, "I"], description: "Italic" },
      { keys: [mod, "K"], description: "Add / edit link" },
      { keys: [mod, "F"], description: "Find in note" },
      { keys: [mod, shift, "C"], description: "Copy & Export" },
      { keys: [mod, shift, "M"], description: "Markdown source" },
      { keys: [mod, shift, "Enter"], description: "Focus mode" },
      { keys: ["/"], description: "Slash commands" },
    ],
  },
  {
    title: "Settings",
    shortcuts: [
      { keys: [mod, "1"], description: "General" },
      { keys: [mod, "2"], description: "Appearance" },
      { keys: [mod, "3"], description: "Shortcuts" },
      { keys: [mod, "4"], description: "About" },
    ],
  },
  {
    title: "Markdown Syntax",
    shortcuts: [
      { keys: ["#"], description: "Heading 1" },
      { keys: ["##"], description: "Heading 2" },
      { keys: ["###"], description: "Heading 3" },
      { keys: ["**bold**"], description: "Bold text" },
      { keys: ["*italic*"], description: "Italic text" },
      { keys: ["~~text~~"], description: "Strikethrough" },
      { keys: ["-"], description: "Bullet list" },
      { keys: ["1."], description: "Numbered list" },
      { keys: ["- [ ]"], description: "Task list" },
      { keys: [">"], description: "Blockquote" },
      { keys: ["`code`"], description: "Inline code" },
      { keys: ["```"], description: "Code block" },
      { keys: ["---"], description: "Horizontal rule" },
      { keys: ["[text](url)"], description: "Link" },
      { keys: ["[[Note]]"], description: "Wikilink" },
      { keys: ["![alt](url)"], description: "Image" },
      { keys: ["| | |"], description: "Table" },
      { keys: ["$$...$$"], description: "Block math" },
      { keys: ["```mermaid"], description: "Mermaid diagram" },
    ],
  },
];
