export type RecoveryPersistenceResult =
  | { status: "not-needed" }
  | { status: "recovered"; path: string };

export interface SafeWindowCloseDependencies {
  flushDraft: () => Promise<void>;
  persistRecovery: () => Promise<RecoveryPersistenceResult>;
  beforeClose?: (result: SafeWindowCloseResult) => Promise<void>;
  closeWindow: () => Promise<void>;
}

export interface SafeWindowCloseResult {
  recoveredTo?: string;
  saveError?: unknown;
}

export function beginSafeWindowClose(
  event: { preventDefault: () => void },
  inProgress: { current: boolean },
): boolean {
  event.preventDefault();
  if (inProgress.current) return false;
  inProgress.current = true;
  return true;
}

export async function resolveCloseListenerRegistration(
  registration: Promise<() => void>,
  onError: (error: unknown) => void,
): Promise<() => void> {
  try {
    return await registration;
  } catch (error) {
    onError(error);
    return () => undefined;
  }
}

export async function runSafeWindowClose(
  dependencies: SafeWindowCloseDependencies,
): Promise<SafeWindowCloseResult> {
  let result: SafeWindowCloseResult = {};

  try {
    await dependencies.flushDraft();
  } catch (saveError) {
    let recovery: RecoveryPersistenceResult;
    try {
      recovery = await dependencies.persistRecovery();
    } catch (recoveryError) {
      const combinedError = new Error(
        "Could not save or recover the draft before closing.",
      ) as Error & { cause?: unknown };
      combinedError.cause = { saveError, recoveryError };
      throw combinedError;
    }

    result =
      recovery.status === "recovered"
        ? { recoveredTo: recovery.path, saveError }
        : { saveError };
  }

  await dependencies.beforeClose?.(result);
  await dependencies.closeWindow();
  return result;
}
