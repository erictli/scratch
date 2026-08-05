export type PendingDraftRepresentation = "source" | "formatted" | null;

export function choosePendingDraftRepresentation(
  sourceMode: boolean,
  sourceDirty: boolean,
  formattedDirty: boolean,
): PendingDraftRepresentation {
  if (sourceMode) {
    if (sourceDirty) return "source";
    return formattedDirty ? "formatted" : null;
  }
  if (formattedDirty) return "formatted";
  return sourceDirty ? "source" : null;
}

export interface PendingDraftFlushActions {
  discardSource(): void;
  discardFormatted(): void;
  flushSource(): Promise<void>;
  flushFormatted(): Promise<void>;
}

export async function flushPendingDraftRepresentation(
  sourceMode: boolean,
  sourceDirty: boolean,
  formattedDirty: boolean,
  actions: PendingDraftFlushActions,
): Promise<PendingDraftRepresentation> {
  const representation = choosePendingDraftRepresentation(
    sourceMode,
    sourceDirty,
    formattedDirty,
  );
  if (representation === "source") {
    actions.discardFormatted();
    await actions.flushSource();
  } else if (representation === "formatted") {
    actions.discardSource();
    await actions.flushFormatted();
  }
  return representation;
}
