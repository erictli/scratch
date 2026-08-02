import { invoke } from "@tauri-apps/api/core";
import type {
  WindowSession,
  WindowSessionPatch,
} from "../lib/windowSession";

export async function getWindowSession(): Promise<WindowSession | null> {
  return invoke("get_window_session");
}

export async function updateWindowSession(
  patch: WindowSessionPatch,
): Promise<void> {
  return invoke("update_window_session", { patch });
}
