import { invoke, getCurrentWindow } from "@tauri-apps/api/core";

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

/**
 * Requests the current window to close. The close is interceptable by the
 * WebView's onCloseRequested handler, allowing the frontend to flush drafts
 * or persist recovery before the window is destroyed.
 */
export async function requestCurrentWindowClose(): Promise<void> {
  await getCurrentWindow().close();
}
