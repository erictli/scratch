export interface ReloadPersistenceController {
  flush: () => Promise<void>;
  getDraft: () => { dirty: boolean };
}

export async function flushDirtyDraftBeforeReload(
  controller: ReloadPersistenceController | null,
): Promise<void> {
  if (controller?.getDraft().dirty) {
    await controller.flush();
  }
}

export async function loadStandalonePreviewState<FileState, CheckpointState>(
  filePath: string,
  readFile: (path: string) => Promise<FileState>,
  getCheckpoint: (path: string) => Promise<CheckpointState | null>,
  isCancelled: () => boolean,
): Promise<{
  file: FileState;
  checkpoint: CheckpointState | null;
} | null> {
  const file = await readFile(filePath);
  if (isCancelled()) return null;

  let checkpoint: CheckpointState | null = null;
  try {
    checkpoint = await getCheckpoint(filePath);
  } catch {
    checkpoint = null;
  }
  if (isCancelled()) return null;

  return { file, checkpoint };
}
