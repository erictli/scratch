import { getStyleProperty } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Color, TextStyle } from "@tiptap/extension-text-style";

export const TEXT_COLOR_OPTIONS = [
  { value: "#111827", light: "#111827", dark: "#f9fafb" },
  { value: "#6b7280", light: "#4b5563", dark: "#d1d5db" },
  { value: "#dc2626", light: "#b91c1c", dark: "#fca5a5" },
  { value: "#ea580c", light: "#9a3412", dark: "#fdba74" },
  { value: "#ca8a04", light: "#854d0e", dark: "#fde047" },
  { value: "#16a34a", light: "#166534", dark: "#86efac" },
  { value: "#0284c7", light: "#075985", dark: "#7dd3fc" },
  { value: "#7c3aed", light: "#6b21a8", dark: "#d8b4fe" },
  { value: "#db2777", light: "#9d174d", dark: "#f9a8d4" },
] as const;

export const HIGHLIGHT_COLOR_OPTIONS = [
  { value: "#d1d5db", light: "#f3f4f6", dark: "#29292b" },
  { value: "#fecaca", light: "#fee2e2", dark: "#352124" },
  { value: "#fed7aa", light: "#ffedd5", dark: "#35271f" },
  { value: "#fde047", light: "#fef9c3", dark: "#33301c" },
  { value: "#bbf7d0", light: "#dcfce7", dark: "#1c3023" },
  { value: "#bae6fd", light: "#e0f2fe", dark: "#1d2c34" },
  { value: "#ddd6fe", light: "#f3e8ff", dark: "#2c2435" },
  { value: "#fbcfe8", light: "#fce7f3", dark: "#34232d" },
] as const;

export const TEXT_COLORS = TEXT_COLOR_OPTIONS.map(({ value }) => value);
export const HIGHLIGHT_COLORS = HIGHLIGHT_COLOR_OPTIONS.map(
  ({ value }) => value,
);

const TEXT_COLOR_BY_VALUE = new Map<
  string,
  (typeof TEXT_COLOR_OPTIONS)[number]
>(
  TEXT_COLOR_OPTIONS.map((option) => [option.value, option]),
);
const HIGHLIGHT_COLOR_BY_VALUE = new Map<
  string,
  (typeof HIGHLIGHT_COLOR_OPTIONS)[number]
>(
  HIGHLIGHT_COLOR_OPTIONS.map((option) => [option.value, option]),
);

const SAFE_EDITOR_COLORS = new Set<string>([
  ...TEXT_COLORS,
  ...HIGHLIGHT_COLORS,
]);

function normalizeEditorColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return SAFE_EDITOR_COLORS.has(normalized) ? normalized : null;
}

export function isSafeEditorColor(value: unknown): value is string {
  return normalizeEditorColor(value) !== null;
}

export const ScratchColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              normalizeEditorColor(
                element.getAttribute("data-text-color") ||
                  getStyleProperty(element, "color") ||
                  element.style.color,
              ),
            renderHTML: (attributes: Record<string, unknown>) => {
              const color = normalizeEditorColor(attributes.color);
              const option = color ? TEXT_COLOR_BY_VALUE.get(color) : null;
              if (!color || !option) return {};

              return {
                "data-text-color": color,
                style: `--scratch-text-color-light: ${option.light}; --scratch-text-color-dark: ${option.dark}`,
              };
            },
          },
        },
      },
    ];
  },
});

export const ScratchTextStyle = TextStyle.extend({
  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node);
    const color = normalizeEditorColor(node.attrs?.color);

    if (!color) return content;
    return `<span style="color: ${color}">${content}</span>`;
  },
});

export const ScratchHighlight = Highlight.extend({
  addAttributes() {
    if (!this.options.multicolor) return {};

    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeEditorColor(
            element.getAttribute("data-color") ||
              getStyleProperty(element, "background-color") ||
              element.style.backgroundColor,
          ),
        renderHTML: (attributes: Record<string, unknown>) => {
          const color = normalizeEditorColor(attributes.color);
          const option = color ? HIGHLIGHT_COLOR_BY_VALUE.get(color) : null;
          if (!color || !option) return {};

          return {
            "data-color": color,
            style: `--scratch-highlight-color-light: ${option.light}; --scratch-highlight-color-dark: ${option.dark}`,
          };
        },
      },
    };
  },

  renderMarkdown(node, helpers) {
    const content = helpers.renderChildren(node);
    const rawColor = node.attrs?.color;

    if (!rawColor) return `==${content}==`;

    const color = normalizeEditorColor(rawColor);
    if (!color) return content;

    return `<mark data-color="${color}" style="background-color: ${color}; color: inherit">${content}</mark>`;
  },
});

export const ScratchSubscript = Subscript.extend({
  renderMarkdown(node, helpers) {
    return `<sub>${helpers.renderChildren(node)}</sub>`;
  },
});

export const ScratchSuperscript = Superscript.extend({
  renderMarkdown(node, helpers) {
    return `<sup>${helpers.renderChildren(node)}</sup>`;
  },
});
