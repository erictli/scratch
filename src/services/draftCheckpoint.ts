import { invoke } from "@tauri-apps/api/core";
import type {
  DraftCheckpoint,
} from "../lib/draftCheckpoint";

export async function writeDraftCheckpoint(
  checkpoint: DraftCheckpoint,
): Promise<void> {
  return invoke("write_draft_checkpoint", {
    noteId: checkpoint.key.noteId,
    markdown: checkpoint.markdown,
    metadata: checkpoint.metadata,
  });
}

export async function getDraftCheckpoint(
  noteId: string,
): Promise<DraftCheckpoint | null> {
  return invoke("get_draft_checkpoint", { noteId });
}

export async function clearDraftCheckpoint(
  noteId: string,
): Promise<void> {
  return invoke("clear_draft_checkpoint", { noteId });
}

export async function listDraftCheckpoints(): Promise<DraftCheckpoint[]> {
  return invoke("list_draft_checkpoints");
}
