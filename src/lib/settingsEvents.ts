export interface GitSettingsChangedEvent {
  notesFolder: string;
  gitEnabled: boolean | null;
}

export function isGitSettingsEventForFolder(
  event: GitSettingsChangedEvent,
  notesFolder: string | null,
): boolean {
  return notesFolder !== null && event.notesFolder === notesFolder;
}
