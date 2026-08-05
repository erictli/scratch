/**
 * Existing settings files do not contain this preference. Keep the fixed
 * formatting toolbar hidden until the user explicitly enables it.
 */
export function resolveEditorToolbarVisible(
  value: boolean | undefined,
): boolean {
  return value === true;
}
