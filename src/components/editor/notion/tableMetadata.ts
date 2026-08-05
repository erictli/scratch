import { Extension, getStyleProperty } from "@tiptap/core";
import { HIGHLIGHT_COLOR_OPTIONS } from "./markdownMarks";

export const TABLE_BACKGROUND_COLOR_OPTIONS = HIGHLIGHT_COLOR_OPTIONS;
export const MIN_TABLE_COLUMN_WIDTH = 80;

export function normalizeTableColumnWidth(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(parsed));
}

const TABLE_BACKGROUND_COLOR_BY_VALUE = new Map<
  string,
  (typeof TABLE_BACKGROUND_COLOR_OPTIONS)[number]
>(
  TABLE_BACKGROUND_COLOR_OPTIONS.map((option) => [option.value, option]),
);

export function normalizeTableBackgroundColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return TABLE_BACKGROUND_COLOR_BY_VALUE.has(normalized) ? normalized : null;
}

function parseBooleanAttribute(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export const ScratchTableMetadata = Extension.create({
  name: "scratchTableMetadata",

  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          fitToWidth: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-fit-to-width") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.fitToWidth === true
                ? { "data-fit-to-width": "true" }
                : {},
          },
          headerRow: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              parseBooleanAttribute(element.getAttribute("data-header-row")),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.headerRow === "boolean"
                ? { "data-header-row": String(attributes.headerRow) }
                : {},
          },
          headerColumn: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              parseBooleanAttribute(
                element.getAttribute("data-header-column"),
              ),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.headerColumn === "boolean"
                ? { "data-header-column": String(attributes.headerColumn) }
                : {},
          },
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              normalizeTableBackgroundColor(
                element.getAttribute("data-table-background-color") ||
                  getStyleProperty(element, "background-color") ||
                  element.style.backgroundColor,
              ),
            renderHTML: (attributes: Record<string, unknown>) => {
              const color = normalizeTableBackgroundColor(
                attributes.backgroundColor,
              );
              const option = color
                ? TABLE_BACKGROUND_COLOR_BY_VALUE.get(color)
                : null;
              if (!color || !option) return {};

              return {
                "data-table-background-color": color,
                style: `--scratch-table-background-light: ${option.light}; --scratch-table-background-dark: ${option.dark}`,
              };
            },
          },
        },
      },
    ];
  },
});
