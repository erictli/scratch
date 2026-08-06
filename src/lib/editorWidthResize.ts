/**
 * Existing settings files do not contain this preference, so mouse resizing
 * remains enabled unless the user explicitly turns it off.
 */
export function resolveEditorWidthResizeEnabled(
  value: boolean | undefined,
): boolean {
  return value !== false;
}
