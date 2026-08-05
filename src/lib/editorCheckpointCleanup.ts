export function persistCheckpointBeforeEditorDisposal(
  persistCheckpoint: () => Promise<void>,
  disposeScheduler: () => Promise<void>,
  onError: (stage: "persist" | "dispose", error: unknown) => void,
): void {
  void (async () => {
    try {
      await persistCheckpoint();
    } catch (error) {
      onError("persist", error);
    }

    try {
      await disposeScheduler();
    } catch (error) {
      onError("dispose", error);
    }
  })();
}
