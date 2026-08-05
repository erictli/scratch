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

function normalizeWindowGeometry(value: unknown): WindowGeometry | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as Partial<Record<keyof WindowGeometry, unknown>>;
  const fields = [geometry.x, geometry.y, geometry.width, geometry.height];
  if (
    fields.some(
      (field) => typeof field !== "number" || !Number.isFinite(field),
    )
  ) {
    return null;
  }
  if ((geometry.width as number) <= 0 || (geometry.height as number) <= 0) {
    return null;
  }
  return {
    x: geometry.x as number,
    y: geometry.y as number,
    width: geometry.width as number,
    height: geometry.height as number,
  };
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
      sidebarVisible:
        typeof saved.sidebarVisible === "boolean"
          ? saved.sidebarVisible
          : DEFAULT_RESTORED_WINDOW_SESSION.sidebarVisible,
      focusMode:
        (typeof saved.focusMode === "boolean"
          ? saved.focusMode
          : DEFAULT_RESTORED_WINDOW_SESSION.focusMode) &&
        selectedNoteId !== null,
      geometry: normalizeWindowGeometry(saved.geometry),
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

  function scheduleFlush(): void {
    if (cancelled) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error: unknown) => options.onError?.(error));
    }, delayMs);
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
          scheduleFlush();
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
    scheduleFlush();
  }

  function cancel(): void {
    cancelled = true;
    pending = null;
    clearTimer();
  }

  return { queue, flush, cancel };
}
