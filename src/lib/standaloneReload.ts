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
