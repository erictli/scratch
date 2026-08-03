export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSession {
  workspace: string;
  selectedNoteId: string | null;
  sidebarVisible: boolean;
  focusMode: boolean;
  geometry: WindowGeometry | null;
}

export interface WindowSessionPatch {
  selectedNoteId?: string | null;
  sidebarVisible?: boolean;
  focusMode?: boolean;
  geometry?: WindowGeometry | null;
}

export interface RestoredWindowSession {
  selectedNoteId: string | null;
  sidebarVisible: boolean;
  focusMode: boolean;
  geometry: WindowGeometry | null;
}

interface RestoreWindowSessionOptions {
  isPreview: boolean;
  workspace: string;
  noteIds: readonly string[];
  load: () => Promise<WindowSession | null>;
}

export const DEFAULT_RESTORED_WINDOW_SESSION: RestoredWindowSession = {
  selectedNoteId: null,
  sidebarVisible: true,
  focusMode: false,
  geometry: null,
};

function safeWindowSessionDefaults(): RestoredWindowSession {
  return { ...DEFAULT_RESTORED_WINDOW_SESSION };
}

export async function restoreWindowSession({
  isPreview,
  workspace,
  noteIds,
  load,
}: RestoreWindowSessionOptions): Promise<RestoredWindowSession> {
  if (isPreview) return safeWindowSessionDefaults();

  try {
    const saved = await load();
    if (!saved || saved.workspace !== workspace) {
      return safeWindowSessionDefaults();
    }

    const selectedNoteId =
      saved.selectedNoteId && noteIds.includes(saved.selectedNoteId)
        ? saved.selectedNoteId
        : null;

    return {
      selectedNoteId,
      sidebarVisible: saved.sidebarVisible,
      focusMode: saved.focusMode && selectedNoteId !== null,
      geometry: saved.geometry,
    };
  } catch {
    return safeWindowSessionDefaults();
  }
}

export async function readRestoredNote<Note>(
  selectedNoteId: string | null,
  read: (id: string) => Promise<Note>,
): Promise<Note | null> {
  if (!selectedNoteId) return null;

  try {
    return await read(selectedNoteId);
  } catch {
    return null;
  }
}

interface WindowSessionPatchWriterOptions {
  delayMs?: number;
  onError?: (error: unknown) => void;
}

export interface WindowSessionPatchWriter {
  queue: (patch: WindowSessionPatch) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function createWindowSessionPatchWriter(
  write: (patch: WindowSessionPatch) => Promise<void>,
  options: WindowSessionPatchWriterOptions = {},
): WindowSessionPatchWriter {
  const delayMs = options.delayMs ?? 250;
  let pending: WindowSessionPatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeWrite: Promise<void> | null = null;
  let cancelled = false;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  async function flush(): Promise<void> {
    clearTimer();
    if (cancelled) return;

    if (activeWrite) {
      await activeWrite;
      if (pending) await flush();
      return;
    }

    if (!pending) return;
    const patch = pending;
    pending = null;

    activeWrite = write(patch)
      .catch((error: unknown) => {
        if (!cancelled) {
          pending = pending ? { ...patch, ...pending } : patch;
        }
        throw error;
      })
      .finally(() => {
        activeWrite = null;
      });

    await activeWrite;
  }

  function queue(patch: WindowSessionPatch): void {
    if (cancelled) return;
    pending = pending ? { ...pending, ...patch } : { ...patch };
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error: unknown) => options.onError?.(error));
    }, delayMs);
  }

  function cancel(): void {
    cancelled = true;
    pending = null;
    clearTimer();
  }

  return { queue, flush, cancel };
}
