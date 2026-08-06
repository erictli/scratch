import type { FileContent, FileSaveResult } from "../services/files";

type RecreateFile = (
  path: string,
  content: string,
) => Promise<FileSaveResult>;

export class StandaloneRecreationConflictError extends Error {
  constructor(
    readonly current: { content: string; revision: string } | null,
  ) {
    super("The source path was recreated elsewhere; conflict preserved");
    this.name = "StandaloneRecreationConflictError";
  }
}

export async function recreateDeletedStandaloneDraft(
  path: string,
  content: string,
  recreateFile: RecreateFile,
): Promise<FileContent> {
  const result = await recreateFile(path, content);
  if (result.status === "conflict") {
    throw new StandaloneRecreationConflictError(result.current);
  }
  return result.file;
}
