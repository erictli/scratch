export type ConflictResolutionStrategy = "keepLocal" | "useRemote";

export interface ConflictDraft {
  content: string;
  dirty: boolean;
}

export interface ConflictRemote {
  content: string;
  revision: string;
}

export async function runConflictResolution<Remote extends ConflictRemote>(
  strategy: ConflictResolutionStrategy,
  state: { draft: ConflictDraft; remote: Remote | null },
  actions: {
    persistRecovery: () => Promise<string | undefined>;
    overwriteRemote: (
      draft: ConflictDraft,
      remote: Remote,
    ) => Promise<void>;
    recreateDeleted: (draft: ConflictDraft) => Promise<void>;
    acceptRemote: (remote: Remote | null) => Promise<void>;
  },
): Promise<void> {
  if (state.draft.dirty) {
    const recoveryPath = await actions.persistRecovery();
    if (!recoveryPath) {
      throw new Error("Recovery snapshot was not created");
    }
  }

  if (strategy === "useRemote") {
    await actions.acceptRemote(state.remote);
    return;
  }

  if (state.remote) {
    await actions.overwriteRemote(state.draft, state.remote);
  } else {
    await actions.recreateDeleted(state.draft);
  }
}
