interface PendingEditorSaveFlushers {
  flushSource: () => Promise<void>;
  flushFormatted: () => Promise<void>;
}

export async function flushPendingEditorSaves({
  flushSource,
  flushFormatted,
}: PendingEditorSaveFlushers): Promise<void> {
  await flushSource();
  await flushFormatted();
}
