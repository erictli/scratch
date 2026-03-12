# CLI Support Design

**Date:** 2026-03-05
**Issue:** [#34 — Add `scratch` CLI command for opening files from terminal](https://github.com/erictli/scratch/issues/34)

## Overview

Add a `scratch` terminal command so users can open notes and set the notes folder directly from the command line, mirroring VS Code's `code` command experience.

```bash
scratch file.md    # Open file in preview mode
scratch .          # Set current directory as notes folder and open app
scratch            # Launch the app
```

## Current State

The Tauri backend already has `handle_cli_args()` in `lib.rs` that processes command-line arguments when the app is invoked directly. The `tauri-plugin-single-instance` plugin forwards args to the running instance. The only missing piece is a `scratch` binary/symlink in the user's PATH.

## Approach

**Symlink to Tauri binary** — Install a symlink (macOS/Linux) or add the binary directory to the user's PATH (Windows) from within the app. Exposed via a button in Settings → General.

## Architecture

### Backend (Rust — `src-tauri/src/lib.rs`)

Three new Tauri commands:

| Command | Description | Return type |
|---------|-------------|-------------|
| `install_cli` | Creates symlink or modifies PATH | `Result<String, String>` (installed path or error) |
| `uninstall_cli` | Removes symlink or reverts PATH change | `Result<(), String>` |
| `get_cli_status` | Checks if CLI is installed and valid | `Result<CliStatus, String>` |

```rust
#[derive(Serialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
}
```

**Platform behavior:**

- **macOS:** Symlink `/usr/local/bin/scratch` → `{app}/Contents/MacOS/Scratch`. Fallback to `/opt/homebrew/bin/scratch` if `/usr/local/bin` is not writable. Uses `std::os::unix::fs::symlink`.
- **Linux:** Symlink `~/.local/bin/scratch` → `std::env::current_exe()`. User-owned directory avoids root permissions.
- **Windows:** Add the `.exe` directory to `HKCU\Environment\Path` via `winreg` crate or `reg` CLI. No script required.

**Directory argument support (`scratch .`):**

Extend `handle_cli_args()` to detect when an argument is a directory path. When found, emit a `"set-notes-folder"` Tauri event to the frontend with the resolved absolute path. `NotesContext` listens to this event and calls `set_notes_folder`.

### Frontend (React/TypeScript)

**New file: `src/services/cli.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface CliStatus {
  installed: boolean;
  path: string | null;
}

export const getCliStatus = () => invoke<CliStatus>("get_cli_status");
export const installCli = () => invoke<string>("install_cli");
export const uninstallCli = () => invoke<void>("uninstall_cli");
```

**Modified: `src/components/settings/GeneralSettingsSection.tsx`**

New "CLI Tool" subsection below the notes folder picker:

- On mount: calls `getCliStatus()` to determine current state.
- **Not installed state:** Shows description text + "Install CLI Tool" button. On click: spinner → calls `installCli()` → shows success with installed path, or error message.
- **Installed state:** Shows installed path + "Uninstall" button.
- Error states show descriptive messages (e.g., "Permission denied — try running with sudo" for macOS `/usr/local/bin`).

**Modified: `src/context/NotesContext.tsx`**

Add a `listen("set-notes-folder", ...)` handler (Tauri event) that calls the existing `setNotesFolder` action when triggered by a `scratch .` invocation.

## Data Flow

```
Terminal: scratch .
    ↓
OS launches Scratch binary (or sends args to running instance via single-instance plugin)
    ↓
handle_cli_args() detects directory argument
    ↓
Emits "set-notes-folder" Tauri event with resolved path
    ↓
NotesContext listener calls setNotesFolder(path)
    ↓
App switches to that notes folder
```

## Error Handling

- Permission errors on macOS symlink install → show user-friendly message suggesting manual steps or using `/opt/homebrew/bin`.
- Broken symlink (app moved) → `get_cli_status` detects this and reports as not installed.
- Windows PATH already contains the directory → treat as already installed.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `install_cli`, `uninstall_cli`, `get_cli_status` commands; extend `handle_cli_args` for directories |
| `src-tauri/Cargo.toml` | Add `winreg` dependency for Windows PATH manipulation |
| `src/services/cli.ts` | New file — Tauri command wrappers |
| `src/components/settings/GeneralSettingsSection.tsx` | Add CLI Tool subsection |
| `src/context/NotesContext.tsx` | Add `set-notes-folder` event listener |
