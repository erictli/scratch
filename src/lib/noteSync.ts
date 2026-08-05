import type { Note } from "../types/note";

export type NoteSyncConflict =
  | { kind: "modified"; remote: Note }
  | { kind: "deleted"; remote: null };

export interface OpenNoteSyncState {
  note: Note | null;
  draft: string;
  dirty: boolean;
  conflict: NoteSyncConflict | null;
}

export function reconcileRemoteNote(
  state: OpenNoteSyncState,
  remote: Note | null,
): OpenNoteSyncState {
  if (remote === null) {
    if (!state.dirty) {
      return {
        note: null,
        draft: "",
        dirty: false,
        conflict: null,
      };
    }
    return {
      ...state,
      conflict: { kind: "deleted", remote: null },
    };
  }

  if (remote.revision === state.note?.revision) {
    return state;
  }

  if (state.dirty) {
    return {
      ...state,
      conflict: { kind: "modified", remote },
    };
  }

  return {
    note: remote,
    draft: remote.content,
    dirty: false,
    conflict: null,
  };
}

export interface NoteFileChangeDescriptor {
  kind: string;
  changed_ids: string[];
  previous_id?: string | null;
  current_id?: string | null;
}

export function resolveRemoteNoteId(
  currentId: string,
  event: NoteFileChangeDescriptor,
): string | null | undefined {
  if (event.previous_id === currentId) {
    if (event.kind === "deleted") return null;
    return event.current_id ?? null;
  }

  if (!event.changed_ids.includes(currentId)) return undefined;
  if (event.kind === "deleted") return null;
  return event.current_id ?? currentId;
}
