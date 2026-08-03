export interface DocumentDraftSnapshot {
  dirty: boolean;
}

export async function flushDraftBeforeRelocation(
  draft: DocumentDraftSnapshot,
  affectsDraft: boolean,
  flush: () => Promise<void>,
): Promise<void> {
  if (affectsDraft && draft.dirty) {
    await flush();
  }
}

export async function preserveDraftBeforeDeletion(
  draft: DocumentDraftSnapshot,
  affectsDraft: boolean,
  persistRecovery: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!affectsDraft || !draft.dirty) return undefined;
  const recoveryPath = await persistRecovery();
  if (!recoveryPath) {
    throw new Error("Recovery snapshot was not created");
  }
  return recoveryPath;
}
