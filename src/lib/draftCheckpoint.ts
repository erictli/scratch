import type { Note } from "../types/note";

export interface DraftCheckpointKey {
  windowLabel: string;
  noteId: string;
}

export interface DraftCheckpointMetadata {
  sourcePath: string;
  baseRevision: string | null;
  updatedAt: string;
}

export interface DraftCheckpoint {
  key: DraftCheckpointKey;
  markdown: string;
  metadata: DraftCheckpointMetadata;
}

export interface DraftCheckpointStorage {
  write(checkpoint: DraftCheckpoint): Promise<void>;
  clear(key: DraftCheckpointKey): Promise<void>;
}

export type DraftCheckpointSaveOutcome = "saved" | "conflict";
export type DraftCheckpointVisibility = "hidden" | "visible";

export interface DraftCheckpointScheduler {
  markDirty(checkpoint: DraftCheckpoint): void;
  flush(): Promise<void>;
  handleSaveOutcome(
    outcome: DraftCheckpointSaveOutcome,
    key: DraftCheckpointKey,
  ): Promise<void>;
  handleVisibilityChange(visibility: DraftCheckpointVisibility): Promise<void>;
  dispose(): Promise<void>;
}

export interface DraftCheckpointSchedulerOptions {
  delayMs?: number;
  onError?: (error: unknown) => void;
}

export interface OpenDraftCheckpointSnapshot {
  noteId: string | null;
  content: string;
  dirty: boolean;
}

export function createDraftCheckpointSnapshot(
  windowLabel: string,
  draft: OpenDraftCheckpointSnapshot,
  note: Pick<Note, "path" | "revision"> | null,
  updatedAt: string,
): DraftCheckpoint | null {
  if (!draft.dirty || !draft.noteId || !note) return null;
  return {
    key: { windowLabel, noteId: draft.noteId },
    markdown: draft.content,
    metadata: {
      sourcePath: note.path,
      baseRevision: note.revision || null,
      updatedAt,
    },
  };
}

const DEFAULT_DELAY_MS = 1_000;

export function nextCheckpointCaptureDelay(
  elapsedMs: number,
  trailingDelayMs: number,
  maximumWaitMs: number,
): number {
  return Math.max(
    0,
    Math.min(trailingDelayMs, maximumWaitMs - Math.max(0, elapsedMs)),
  );
}

export function createDraftCheckpointScheduler(
  storage: DraftCheckpointStorage,
  options: DraftCheckpointSchedulerOptions = {},
): DraftCheckpointScheduler {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const onError = options.onError ?? (() => {});
  let pending: DraftCheckpoint | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let operationTail: Promise<void> = Promise.resolve();
  let disposed = false;

  const cancelTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = operationTail.then(operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const flush = (): Promise<void> => {
    cancelTimer();
    const checkpoint = pending;
    if (!checkpoint) return operationTail;
    pending = undefined;

    return enqueue(async () => {
      try {
        await storage.write(checkpoint);
      } catch (error) {
        pending ??= checkpoint;
        throw error;
      }
    });
  };

  const schedule = () => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(onError);
    }, delayMs);
  };

  return {
    markDirty(checkpoint) {
      if (disposed) throw new Error("Draft checkpoint scheduler is disposed");
      pending = cloneCheckpoint(checkpoint);
      schedule();
    },

    flush,

    handleSaveOutcome(outcome, keyToClear) {
      if (outcome === "conflict") return operationTail;
      if (pending && keysEqual(pending.key, keyToClear)) {
        pending = undefined;
        cancelTimer();
      }
      return enqueue(() => storage.clear(cloneKey(keyToClear)));
    },

    handleVisibilityChange(visibility) {
      if (visibility !== "hidden") return operationTail;
      return flush();
    },

    dispose() {
      disposed = true;
      return flush();
    },
  };
}

function cloneCheckpoint(checkpoint: DraftCheckpoint): DraftCheckpoint {
  return {
    key: cloneKey(checkpoint.key),
    markdown: checkpoint.markdown,
    metadata: { ...checkpoint.metadata },
  };
}

function cloneKey(key: DraftCheckpointKey): DraftCheckpointKey {
  return { ...key };
}

function keysEqual(left: DraftCheckpointKey, right: DraftCheckpointKey): boolean {
  return left.windowLabel === right.windowLabel && left.noteId === right.noteId;
}

export function reconcileDraftCheckpoint(
  diskNote: Note,
  checkpoint: DraftCheckpoint,
): {
  note: Note;
  remote: Note | null;
  recovered: boolean;
  shouldClear: boolean;
} {
  if (checkpoint.markdown === diskNote.content) {
    return {
      note: diskNote,
      remote: null,
      recovered: false,
      shouldClear: true,
    };
  }

  return {
    note: { ...diskNote, content: checkpoint.markdown },
    remote: diskNote,
    recovered: true,
    shouldClear: false,
  };
}
