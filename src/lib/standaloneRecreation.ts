import type { FileContent, FileSaveResult } from "../services/files";

type RecreateFile = (
  path: string,
  content: string,
) => Promise<FileSaveResult>;

export async function recreateDeletedStandaloneDraft(
  path: string,
  content: string,
  recreateFile: RecreateFile,
): Promise<FileContent> {
  const result = await recreateFile(path, content);
  if (result.status === "conflict") {
    throw new Error(
      "The source path was recreated elsewhere; conflict preserved",
    );
  }
  return result.file;
}
