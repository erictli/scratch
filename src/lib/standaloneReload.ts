import type { DraftCheckpoint } from "./draftCheckpoint";

export interface ReloadPersistenceController {
  flush: () => Promise<void>;
  getDraft: () => { dirty: boolean };
}

export interface LatestRequestGuard {
  begin(): () => boolean;
  invalidate(): void;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let latestRequest = 0;
  return {
    begin() {
      const request = ++latestRequest;
      return () => request === latestRequest;
    },
    invalidate() {
      latestRequest += 1;
    },
  };
}

export function standaloneRecoveryBaseRevision(
  diskRevision: string,
  diskContent: string,
  checkpoint: DraftCheckpoint | null,
): string {
  if (checkpoint && checkpoint.markdown !== diskContent) {
    return checkpoint.metadata.baseRevision ?? "";
  }
  return diskRevision;
}

export async function flushDirtyDraftBeforeReload(
  controller: ReloadPersistenceController | null,
): Promise<void> {
  if (controller?.getDraft().dirty) {
    await controller.flush();
  }
}
