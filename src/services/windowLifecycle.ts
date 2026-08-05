import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Completes a close that the frontend already intercepted, flushed, and approved.
 * Rust owns the final destruction so no force-destroy Window plugin permission is
 * exposed to the WebView.
 */
export async function closeWindowAfterSave(): Promise<void> {
  await invoke("close_window_after_save");
}

export async function openPreferencesWindow(): Promise<void> {
  await invoke("open_preferences_window");
}

/** Requests the normal close event so the owning editor can run its save gate. */
export async function requestWindowClose(): Promise<void> {
  await getCurrentWindow().close();
}
