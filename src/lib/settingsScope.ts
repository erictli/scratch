export const SETTINGS_CHANGED_DOM_EVENT = "scratch-settings-changed";

export interface SettingsChangedEvent {
  scope: "global" | "workspace";
  workspace: string | null;
}

export function shouldApplySettingsChange(
  event: SettingsChangedEvent,
  currentWorkspace: string | null,
): boolean {
  if (event.scope === "global") return true;
  return currentWorkspace !== null && event.workspace === currentWorkspace;
}
