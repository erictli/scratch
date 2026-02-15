import { invoke } from "@tauri-apps/api/core";

export interface FileContent {
  path: string;
  content: string;
  title: string;
  modified: number;
}

export async function readFileDirect(path: string): Promise<FileContent> {
  return invoke("read_file_direct", { path });
}

export async function saveFileDirect(
  path: string,
  content: string,
): Promise<FileContent> {
  return invoke("save_file_direct", { path, content });
}

export async function openFilePreview(path: string): Promise<void> {
  return invoke("open_file_preview", { path });
}
