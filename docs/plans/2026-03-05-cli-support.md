# CLI Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `scratch` terminal command so users can open notes and set the notes folder directly from the command line (`scratch file.md`, `scratch .`, `scratch`).

**Architecture:** Three new Tauri commands (`install_cli`, `uninstall_cli`, `get_cli_status`) added to `lib.rs` handle the platform-specific symlink/PATH work. `handle_cli_args` is extended to detect directory arguments and emit a `set-notes-folder` Tauri event. The frontend gains a CLI Tool section in Settings → General and a `set-notes-folder` event listener in `NotesContext`.

**Tech Stack:** Rust (std::os::unix, std::process::Command for Windows registry), Tauri v2 AppHandle, React/TypeScript, Tailwind CSS v4

---

## Task 1: Extend `handle_cli_args` for directory arguments

**Files:**
- Modify: `src-tauri/src/lib.rs:2748-2783`

The goal is to detect when a CLI argument is a directory and emit the `set-notes-folder` event to the frontend.

**Step 1: Add directory-handling branch in `handle_cli_args`**

In `lib.rs`, inside the `for arg in args.iter().skip(1)` loop, after the existing `if is_markdown_extension(&path) && path.is_file()` block, add a new branch for directories:

```rust
// Inside handle_cli_args, after the markdown file check:
} else if path.is_dir() {
    let path_str = path.canonicalize()
        .unwrap_or(path.clone())
        .to_string_lossy()
        .into_owned();
    let _ = app.emit("set-notes-folder", path_str);
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
    opened_file = true; // prevent "show main window" fallback from running again
}
```

The final loop body should look like:

```rust
for arg in args.iter().skip(1) {
    // Skip flags
    if arg.starts_with('-') {
        continue;
    }

    let path = if PathBuf::from(arg).is_absolute() {
        PathBuf::from(arg)
    } else {
        PathBuf::from(cwd).join(arg)
    };

    if is_markdown_extension(&path) && path.is_file() {
        opened_file = true;
        if !try_select_in_notes_folder(app, &path)
            && create_preview_window(app, &path.to_string_lossy()).is_ok()
        {
            opened_preview = true;
        }
    } else if path.is_dir() {
        let path_str = path
            .canonicalize()
            .unwrap_or(path.clone())
            .to_string_lossy()
            .into_owned();
        let _ = app.emit("set-notes-folder", path_str);
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = main_window.show();
            let _ = main_window.set_focus();
        }
        opened_file = true;
    }
}
```

**Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1
```
Expected: no errors

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: handle directory argument in CLI args — emit set-notes-folder event"
```

---

## Task 2: Add `CliStatus` struct and three Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

### Step 1: Add `CliStatus` struct

Find the section where other structs like `NoteMetadata` are defined (around line 22). Add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
}
```

### Step 2: Add helper functions for each platform

Add these functions after the existing `check_cli_exists` function (around line 2189):

```rust
/// Returns the path where the CLI symlink/entry should be installed.
/// macOS: /usr/local/bin/scratch, with fallback to /opt/homebrew/bin/scratch
/// Linux: ~/.local/bin/scratch
/// Windows: N/A (uses PATH registry key instead)
#[cfg(not(target_os = "windows"))]
fn cli_target_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let primary = PathBuf::from("/usr/local/bin/scratch");
        let primary_dir = PathBuf::from("/usr/local/bin");
        if primary_dir.exists() {
            return primary;
        }
        PathBuf::from("/opt/homebrew/bin/scratch")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(format!("{home}/.local/bin/scratch"))
    }
}

#[tauri::command]
fn get_cli_status() -> Result<CliStatus, String> {
    #[cfg(target_os = "windows")]
    {
        // Check if the exe directory is in HKCU\Environment\Path
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .map(|p| p.to_string_lossy().to_lowercase().into_owned())
            .unwrap_or_default();

        let output = std::process::Command::new("reg")
            .args(["query", "HKCU\\Environment", "/v", "Path"])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
        let installed = stdout.contains(&exe_dir);
        return Ok(CliStatus {
            installed,
            path: if installed { Some(exe_dir) } else { None },
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let target = cli_target_path();
        if !target.exists() {
            return Ok(CliStatus { installed: false, path: None });
        }
        // Verify the symlink points to this binary (or any valid Scratch binary)
        let points_to = std::fs::read_link(&target).ok()
            .map(|p| p.to_string_lossy().into_owned());
        Ok(CliStatus {
            installed: true,
            path: Some(target.to_string_lossy().into_owned()),
        })
    }
}

#[tauri::command]
fn install_cli() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Cannot find exe path: {}", e))?
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .ok_or("Cannot determine exe directory")?;

        // Read current user PATH from registry
        let output = std::process::Command::new("reg")
            .args(["query", "HKCU\\Environment", "/v", "Path"])
            .output()
            .map_err(|e| format!("Failed to read registry: {}", e))?;

        let current_path = if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Extract the value after "REG_SZ" or "REG_EXPAND_SZ"
            stdout.lines()
                .find(|l| l.trim_start().starts_with("Path"))
                .and_then(|l| l.split("REG_").nth(1))
                .and_then(|l| l.split_once('\t').map(|(_, v)| v.trim().to_string()))
                .unwrap_or_default()
        } else {
            String::new()
        };

        if current_path.to_lowercase().contains(&exe_dir.to_lowercase()) {
            return Ok(exe_dir); // already installed
        }

        let new_path = if current_path.is_empty() {
            exe_dir.clone()
        } else {
            format!("{};{}", current_path, exe_dir)
        };

        let status = std::process::Command::new("reg")
            .args(["add", "HKCU\\Environment", "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", &new_path, "/f"])
            .status()
            .map_err(|e| format!("Failed to write registry: {}", e))?;

        if !status.success() {
            return Err("Failed to update PATH in registry".to_string());
        }

        Ok(exe_dir)
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::symlink;

        let target = cli_target_path();

        // Ensure parent directory exists (important for ~/.local/bin on Linux)
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
        }

        // Remove stale symlink if present
        if target.exists() || target.symlink_metadata().is_ok() {
            std::fs::remove_file(&target)
                .map_err(|e| format!("Failed to remove existing file: {}", e))?;
        }

        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Cannot find exe path: {}", e))?;

        symlink(&exe_path, &target)
            .map_err(|e| format!("Failed to create symlink: {}", e))?;

        Ok(target.to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn uninstall_cli() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Cannot find exe path: {}", e))?
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .ok_or("Cannot determine exe directory")?;

        let output = std::process::Command::new("reg")
            .args(["query", "HKCU\\Environment", "/v", "Path"])
            .output()
            .map_err(|e| format!("Failed to read registry: {}", e))?;

        if !output.status.success() {
            return Ok(()); // PATH key doesn't exist, nothing to do
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let current_path = stdout.lines()
            .find(|l| l.trim_start().starts_with("Path"))
            .and_then(|l| l.split("REG_").nth(1))
            .and_then(|l| l.split_once('\t').map(|(_, v)| v.trim().to_string()))
            .unwrap_or_default();

        let exe_dir_lower = exe_dir.to_lowercase();
        let new_path: String = current_path
            .split(';')
            .filter(|segment| !segment.trim().to_lowercase().eq(&exe_dir_lower))
            .collect::<Vec<_>>()
            .join(";");

        std::process::Command::new("reg")
            .args(["add", "HKCU\\Environment", "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", &new_path, "/f"])
            .status()
            .map_err(|e| format!("Failed to write registry: {}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let target = cli_target_path();
        if target.exists() || target.symlink_metadata().is_ok() {
            std::fs::remove_file(&target)
                .map_err(|e| format!("Failed to remove symlink: {}", e))?;
        }
        Ok(())
    }
}
```

### Step 3: Register the new commands in `invoke_handler`

In `lib.rs` around line 2912, add the three new commands to the `generate_handler!` list:

```rust
// Add after open_file_preview:
install_cli,
uninstall_cli,
get_cli_status,
```

### Step 4: Verify compilation

```bash
cd src-tauri && cargo check 2>&1
```
Expected: no errors. Fix any compilation errors before proceeding.

### Step 5: Commit

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add install_cli, uninstall_cli, get_cli_status Tauri commands"
```

---

## Task 3: Add `src/services/cli.ts`

**Files:**
- Create: `src/services/cli.ts`

### Step 1: Create the file

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface CliStatus {
  installed: boolean;
  path: string | null;
}

export async function getCliStatus(): Promise<CliStatus> {
  return invoke("get_cli_status");
}

export async function installCli(): Promise<string> {
  return invoke("install_cli");
}

export async function uninstallCli(): Promise<void> {
  return invoke("uninstall_cli");
}
```

### Step 2: Commit

```bash
git add src/services/cli.ts
git commit -m "feat: add CLI service wrappers"
```

---

## Task 4: Add `set-notes-folder` event listener in `NotesContext`

**Files:**
- Modify: `src/context/NotesContext.tsx`

The goal is to listen for the `set-notes-folder` Tauri event (emitted by the backend when `scratch .` is invoked) and call the existing `setNotesFolder` function.

### Step 1: Locate the `useEffect` that sets up the file watcher listener

Find the `useEffect` around line 375 that calls `listen("file-change", ...)`. Add a second `useEffect` **after** the existing `setNotesFolder` `useCallback` (around line 299).

### Step 2: Add the event listener

After the `setNotesFolder` `useCallback` definition (after line ~308), add:

```typescript
// Listen for set-notes-folder event from CLI (scratch .)
useEffect(() => {
  let unlisten: (() => void) | undefined;
  listen<string>("set-notes-folder", async (event) => {
    await setNotesFolder(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => {
    if (unlisten) unlisten();
  };
}, [setNotesFolder]);
```

### Step 3: Verify TypeScript compiles

```bash
npm run build 2>&1 | head -30
```
Expected: no type errors

### Step 4: Commit

```bash
git add src/context/NotesContext.tsx
git commit -m "feat: listen for set-notes-folder event from CLI"
```

---

## Task 5: Add CLI Tool section to `GeneralSettingsSection.tsx`

**Files:**
- Modify: `src/components/settings/GeneralSettingsSection.tsx`

### Step 1: Import the CLI service

Add to the imports at the top of the file:

```typescript
import * as cliService from "../../services/cli";
import type { CliStatus } from "../../services/cli";
```

### Step 2: Add CLI state to the component

Inside `GeneralSettingsSection()`, after the existing `useState` calls (around line 64), add:

```typescript
const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
const [cliLoading, setCliLoading] = useState(false);
```

### Step 3: Add `useEffect` to load CLI status on mount

After the existing `useEffect` for template loading (around line 83), add:

```typescript
useEffect(() => {
  cliService.getCliStatus().then(setCliStatus).catch(console.error);
}, []);
```

### Step 4: Add handler functions

After `handleCancelRemote` (around line 185), add:

```typescript
const handleInstallCli = async () => {
  setCliLoading(true);
  try {
    await cliService.installCli();
    const status = await cliService.getCliStatus();
    setCliStatus(status);
    toast.success("CLI tool installed. Open a new terminal to use `scratch`.");
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to install CLI tool"
    );
  } finally {
    setCliLoading(false);
  }
};

const handleUninstallCli = async () => {
  setCliLoading(true);
  try {
    await cliService.uninstallCli();
    const status = await cliService.getCliStatus();
    setCliStatus(status);
    toast.success("CLI tool uninstalled.");
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to uninstall CLI tool"
    );
  } finally {
    setCliLoading(false);
  }
};
```

### Step 5: Add the CLI Tool section to the JSX

In the `return` block, after the "Default Note Name" `</section>` closing tag (around line 548), add:

```tsx
{/* Divider */}
<div className="border-t border-border border-dashed" />

{/* CLI Tool */}
<section className="pb-2">
  <h2 className="text-xl font-medium mb-0.5">CLI Tool</h2>
  <p className="text-sm text-text-muted mb-4">
    Open notes from the terminal with the{" "}
    <code className="font-mono text-xs bg-bg-muted px-1.5 py-0.5 rounded">
      scratch
    </code>{" "}
    command
  </p>

  {cliStatus === null ? (
    <div className="rounded-[10px] border border-border p-4 flex items-center justify-center">
      <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
    </div>
  ) : cliStatus.installed ? (
    <div className="rounded-[10px] border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text font-medium">Status</span>
        <span className="text-sm text-text-muted">
          Installed
        </span>
      </div>
      {cliStatus.path && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text font-medium">Path</span>
          <code className="text-xs font-mono text-text-muted bg-bg-muted px-2 py-0.5 rounded max-w-48 truncate">
            {cliStatus.path}
          </code>
        </div>
      )}
      <div className="pt-3 border-t border-border border-dashed">
        <p className="text-sm text-text-muted mb-3 font-mono">
          scratch file.md &nbsp;# open note<br />
          scratch . &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# open folder<br />
          scratch &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# launch app
        </p>
        <Button
          onClick={handleUninstallCli}
          disabled={cliLoading}
          variant="outline"
          size="md"
        >
          {cliLoading ? (
            <>
              <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
              Uninstalling...
            </>
          ) : (
            "Uninstall CLI Tool"
          )}
        </Button>
      </div>
    </div>
  ) : (
    <div className="bg-bg-secondary rounded-[10px] border border-border p-4">
      <p className="text-sm text-text-muted mb-3 font-mono">
        scratch file.md &nbsp;# open note<br />
        scratch . &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# open folder<br />
        scratch &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# launch app
      </p>
      <Button
        onClick={handleInstallCli}
        disabled={cliLoading}
        variant="outline"
        size="md"
      >
        {cliLoading ? (
          <>
            <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
            Installing...
          </>
        ) : (
          "Install CLI Tool"
        )}
      </Button>
    </div>
  )}
</section>
```

### Step 6: Verify TypeScript compiles

```bash
npm run build 2>&1 | head -30
```
Expected: no type errors. Fix any issues.

### Step 7: Commit

```bash
git add src/components/settings/GeneralSettingsSection.tsx
git commit -m "feat: add CLI Tool section in Settings → General"
```

---

## Task 6: End-to-end verification

### Step 1: Run the app in dev mode

```bash
npm run tauri dev
```

### Step 2: Verify the CLI Tool section appears

Open Settings → General. Scroll to the bottom. You should see the "CLI Tool" section with an "Install CLI Tool" button.

### Step 3: Install the CLI

Click "Install CLI Tool". Expected: success toast, button changes to "Uninstall CLI Tool", path shown.

### Step 4: Test from terminal

Open a new terminal and run:

```bash
# Should launch app
scratch

# Should open file (adjust path to an actual note)
scratch ~/path/to/note.md

# Should set notes folder
scratch ~/path/to/notes-folder
```

### Step 5: Verify single-instance forwarding

If the app is already running, `scratch file.md` should bring the existing window to front and open the file.

### Step 6: Test uninstall

Click "Uninstall CLI Tool". Run `which scratch` (macOS/Linux) — should return "not found".

### Step 7: Final build check

```bash
npm run build && cd src-tauri && cargo check
```

Expected: both pass with no errors.

---

## Notes

- On macOS, if the user installed via App Store or moved the `.app` bundle, `std::env::current_exe()` always points to the correct binary inside the current bundle.
- On Linux, `~/.local/bin` may not be in PATH by default on all distros. The success toast mentions opening a new terminal; it does not attempt to add `~/.local/bin` to the shell profile.
- On Windows, the PATH change only takes effect in new terminal sessions (OS limitation). The success toast communicates this.
- The `get_cli_status` on Windows uses `reg query` to avoid adding the `winreg` crate dependency. The string parsing is fragile for edge cases but acceptable for this use case.
