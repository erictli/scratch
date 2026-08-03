import { invoke } from "@tauri-apps/api/core";

export interface FileContent {
  path: string;
  content: string;
  title: string;
  modified: number;
  revision: string;
}
export type FileSaveResult =
  | { status: "saved"; file: FileContent }
  | {
      status: "conflict";
      current: { content: string; revision: string } | null;
    };

export async function readFileDirect(path: string): Promise<FileContent> {
  return invoke("read_file_direct", { path });
}

export async function saveFileDirect(
  path: string,
  content: string,
  expectedRevision: string,
): Promise<FileSaveResult> {
  return invoke("save_file_direct", { path, content, expectedRevision });
}

export async function recreateFileDirect(
  path: string,
  content: string,
): Promise<FileSaveResult> {
  return invoke("recreate_file_direct", { path, content });
}

export async function openFilePreview(path: string): Promise<void> {
  return invoke("open_file_preview", { path });
}

export interface ImportedNote {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export async function importFileToFolder(
  path: string,
): Promise<ImportedNote> {
  return invoke("import_file_to_folder", { path });
}
