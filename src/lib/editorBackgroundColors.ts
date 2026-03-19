export const lightEditorBackgroundColors = [
  "#FFF3B2",
  "#F8D98A",
  "#D9FCD1",
  "#D2E8FD",
  "#E0CCFF",
  "#F8C6C7",
] as const;

export const darkEditorBackgroundColors = [
  "#594D17",
  "#5C4314",
  "#1F4D2F",
  "#203B57",
  "#3F2B64",
  "#5A2B34",
] as const;

export const editorBackgroundColors = [
  ...lightEditorBackgroundColors,
  ...darkEditorBackgroundColors,
] as const;

export type EditorBackgroundColor = (typeof editorBackgroundColors)[number];

export function isEditorBackgroundColor(
  value: unknown,
): value is EditorBackgroundColor {
  return (
    typeof value === "string" &&
    editorBackgroundColors.includes(value as EditorBackgroundColor)
  );
}

export function getEditorBackgroundColorsForTheme(theme: "light" | "dark") {
  return theme === "dark"
    ? darkEditorBackgroundColors
    : lightEditorBackgroundColors;
}

export function getEditorBackgroundColorIndex(
  color: EditorBackgroundColor | null,
): number | null {
  if (!color) return null;

  const lightIndex = lightEditorBackgroundColors.indexOf(
    color as (typeof lightEditorBackgroundColors)[number],
  );
  if (lightIndex >= 0) return lightIndex;

  const darkIndex = darkEditorBackgroundColors.indexOf(
    color as (typeof darkEditorBackgroundColors)[number],
  );
  if (darkIndex >= 0) return darkIndex;

  return null;
}

export function getThemeAdjustedEditorBackgroundColor(
  color: EditorBackgroundColor | null,
  theme: "light" | "dark",
): EditorBackgroundColor | null {
  const index = getEditorBackgroundColorIndex(color);
  if (index == null) return color;

  return theme === "dark"
    ? darkEditorBackgroundColors[index]
    : lightEditorBackgroundColors[index];
}
