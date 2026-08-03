export interface SafeWindowCloseDependencies {
  flushDraft: () => Promise<void>;
  persistRecovery: () => Promise<string | undefined>;
  closeWindow: () => Promise<void>;
}

export interface SafeWindowCloseResult {
  recoveredTo?: string;
  saveError?: unknown;
}

export async function runSafeWindowClose(
  dependencies: SafeWindowCloseDependencies,
): Promise<SafeWindowCloseResult> {
  let result: SafeWindowCloseResult = {};

  try {
    await dependencies.flushDraft();
  } catch (saveError) {
    const recoveredTo = await dependencies.persistRecovery();
    result = { recoveredTo, saveError };
  }

  await dependencies.closeWindow();
  return result;
}
